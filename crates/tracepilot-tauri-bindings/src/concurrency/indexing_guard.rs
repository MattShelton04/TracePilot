//! Per-session indexing-job guard.
//!
//! Complements the process-wide semaphore gates in
//! [`super::IndexingSemaphores`] with a finer-grained, per-`SessionId` lock.
//! Where the semaphores answer *"is any reindex running?"*, this guard
//! answers *"is a job for **this specific** session running?"* — the shape
//! a future per-session incremental indexer needs.
//!
//! Ownership semantics mirror an `OwnedSemaphorePermit`: `try_acquire`
//! returns an RAII guard, and `Drop` releases the slot so a subsequent
//! acquire for the same session can succeed. Callers receive
//! [`crate::error::BindingsError::AlreadyIndexingSession`] (which serialises
//! to the existing `ALREADY_INDEXING` IPC error code) when the session is
//! busy, so the frontend's existing retry UX continues to work without
//! changes.
//!
//! Wave 0 ships this helper as **strictly additive**; no existing call-site
//! is migrated. Later waves will swap the unit `AlreadyIndexing` semaphore
//! pattern for this guard where per-session granularity matters.

use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use tracepilot_core::ids::SessionId;

use crate::error::BindingsError;

/// Shared, process-wide registry of session IDs that currently have an
/// active indexing job. Stored in Tauri managed state as
/// `Arc<Mutex<HashSet<SessionId>>>` once a future wave wires it in.
pub type SharedIndexingState = Arc<Mutex<HashSet<SessionId>>>;

/// RAII guard for a per-session indexing job slot.
///
/// Acquired via [`IndexingJobGuard::try_acquire`]; on `Drop` the session
/// id is removed from the shared registry so the next attempt for the
/// same session succeeds. The guard holds an `Arc` clone of the registry,
/// so it is safe to outlive the `&SharedIndexingState` reference passed
/// at acquire time (e.g. moved into a `spawn_blocking` closure).
#[must_use = "dropping the guard releases the indexing slot immediately"]
#[derive(Debug)]
pub struct IndexingJobGuard {
    state: SharedIndexingState,
    session_id: SessionId,
}

impl IndexingJobGuard {
    /// Try to claim the indexing slot for `session_id`.
    ///
    /// Returns [`BindingsError::AlreadyIndexingSession`] if a job for the
    /// same session is already in flight, or
    /// [`BindingsError::Internal`] if the registry mutex was poisoned by a
    /// previous panic (should not happen in practice — recovery is left to
    /// the caller).
    pub fn try_acquire(
        state: &SharedIndexingState,
        session_id: SessionId,
    ) -> Result<Self, BindingsError> {
        let mut guard = state
            .lock()
            .map_err(|_| BindingsError::Internal("indexing-state mutex poisoned".to_string()))?;
        if guard.contains(&session_id) {
            return Err(BindingsError::AlreadyIndexingSession { session_id });
        }
        guard.insert(session_id.clone());
        drop(guard);
        Ok(Self {
            state: Arc::clone(state),
            session_id,
        })
    }

    /// Borrow the session id this guard currently holds.
    pub fn session_id(&self) -> &SessionId {
        &self.session_id
    }
}

impl Drop for IndexingJobGuard {
    fn drop(&mut self) {
        match self.state.lock() {
            Ok(mut guard) => {
                guard.remove(&self.session_id);
            }
            Err(_poisoned) => {
                tracing::warn!(
                    session_id = %self.session_id,
                    "indexing-state mutex poisoned on guard drop; slot may leak"
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ErrorCode;

    fn fresh_state() -> SharedIndexingState {
        Arc::new(Mutex::new(HashSet::new()))
    }

    fn sid(s: &str) -> SessionId {
        SessionId::from_validated(s)
    }

    #[test]
    fn acquire_succeeds_for_a_free_session() {
        let state = fresh_state();
        let guard =
            IndexingJobGuard::try_acquire(&state, sid("s1")).expect("first acquire should succeed");
        assert_eq!(guard.session_id().as_str(), "s1");
        assert!(state.lock().expect("lock").contains(&sid("s1")));
    }

    #[test]
    fn double_acquire_returns_already_indexing_session() {
        let state = fresh_state();
        let _guard =
            IndexingJobGuard::try_acquire(&state, sid("s1")).expect("first acquire should succeed");
        let err = IndexingJobGuard::try_acquire(&state, sid("s1"))
            .expect_err("second acquire should fail");
        match err {
            BindingsError::AlreadyIndexingSession { ref session_id } => {
                assert_eq!(session_id.as_str(), "s1");
            }
            other => panic!("unexpected error variant: {other:?}"),
        }
        assert_eq!(err.code(), ErrorCode::AlreadyIndexing);
    }

    #[test]
    fn drop_releases_slot_for_next_acquire() {
        let state = fresh_state();
        {
            let _guard = IndexingJobGuard::try_acquire(&state, sid("s1"))
                .expect("first acquire should succeed");
        }
        assert!(!state.lock().expect("lock").contains(&sid("s1")));
        let _again = IndexingJobGuard::try_acquire(&state, sid("s1"))
            .expect("post-drop reacquire should succeed");
    }

    #[test]
    fn distinct_sessions_do_not_block_each_other() {
        let state = fresh_state();
        let _g1 = IndexingJobGuard::try_acquire(&state, sid("s1")).expect("acquire s1");
        let _g2 = IndexingJobGuard::try_acquire(&state, sid("s2")).expect("acquire s2");
        assert_eq!(state.lock().expect("lock").len(), 2);
    }
}
