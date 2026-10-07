//! Per-source discovery for one indexing pass.

use std::sync::Arc;

use tracepilot_core::provider::{SessionLocator, SessionProvider};

use crate::Result;
use crate::indexing::scope::IndexScope;

/// One source's sessions for this pass.
pub(super) struct SourcePass {
    pub provider: Arc<dyn SessionProvider>,
    pub sessions: Vec<SessionLocator>,
    /// The whole configured root was listed, so an indexed session missing
    /// from `sessions` was deleted and may be pruned.
    pub complete: bool,
}

/// Discover each source independently. A source whose discovery fails or is
/// cancelled is left out: it is neither indexed nor pruned this pass. A
/// source whose root is missing, before or after its scan, is kept but marked
/// incomplete. A source whose configuration changed is skipped silently.
/// Fails only when every remaining source's discovery failed.
pub(super) fn discover(
    scope: &IndexScope,
    is_cancelled: &dyn Fn() -> bool,
) -> Result<Vec<SourcePass>> {
    let mut passes = Vec::new();
    let mut first_error = None;
    for provider in scope.registry().providers() {
        let source = provider.source();
        let cancelled = || is_cancelled() || !scope.is_current(source);
        let root_before = provider.root_exists();
        match provider.discover(&cancelled) {
            Ok(sessions) => {
                let complete = root_before && provider.root_exists();
                if !complete {
                    tracing::warn!(
                        source = source.as_str(),
                        "Session root not found; keeping its indexed sessions"
                    );
                }
                passes.push(SourcePass {
                    provider: Arc::clone(provider),
                    sessions,
                    complete,
                });
            }
            Err(_) if !scope.is_current(source) => {
                tracing::info!(
                    source = source.as_str(),
                    "Source configuration changed; source skipped this pass"
                );
            }
            Err(error) => {
                tracing::warn!(source = source.as_str(), error = %error,
                    "Session discovery incomplete; source skipped this pass");
                first_error.get_or_insert(error);
            }
        }
    }
    match first_error {
        Some(error) if passes.is_empty() => Err(error.into()),
        _ => Ok(passes),
    }
}
