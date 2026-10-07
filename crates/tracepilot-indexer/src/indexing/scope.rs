//! What one indexing pass covers, and the guard that stops a pass from
//! writing a source after that source's configuration changed.

use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use tracepilot_core::provider::{CopilotProvider, ProviderRegistry, SessionSource};

use crate::error::IndexerError;

const SOURCES: usize = SessionSource::ALL.len();

fn slot(source: SessionSource) -> usize {
    SessionSource::ALL
        .iter()
        .position(|candidate| *candidate == source)
        .unwrap_or_default()
}

/// One configuration generation per source. Bump a source's generation when
/// it is enabled, disabled or moved, before purging its rows: every pass
/// that captured the old generation then rolls back instead of committing.
#[derive(Debug, Default)]
pub struct SourceGenerations {
    counters: [AtomicU64; SOURCES],
}

impl SourceGenerations {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn current(&self, source: SessionSource) -> u64 {
        self.counters[slot(source)].load(Ordering::Acquire)
    }

    /// Invalidate passes holding `source`'s current configuration. Returns
    /// the new generation.
    pub fn bump(&self, source: SessionSource) -> u64 {
        self.counters[slot(source)].fetch_add(1, Ordering::AcqRel) + 1
    }
}

/// A registry snapshot plus the generation each source had when it was
/// taken. Index writes for a source commit only while that source's
/// generation is still current.
#[derive(Clone)]
pub struct IndexScope {
    registry: ProviderRegistry,
    generations: Arc<SourceGenerations>,
    captured: [u64; SOURCES],
}

impl IndexScope {
    /// Capture each source's generation now. Build `registry` from the same
    /// configuration, under the lock that orders configuration changes, so
    /// the two describe one configuration.
    pub fn new(registry: ProviderRegistry, generations: Arc<SourceGenerations>) -> Self {
        let captured = SessionSource::ALL.map(|source| generations.current(source));
        Self {
            registry,
            generations,
            captured,
        }
    }

    /// A scope nothing else can invalidate, for one-shot callers.
    pub fn standalone(registry: ProviderRegistry) -> Self {
        Self::new(registry, Arc::default())
    }

    /// The Copilot sessions under one `session-state` directory.
    pub fn copilot(session_state_dir: &Path) -> Self {
        let mut registry = ProviderRegistry::new();
        registry.register(Arc::new(CopilotProvider::new(session_state_dir)));
        Self::standalone(registry)
    }

    pub fn registry(&self) -> &ProviderRegistry {
        &self.registry
    }

    /// Whether `source`'s configuration is still the one this scope captured.
    /// Check it after a transaction's writes and before its commit: the
    /// writes hold SQLite's write lock, so a purge that follows a bump waits
    /// for the commit and then deletes what it wrote.
    pub fn is_current(&self, source: SessionSource) -> bool {
        self.generations.current(source) == self.captured[slot(source)]
    }
}

pub(crate) fn stale_source(source: SessionSource) -> IndexerError {
    IndexerError::StaleSource {
        name: source.as_str().to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_bump_invalidates_only_its_source() {
        let generations = Arc::new(SourceGenerations::new());
        let scope = IndexScope::new(ProviderRegistry::new(), Arc::clone(&generations));
        assert!(scope.is_current(SessionSource::ClaudeCode));
        generations.bump(SessionSource::ClaudeCode);
        assert!(!scope.is_current(SessionSource::ClaudeCode));
        assert!(scope.is_current(SessionSource::Copilot));
        let fresh = IndexScope::new(ProviderRegistry::new(), generations);
        assert!(fresh.is_current(SessionSource::ClaudeCode));
    }
}
