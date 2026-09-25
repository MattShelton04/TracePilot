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

pub mod index_jobs;
pub mod indexing_guard;

pub use index_jobs::IndexJobState;
pub use indexing_guard::{IndexingJobGuard, SharedIndexingState};

/// Permits for the "session reindex" gate. One permit = at most one active
/// incremental/full reindex at a time (`AlreadyIndexing` is surfaced to the
/// UI when busy).
pub const SESSION_REINDEX_PERMITS: usize = 1;

/// Permits for the "search content" gate (Phase 2 of reindex and the
/// standalone search-index rebuild command).
pub const SEARCH_CONTENT_PERMITS: usize = 1;

/// Permits for whole-corpus disk scans (index-unavailable fallbacks). Each
/// scan parses every session and can hold GBs of turns, so they run one at a
/// time instead of stacking up per navigation.
pub const DISK_SCAN_PERMITS: usize = 1;

/// Named collection of the indexing concurrency gates.
///
/// Stored once in Tauri managed state as `Arc<IndexingSemaphores>`; IPC
/// command handlers acquire via the `try_acquire_*` helpers so that every
/// acquire/release is uniformly traced.
pub struct IndexingSemaphores {
    sessions: Arc<Semaphore>,
    search: Arc<Semaphore>,
    disk_scan: Arc<Semaphore>,
    jobs: IndexJobState,
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
            disk_scan: Arc::new(Semaphore::new(DISK_SCAN_PERMITS)),
            jobs: IndexJobState::new(),
        }
    }

    /// Coordination signals shared by indexing jobs and index readers.
    pub fn jobs(&self) -> &IndexJobState {
        &self.jobs
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

    /// Remaining permits on the search-content gate.
    pub fn search_available(&self) -> usize {
        self.search.available_permits()
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

    /// Wait for the session-reindex gate (FIFO). Used by callers that should
    /// queue behind a running job rather than fail with `AlreadyIndexing`.
    pub async fn acquire_sessions(&self) -> OwnedSemaphorePermit {
        wait_traced("sessions", &self.sessions).await
    }

    /// Wait for the search-content gate (FIFO).
    pub async fn acquire_search(&self) -> OwnedSemaphorePermit {
        wait_traced("search", &self.search).await
    }

    /// Wait for the whole-corpus disk-scan gate.
    pub async fn acquire_disk_scan(&self) -> OwnedSemaphorePermit {
        wait_traced("disk_scan", &self.disk_scan).await
    }

    /// Stop any running search pass and wait for it to release its gate.
    ///
    /// Destructive operations (full rebuild, factory reset, moving the data
    /// directory) must hold this permit so a background search pass can never
    /// write into a database that is being deleted or copied.
    pub async fn cancel_and_acquire_search(&self) -> OwnedSemaphorePermit {
        // Clear the request even if this future is dropped while waiting;
        // a stale flag would silently cancel every later search pass.
        struct ClearOnDrop<'a>(&'a IndexJobState);
        impl Drop for ClearOnDrop<'_> {
            fn drop(&mut self) {
                self.0.clear_search_cancel();
            }
        }
        self.jobs.request_search_cancel();
        let _clear = ClearOnDrop(&self.jobs);
        self.acquire_search().await
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

/// Marks an initial (empty-index) build for as long as it is alive. Owns an
/// `Arc` so it can move into a `spawn_blocking` job: a failing or panicking
/// job can never leave readers waiting forever.
pub struct InitialBuildGuard(Arc<IndexingSemaphores>);

impl InitialBuildGuard {
    pub fn start(gates: Arc<IndexingSemaphores>) -> Self {
        gates.jobs().set_initial_build(true);
        Self(gates)
    }
}

impl Drop for InitialBuildGuard {
    fn drop(&mut self) {
        self.0.jobs().set_initial_build(false);
    }
}

async fn wait_traced(gate: &'static str, sem: &Arc<Semaphore>) -> OwnedSemaphorePermit {
    let permit = sem
        .clone()
        .acquire_owned()
        .await
        .expect("indexing semaphores are never closed");
    tracing::debug!(gate, "indexing gate acquired (waited)");
    permit
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
    async fn acquire_sessions_waits_for_release() {
        let gates = Arc::new(IndexingSemaphores::new());
        let held = gates.try_acquire_sessions().expect("first");
        let waiter = {
            let gates = Arc::clone(&gates);
            tokio::spawn(async move {
                let _permit = gates.acquire_sessions().await;
            })
        };
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        assert!(!waiter.is_finished());
        drop(held);
        tokio::time::timeout(std::time::Duration::from_secs(1), waiter)
            .await
            .expect("waiter acquires after release")
            .expect("join");
    }

    #[tokio::test]
    async fn cancel_and_acquire_search_signals_running_pass() {
        let gates = Arc::new(IndexingSemaphores::new());
        let running = gates.try_acquire_search().expect("running pass");
        let observer = {
            let gates = Arc::clone(&gates);
            tokio::spawn(async move {
                // Simulated search pass: polls the cancel flag, then releases.
                while !gates.jobs().search_cancelled() {
                    tokio::time::sleep(std::time::Duration::from_millis(5)).await;
                }
                drop(running);
            })
        };
        let _permit = tokio::time::timeout(
            std::time::Duration::from_secs(1),
            gates.cancel_and_acquire_search(),
        )
        .await
        .expect("cancel must release the running pass");
        observer.await.expect("join");
        assert!(
            !gates.jobs().search_cancelled(),
            "flag cleared for the next pass"
        );
    }

    #[test]
    fn initial_build_guard_clears_on_drop() {
        let gates = Arc::new(IndexingSemaphores::new());
        {
            let _guard = InitialBuildGuard::start(Arc::clone(&gates));
            assert!(gates.jobs().is_initial_build());
        }
        assert!(!gates.jobs().is_initial_build());
    }

    #[tokio::test]
    async fn sessions_and_search_are_independent() {
        let gates = IndexingSemaphores::new();
        let _s = gates.try_acquire_sessions().expect("sessions");
        let _r = gates.try_acquire_search().expect("search");
    }
}
