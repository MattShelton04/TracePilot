//! Unified registry of `tokio::sync::Semaphore` gates used to bound
//! background indexing concurrency.
//!
//! Introduced in wave 126 as the single source of truth for permit counts,
//! lifecycle, and acquire/release tracing. Previously there were two loose
//! `Arc<Semaphore>` / `SearchSemaphore` values wired into Tauri managed
//! state; consolidating them here keeps policy and telemetry aligned and
//! makes it obvious where to add a new gate (e.g. an MCP-call gate) if a
//! future concurrent code path needs one.
//!
//! Permit counts are **intentionally preserved** from the pre-w126 layout
//! (one permit each). Tuning them should be a deliberate change — see the
//! tech-debt future-improvements log for candidates (config-driven limits,
//! metrics exposition, fairness policies).

use std::sync::Arc;

use tokio::sync::{OwnedSemaphorePermit, Semaphore, TryAcquireError};

/// Permits for the "session reindex" gate. One permit = at most one active
/// incremental/full reindex at a time (`AlreadyIndexing` is surfaced to the
/// UI when busy).
pub const SESSION_REINDEX_PERMITS: usize = 1;

/// Permits for the "search content" gate (Phase 2 of reindex and the
/// standalone search-index rebuild command).
pub const SEARCH_CONTENT_PERMITS: usize = 1;

/// Named collection of the indexing concurrency gates.
///
/// Stored once in Tauri managed state as `Arc<IndexingSemaphores>`; IPC
/// command handlers acquire via the `try_acquire_*` helpers so that every
/// acquire/release is uniformly traced.
pub struct IndexingSemaphores {
    sessions: Arc<Semaphore>,
    search: Arc<Semaphore>,
}

impl IndexingSemaphores {
    /// Build the registry with the canonical permit counts.
    pub fn new() -> Self {
        tracing::debug!(
            sessions_permits = SESSION_REINDEX_PERMITS,
            search_permits = SEARCH_CONTENT_PERMITS,
            "initializing indexing semaphores"
        );
        Self {
            sessions: Arc::new(Semaphore::new(SESSION_REINDEX_PERMITS)),
            search: Arc::new(Semaphore::new(SEARCH_CONTENT_PERMITS)),
        }
    }

    /// Raw handle to the session-reindex gate. Prefer `try_acquire_sessions`
    /// for ad-hoc use; this accessor exists for callers that need to pass
    /// the `Arc<Semaphore>` across an `await` boundary (e.g. into a
    /// `spawn_blocking` closure that was written before w126).
    pub fn sessions(&self) -> &Arc<Semaphore> {
        &self.sessions
    }

    /// Raw handle to the search-content gate. See `sessions()` notes.
    pub fn search(&self) -> &Arc<Semaphore> {
        &self.search
    }

    /// Remaining permits on the session-reindex gate.
    pub fn sessions_available(&self) -> usize {
        self.sessions.available_permits()
    }

    /// Try to acquire the session-reindex gate without blocking.
    /// Returns an owned permit so it can outlive the handler frame.
    pub fn try_acquire_sessions(&self) -> Result<OwnedSemaphorePermit, TryAcquireError> {
        acquire_traced("sessions", &self.sessions)
    }

    /// Try to acquire the search-content gate without blocking.
    pub fn try_acquire_search(&self) -> Result<OwnedSemaphorePermit, TryAcquireError> {
        acquire_traced("search", &self.search)
    }
}

impl Default for IndexingSemaphores {
    fn default() -> Self {
        Self::new()
    }
}

fn acquire_traced(
    gate: &'static str,
    sem: &Arc<Semaphore>,
) -> Result<OwnedSemaphorePermit, TryAcquireError> {
    match sem.clone().try_acquire_owned() {
        Ok(permit) => {
            tracing::debug!(
                gate,
                available = sem.available_permits(),
                "indexing gate acquired"
            );
            Ok(permit)
        }
        Err(err) => {
            tracing::debug!(gate, "indexing gate busy");
            Err(err)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permit_counts_match_pre_w126_policy() {
        assert_eq!(SESSION_REINDEX_PERMITS, 1);
        assert_eq!(SEARCH_CONTENT_PERMITS, 1);
    }

    #[tokio::test]
    async fn second_sessions_acquire_fails_until_release() {
        let gates = IndexingSemaphores::new();
        let permit = gates.try_acquire_sessions().expect("first acquire");
        assert!(gates.try_acquire_sessions().is_err());
        drop(permit);
        assert!(gates.try_acquire_sessions().is_ok());
    }

    #[tokio::test]
    async fn sessions_and_search_are_independent() {
        let gates = IndexingSemaphores::new();
        let _s = gates.try_acquire_sessions().expect("sessions");
        let _r = gates.try_acquire_search().expect("search");
    }
}
