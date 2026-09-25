//! Coordination state shared by session-index and search-index jobs.
//!
//! The semaphores in [`super::IndexingSemaphores`] guarantee mutual
//! exclusion. This module adds the signals needed to make concurrent
//! callers *cooperate* instead of racing or duplicating work:
//!
//! - **Coalescing** — callers that queued behind a running session reindex
//!   are satisfied by the next job that started after they arrived, so N
//!   concurrent requests produce at most two passes rather than N.
//! - **Initial-build signal** — readers can tell when the index is being
//!   populated from empty, and wait for it instead of reading a partial
//!   index or falling back to a full disk scan.
//! - **Search cancel / rerun** — destructive operations (full rebuild,
//!   factory reset) can stop an in-flight search pass, and a search pass
//!   requested while another is running is re-run afterwards instead of
//!   being silently dropped.

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use tokio::sync::watch;

/// Job-coordination state. One instance lives inside
/// [`super::IndexingSemaphores`].
pub struct IndexJobState {
    /// Sequence number of the most recently *started* session reindex.
    started_seq: AtomicU64,
    /// Start sequence and result of the most recently *completed* reindex.
    last_completed: Mutex<Option<(u64, (usize, usize))>>,
    /// `true` while a session reindex is populating an empty/missing index.
    initial_build: watch::Sender<bool>,
    /// Request that the running search pass stop at its next checkpoint.
    search_cancel: AtomicBool,
    /// A search pass was requested while another was running.
    search_rerun: AtomicBool,
}

impl IndexJobState {
    pub fn new() -> Self {
        let (initial_build, _) = watch::channel(false);
        Self {
            started_seq: AtomicU64::new(0),
            last_completed: Mutex::new(None),
            initial_build,
            search_cancel: AtomicBool::new(false),
            search_rerun: AtomicBool::new(false),
        }
    }

    // ── Session reindex coalescing ─────────────────────────────────

    /// Ticket identifying the point in time a caller asked for a reindex.
    pub fn arrival_ticket(&self) -> u64 {
        self.started_seq.load(Ordering::Acquire)
    }

    /// Record that a job is starting; returns its sequence number.
    pub fn begin_job(&self) -> u64 {
        self.started_seq.fetch_add(1, Ordering::AcqRel) + 1
    }

    /// Record a successful job completion.
    pub fn complete_job(&self, seq: u64, result: (usize, usize)) {
        if let Ok(mut last) = self.last_completed.lock() {
            *last = Some((seq, result));
        }
    }

    /// If a job that *started after* `ticket` has already completed, its
    /// result is at least as fresh as anything the caller could compute.
    pub fn completed_since(&self, ticket: u64) -> Option<(usize, usize)> {
        let last = self.last_completed.lock().ok()?;
        last.filter(|(seq, _)| *seq > ticket).map(|(_, r)| r)
    }

    // ── Initial build ──────────────────────────────────────────────

    pub fn set_initial_build(&self, active: bool) {
        self.initial_build.send_replace(active);
    }

    pub fn is_initial_build(&self) -> bool {
        *self.initial_build.borrow()
    }

    /// Wait until no initial (empty-index) build is running.
    pub async fn wait_initial_build(&self) {
        let mut rx = self.initial_build.subscribe();
        // `wait_for` only errors if the sender is dropped, which cannot happen
        // while `self` is alive.
        let _ = rx.wait_for(|active| !*active).await;
    }

    // ── Search pass cancel / rerun ─────────────────────────────────

    pub fn request_search_cancel(&self) {
        self.search_cancel.store(true, Ordering::Release);
    }

    pub fn clear_search_cancel(&self) {
        self.search_cancel.store(false, Ordering::Release);
    }

    pub fn search_cancelled(&self) -> bool {
        self.search_cancel.load(Ordering::Acquire)
    }

    pub fn request_search_rerun(&self) {
        self.search_rerun.store(true, Ordering::Release);
    }

    /// Consume a pending rerun request.
    pub fn take_search_rerun(&self) -> bool {
        self.search_rerun.swap(false, Ordering::AcqRel)
    }
}

impl Default for IndexJobState {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::time::Duration;

    #[test]
    fn completed_since_only_reports_jobs_started_after_ticket() {
        let state = IndexJobState::new();
        let first = state.begin_job();
        let ticket = state.arrival_ticket();
        state.complete_job(first, (1, 10));
        assert_eq!(
            state.completed_since(ticket),
            None,
            "job started before arrival"
        );

        let second = state.begin_job();
        state.complete_job(second, (0, 10));
        assert_eq!(state.completed_since(ticket), Some((0, 10)));
    }

    #[test]
    fn search_rerun_is_consumed_once() {
        let state = IndexJobState::new();
        assert!(!state.take_search_rerun());
        state.request_search_rerun();
        state.request_search_rerun();
        assert!(state.take_search_rerun());
        assert!(!state.take_search_rerun());
    }

    #[tokio::test]
    async fn wait_initial_build_resolves_when_build_finishes() {
        let state = Arc::new(IndexJobState::new());
        state.set_initial_build(true);
        let waiter = {
            let state = Arc::clone(&state);
            tokio::spawn(async move { state.wait_initial_build().await })
        };
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(!waiter.is_finished());
        state.set_initial_build(false);
        tokio::time::timeout(Duration::from_secs(1), waiter)
            .await
            .expect("waiter should resolve")
            .expect("join");
    }

    #[tokio::test]
    async fn wait_initial_build_is_immediate_when_idle() {
        let state = IndexJobState::new();
        tokio::time::timeout(Duration::from_millis(100), state.wait_initial_build())
            .await
            .expect("idle state must not block");
    }
}
