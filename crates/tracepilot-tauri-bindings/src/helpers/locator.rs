//! Resolve a session id to the provider that owns it and its locator.

use std::path::{Component, Path, PathBuf};

use tracepilot_core::TracePilotError;
use tracepilot_core::ids::SessionId;
use tracepilot_core::provider::{
    ResolvedSession, SessionLocator, SessionSource, SourceCapabilities,
};
use tracepilot_indexer::index_db::IndexDb;

use crate::config::{SharedConfig, TracePilotConfig};
use crate::error::{BindingsError, CmdResult};
use crate::providers::registry_for;

use super::cache::read_config;

/// Resolve a session through the locator the index stored for it, falling
/// back to the providers when the index has no usable row. Blocking.
///
/// The registry only trusts a stored locator whose source is enabled and
/// whose path lies under that provider's current root, so a stale row never
/// sends a command to another root.
pub(crate) fn resolve_session(
    config: &TracePilotConfig,
    session_id: &SessionId,
) -> CmdResult<ResolvedSession> {
    let stored = stored_locator(&config.index_db_path(), session_id);
    registry_for(config)
        .locate(session_id, stored)?
        .ok_or_else(|| TracePilotError::SessionNotFound(session_id.to_string()).into())
}

/// The index's row for a session. A missing or unreadable index is not an
/// error: the providers can still resolve the id.
pub(super) fn stored_locator(index_path: &Path, session_id: &SessionId) -> Option<SessionLocator> {
    if !index_path.exists() {
        return None;
    }
    IndexDb::open_readonly(index_path)
        .and_then(|db| db.get_session_locator(session_id))
        .map_err(|error| {
            tracing::debug!(%error, "Index lookup failed; resolving the session from disk");
        })
        .ok()
        .flatten()
}

/// Resolve a session and run a blocking closure with it.
///
/// Callers pass a [`SessionId`] that `crate::validators::validate_session_id`
/// produced, so the id is a UUID before it reaches any path.
pub(crate) async fn with_session_locator<T, F>(
    state: &SharedConfig,
    session_id: SessionId,
    f: F,
) -> CmdResult<T>
where
    T: Send + 'static,
    F: FnOnce(ResolvedSession) -> Result<T, BindingsError> + Send + 'static,
{
    let config = read_config(state);
    tokio::task::spawn_blocking(move || f(resolve_session(&config, &session_id)?)).await?
}

/// Refuse an action the session's source does not support.
pub(crate) fn require_capability(
    session: &ResolvedSession,
    supported: impl FnOnce(SourceCapabilities) -> bool,
    action: &'static str,
) -> CmdResult<()> {
    if supported(session.provider.capabilities()) {
        Ok(())
    } else {
        Err(BindingsError::Unsupported {
            session_source: session.locator.source,
            action,
        })
    }
}

/// Refuse an action that still reads Copilot's session directory layout
/// directly rather than through the provider.
pub(crate) fn require_copilot_layout(
    session: &ResolvedSession,
    action: &'static str,
) -> CmdResult<()> {
    if session.locator.source == SessionSource::Copilot {
        Ok(())
    } else {
        Err(BindingsError::Unsupported {
            session_source: session.locator.source,
            action,
        })
    }
}

/// The directories the file browser and image preview read: the provider's
/// browsable roots for the session, each of which must lie under the
/// provider's own root. Relative paths from the frontend are resolved inside
/// them by `file_browser::scope` and `file_browser::security`.
pub(crate) fn explorer_roots(session: &ResolvedSession) -> CmdResult<Vec<PathBuf>> {
    const ACTION: &str = "Browsing session files";
    require_capability(session, |caps| caps.has_explorer, ACTION)?;
    let unsupported = || BindingsError::Unsupported {
        session_source: session.locator.source,
        action: ACTION,
    };
    let provider_root = session.provider.root().ok_or_else(unsupported)?;
    let roots = session.provider.file_roots(&session.locator)?;
    if roots.is_empty() {
        return Err(unsupported());
    }
    if !roots
        .iter()
        .all(|root| is_strictly_under(provider_root, root))
    {
        return Err(BindingsError::Validation(
            "Session files are outside the session source's directory".into(),
        ));
    }
    Ok(roots)
}

/// `path` is below `root` through plain names only (no `..`, no prefix).
fn is_strictly_under(root: &Path, path: &Path) -> bool {
    path.strip_prefix(root).is_ok_and(|relative| {
        relative.components().next().is_some()
            && relative
                .components()
                .all(|component| matches!(component, Component::Normal(_)))
    })
}
