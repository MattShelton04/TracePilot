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

/// The directories the file browser and image preview read for a session's
/// own files: the provider's browsable roots, each of which must lie under
/// one of the provider's file root bases. Relative paths from the frontend
/// are resolved inside them by `file_browser::scope` and
/// `file_browser::security`.
pub(crate) fn explorer_roots(session: &ResolvedSession) -> CmdResult<Vec<PathBuf>> {
    require_explorer(session)?;
    let bases = session.provider.file_root_bases();
    let roots = session.provider.file_roots(&session.locator)?;
    if roots.is_empty() {
        return Err(explorer_unsupported(session));
    }
    if !roots
        .iter()
        .all(|root| bases.iter().any(|base| is_strictly_under(base, root)))
    {
        return Err(outside_bases());
    }
    Ok(roots)
}

/// The session's scratchpad when it exists as a real directory (never a
/// link, since an agent writes there) under one of the provider's file root
/// bases. `None` when the source has none or it does not exist.
pub(crate) fn explorer_scratchpad(session: &ResolvedSession) -> CmdResult<Option<PathBuf>> {
    require_explorer(session)?;
    let Some(dir) = session.provider.scratchpad_root(&session.locator) else {
        return Ok(None);
    };
    let bases = session.provider.file_root_bases();
    let Some(base) = bases.iter().find(|base| is_strictly_under(base, &dir)) else {
        return Err(outside_bases());
    };
    let is_real_dir = std::fs::symlink_metadata(&dir)
        .is_ok_and(|meta| meta.is_dir() && !meta.file_type().is_symlink());
    if !is_real_dir {
        return Ok(None);
    }
    let (Ok(canonical_base), Ok(canonical)) = (base.canonicalize(), dir.canonicalize()) else {
        return Ok(None);
    };
    if !is_strictly_under(&canonical_base, &canonical) {
        return Err(outside_bases());
    }
    Ok(Some(dir))
}

const BROWSING: &str = "Browsing session files";

/// The session's source can be browsed and has somewhere to browse.
fn require_explorer(session: &ResolvedSession) -> CmdResult<()> {
    require_capability(session, |caps| caps.has_explorer, BROWSING)?;
    if session.provider.file_root_bases().is_empty() {
        return Err(explorer_unsupported(session));
    }
    Ok(())
}

fn explorer_unsupported(session: &ResolvedSession) -> BindingsError {
    BindingsError::Unsupported {
        session_source: session.locator.source,
        action: BROWSING,
    }
}

fn outside_bases() -> BindingsError {
    BindingsError::Validation("Session files are outside the session source's directory".into())
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
