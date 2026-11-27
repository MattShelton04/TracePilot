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
//! - **On-demand build claims** — index readers start at most one build per
//!   index path, so an index that stays empty (no sessions yet) or cannot be
//!   built is not rebuilt on every read.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use tokio::sync::watch;
use tracepilot_indexer::SourceGenerations;

/// Job-coordination state. One instance lives inside
/// [`super::IndexingSemaphores`].
pub struct IndexJobState {
    /// Invalidates work queued before a reset or root relocation.
    generation: AtomicU64,
    /// Per-source configuration generations: index writes for a source
    /// commit only while the generation their pass captured is current.
    source_generations: Arc<SourceGenerations>,
    /// Sequence number of the most recently *started* session reindex.
    started_seq: AtomicU64,
    /// Start sequence and result of the most recently *completed* reindex.
    last_completed: Mutex<Option<(u64, (usize, usize))>>,
    /// `true` while a session reindex is populating an empty/missing index.
    initial_build: watch::Sender<bool>,
    /// Request that the running search pass stop at its next checkpoint.
    search_cancel: AtomicBool,
    /// A search pass was requested while another was running.
    search_rerun: AtomicU64,
    /// Bumped by anything that may leave search content stale.
    search_dirty_epoch: AtomicU64,
    /// The dirty epoch a search pass that missed nothing last started at.
    search_clean_epoch: AtomicU64,
    /// Index paths a reader has already tried to build on demand.
    on_demand_builds: Mutex<HashSet<PathBuf>>,
}

impl IndexJobState {
    pub fn new() -> Self {
        let (initial_build, _) = watch::channel(false);
        Self {
            generation: AtomicU64::new(1),
            source_generations: Arc::default(),
            started_seq: AtomicU64::new(0),
            last_completed: Mutex::new(None),
            initial_build,
            search_cancel: AtomicBool::new(false),
            search_rerun: AtomicU64::new(0),
            // Dirty until a pass in this process has checked every session:
            // the index may come from another build or an interrupted pass.
            search_dirty_epoch: AtomicU64::new(1),
            search_clean_epoch: AtomicU64::new(0),
            on_demand_builds: Mutex::new(HashSet::new()),
        }
    }

    // ── Session reindex coalescing ─────────────────────────────────

    pub fn generation(&self) -> u64 {
        self.generation.load(Ordering::Acquire)
    }

    pub fn source_generations(&self) -> &Arc<SourceGenerations> {
        &self.source_generations
    }

    /// Caller must hold both indexing permits before invalidating work.
    pub fn invalidate(&self) {
        self.generation.fetch_add(1, Ordering::AcqRel);
        *self
            .last_completed
            .lock()
            .unwrap_or_else(|p| p.into_inner()) = None;
        self.on_demand_builds
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clear();
        self.search_rerun.store(0, Ordering::Release);
        self.mark_search_dirty();
    }

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

