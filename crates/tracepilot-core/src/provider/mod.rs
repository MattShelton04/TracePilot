//! Session sources behind one seam.
//!
//! Everything source-specific lives under this module. Consumers outside it
//! work on [`SessionLocator`]s, [`SourceFingerprint`]s and normalized
//! [`TypedEvent`](crate::parsing::events::TypedEvent)s, never on a source's
//! file layout.

use std::sync::Arc;

use crate::error::Result;
use crate::ids::SessionId;

pub mod copilot;
mod types;

pub use copilot::CopilotProvider;
pub use types::{
    CostBasis, CostFigure, CostUnit, Liveness, NativeRecord, ProviderSnapshot, RunStatus,
    SessionArtifacts, SessionLocator, SessionMetrics, SessionRole, SessionSource,
    SourceCapabilities, SourceFingerprint, TodoList,
};

/// One session source: how to find its sessions and load them as
/// normalized events.
pub trait SessionProvider: Send + Sync {
    fn source(&self) -> SessionSource;

    fn capabilities(&self) -> SourceCapabilities;

    /// Every session under the source's root. A cancelled scan is an error,
    /// never a partial inventory that a caller might prune against.
    fn discover(&self, is_cancelled: &dyn Fn() -> bool) -> Result<Vec<SessionLocator>>;

    /// The current identity of every file a load would read.
    fn fingerprint(&self, session: &SessionLocator) -> Result<SourceFingerprint>;

    /// Load a session. `strict` loads are for durable indexes: they fail on
    /// incomplete sources and on files that change while reading. Other
    /// loads are best effort, for display.
    fn load_snapshot(
        &self,
        session: &SessionLocator,
        strict: bool,
        is_cancelled: &dyn Fn() -> bool,
    ) -> Result<ProviderSnapshot>;

    fn liveness(&self, session: &SessionLocator) -> Liveness;

    /// Todos, plan, checkpoints and browsable roots.
    fn artifacts(&self, _session: &SessionLocator) -> Result<SessionArtifacts> {
        Ok(SessionArtifacts::default())
    }

    /// Find a session by id without the index. `None` when the source has no
    /// such session.
    fn resolve(&self, id: &SessionId) -> Result<Option<SessionLocator>>;
}

/// The outcome of one source's discovery pass.
pub struct SourceInventory {
    pub source: SessionSource,
    pub sessions: Result<Vec<SessionLocator>>,
}

/// The enabled providers, at most one per source.
#[derive(Clone, Default)]
pub struct ProviderRegistry {
    providers: Vec<Arc<dyn SessionProvider>>,
}

impl ProviderRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Add a provider, replacing and returning any provider for the same source.
    pub fn register(
        &mut self,
        provider: Arc<dyn SessionProvider>,
    ) -> Option<Arc<dyn SessionProvider>> {
        let source = provider.source();
        match self.providers.iter_mut().find(|p| p.source() == source) {
            Some(existing) => Some(std::mem::replace(existing, provider)),
            None => {
                self.providers.push(provider);
                None
            }
        }
    }

    pub fn get(&self, source: SessionSource) -> Option<&Arc<dyn SessionProvider>> {
        self.providers.iter().find(|p| p.source() == source)
    }

    pub fn providers(&self) -> &[Arc<dyn SessionProvider>] {
        &self.providers
    }

    /// Discover every source independently, so one failed or cancelled
    /// source never hides another's complete inventory.
    pub fn discover_each(&self, is_cancelled: &dyn Fn() -> bool) -> Vec<SourceInventory> {
        self.providers
            .iter()
            .map(|provider| SourceInventory {
                source: provider.source(),
                sessions: provider.discover(is_cancelled),
            })
            .collect()
    }

    /// Resolve an id through each provider in registration order.
    pub fn resolve(&self, id: &SessionId) -> Result<Option<SessionLocator>> {
        for provider in &self.providers {
            if let Some(locator) = provider.resolve(id)? {
                return Ok(Some(locator));
            }
        }
        Ok(None)
    }
}

#[cfg(test)]
mod tests;