    /// Claim the one reader-triggered build allowed for `index_path`.
    ///
    /// Returns `false` if a reader already tried. Explicit reindex commands
    /// do not use this and always run.
    pub fn claim_on_demand_build(&self, index_path: &Path) -> bool {
        self.on_demand_builds
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .insert(index_path.to_path_buf())
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

    pub fn request_search_rerun(&self, generation: u64) {
        // A delayed old request must not overwrite a newer generation's signal.
        self.search_rerun.fetch_max(generation, Ordering::AcqRel);
    }

    /// Consume a pending rerun request.
    pub fn take_search_rerun(&self, generation: u64) -> bool {
        self.search_rerun
            .compare_exchange(generation, 0, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    }

    // ── Search freshness ───────────────────────────────────────────
    //
    // A search pass stats every session even when nothing changed. These
    // epochs let a session reindex that indexed nothing skip it: only
    // indexing a session, or a pass that missed some, can leave search
    // content stale.

    /// Something may have left search content stale (sessions indexed, a
    /// source changed, a rebuild, a reset).
    pub fn mark_search_dirty(&self) {
        self.search_dirty_epoch.fetch_add(1, Ordering::AcqRel);
    }

    /// The epoch a search pass starts at, captured before it reads anything.
    pub fn search_epoch(&self) -> u64 {
        self.search_dirty_epoch.load(Ordering::Acquire)
    }

    /// A pass that started at `epoch` indexed or found fresh every session.
    pub fn mark_search_clean(&self, epoch: u64) {
        self.search_clean_epoch.fetch_max(epoch, Ordering::AcqRel);
    }

    /// No search pass is needed until something marks search dirty.
    pub fn search_known_clean(&self) -> bool {
        self.search_clean_at().is_some()
    }

    /// The epoch search content is known clean at, if it is.
    pub fn search_clean_at(&self) -> Option<u64> {
        let epoch = self.search_epoch();
        (self.search_clean_epoch.load(Ordering::Acquire) == epoch).then_some(epoch)
    }

    /// Mark search dirty for the sessions a pass indexed, which was clean at
    /// `clean_at` when the pass started. Returns the new epoch when nothing
    /// else marked it dirty since: writing those sessions' search content
    /// then covers everything, and a pass that does may mark that epoch clean.
    pub fn mark_search_dirty_since(&self, clean_at: Option<u64>) -> Option<u64> {
        let epoch = self.search_dirty_epoch.fetch_add(1, Ordering::AcqRel) + 1;
        clean_at.filter(|clean| clean + 1 == epoch).map(|_| epoch)
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
    fn search_is_clean_only_after_a_pass_that_started_after_the_last_change() {
        let state = IndexJobState::new();
        assert!(!state.search_known_clean(), "dirty at startup");
        let epoch = state.search_epoch();
        state.mark_search_clean(epoch);
        assert!(state.search_known_clean());

        // Sessions indexed while a pass runs: that pass can't certify them.
        let running = state.search_epoch();
        state.mark_search_dirty();
        state.mark_search_clean(running);
        assert!(!state.search_known_clean());
        state.mark_search_clean(state.search_epoch());
        assert!(state.search_known_clean());

        state.invalidate();
        assert!(!state.search_known_clean(), "a reset makes search dirty");
    }

    #[test]
    fn a_pass_covers_search_only_when_nothing_else_dirtied_it_meanwhile() {
        let state = IndexJobState::new();
        assert_eq!(state.search_clean_at(), None);
        assert_eq!(state.mark_search_dirty_since(None), None, "dirty at start");

        state.mark_search_clean(state.search_epoch());
        let clean = state.search_clean_at();
        let epoch = state.mark_search_dirty_since(clean);
        assert_eq!(epoch, Some(state.search_epoch()));
        state.mark_search_clean(epoch.unwrap());
        assert!(state.search_known_clean());

        // A source enabled while the pass ran.
        let clean = state.search_clean_at();
        state.mark_search_dirty();
        assert_eq!(state.mark_search_dirty_since(clean), None);
    }

    #[test]
    fn on_demand_build_is_claimed_once_per_path() {
        let state = IndexJobState::new();
        assert!(state.claim_on_demand_build(Path::new("a/index.db")));
        assert!(!state.claim_on_demand_build(Path::new("a/index.db")));
        assert!(state.claim_on_demand_build(Path::new("b/index.db")));
    }

    #[test]
    fn search_rerun_is_consumed_once() {
        let state = IndexJobState::new();
        let generation = state.generation();
        assert!(!state.take_search_rerun(generation));
        state.request_search_rerun(generation);
        state.request_search_rerun(generation);
        assert!(state.take_search_rerun(generation));
        assert!(!state.take_search_rerun(generation));
    }

    #[test]
    fn reset_clears_completion_and_claims_without_old_jobs_consuming_new_reruns() {
        let state = IndexJobState::new();
        let old = state.generation();
        let seq = state.begin_job();
        state.complete_job(seq, (1, 1));
        assert!(state.claim_on_demand_build(Path::new("index.db")));
        state.request_search_rerun(old);
        state.invalidate();
        let current = state.generation();
        assert_ne!(old, current);
        assert_eq!(state.completed_since(0), None);
        assert!(state.claim_on_demand_build(Path::new("index.db")));
        assert!(!state.take_search_rerun(old));
        state.request_search_rerun(current);
        state.request_search_rerun(old);
        assert!(!state.take_search_rerun(old));
        assert!(state.take_search_rerun(current));
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
