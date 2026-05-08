//! B2-B: bridge concurrency hardening (DEEP-01 / DEEP-05 / DEEP-06).
//!
//! Three deterministic tests pinning the rubber-duck invariants:
//!
//!   1. `unlink_session` actually awaits the forwarder abort (drop-guard
//!      flag must fire before `unlink_session` returns).
//!   2. After unlink the live-state slot is gone, and a teardown-path
//!      `mark_existing` cannot resurrect it.
//!   3. `disconnect()` returns promptly (bounded by an outer 1s timeout)
//!      and leaves every map empty.
//!
//! All synchronization is event-based (drop-guards, JoinHandle await,
//! `tokio::time::timeout` only as a hang-bound). No `tokio::sleep`s.

use super::BridgeManager;
use crate::bridge::live_state::SessionRuntimeStatus;
use crate::bridge::{BridgeConnectionState, BridgeEvent};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

fn stub_session(id: &str) -> Arc<copilot_sdk::Session> {
    Arc::new(copilot_sdk::Session::new(
        id.to_string(),
        None,
        |_method, _params| Box::pin(async { Ok(serde_json::Value::Null) }),
    ))
}

/// Forever-pending tokio task that signals via a `Drop` guard. The flag
/// flips inside `Drop`, which `unlink_session` / `disconnect` must observe
/// synchronously before they return — proving the abort was awaited.
fn spawn_drop_guard_task() -> (tokio::task::JoinHandle<()>, Arc<AtomicBool>) {
    struct Guard(Arc<AtomicBool>);
    impl Drop for Guard {
        fn drop(&mut self) {
            self.0.store(true, Ordering::SeqCst);
        }
    }

    let flag = Arc::new(AtomicBool::new(false));
    let guard = Guard(Arc::clone(&flag));
    let handle = tokio::spawn(async move {
        let _g = guard;
        std::future::pending::<()>().await;
    });
    (handle, flag)
}

#[tokio::test]
async fn unlink_session_awaits_forwarder_abort_via_drop_guard() {
    let (mut mgr, _rx, _status_rx) = BridgeManager::new();
    let sid = "sess-drop-guard".to_string();

    let (handle, flag) = spawn_drop_guard_task();
    mgr.event_tasks.insert(sid.clone(), handle);
    mgr.sessions.insert(sid.clone(), stub_session(&sid));
    mgr.mark_live_session_status(&sid, SessionRuntimeStatus::Running, None);
    assert!(mgr.get_session_state(&sid).is_some());

    mgr.unlink_session(&sid).await;

    assert!(
        flag.load(Ordering::SeqCst),
        "forwarder task drop-guard did not fire — abort was not awaited"
    );
    assert!(
        mgr.get_session_state(&sid).is_none(),
        "live-state slot must be removed after unlink"
    );
}

#[tokio::test]
async fn unlinked_session_slot_is_not_resurrected_by_teardown_mark() {
    let (mut mgr, _rx, _status_rx) = BridgeManager::new();
    let sid = "sess-stale".to_string();

    let (handle, _flag) = spawn_drop_guard_task();
    mgr.event_tasks.insert(sid.clone(), handle);
    mgr.sessions.insert(sid.clone(), stub_session(&sid));
    mgr.mark_live_session_status(&sid, SessionRuntimeStatus::Running, None);

    mgr.unlink_session(&sid).await;
    assert!(mgr.get_session_state(&sid).is_none());

    // The contract for teardown paths: `mark_existing` must NEVER resurrect
    // a removed slot. (`apply_event` is allowed to re-create on first touch
    // per DEEP-01 invariant 6, but invariant 1 — abort+await before remove —
    // ensures no real forwarder can call it after unlink.)
    let resurrected = mgr
        .live_state
        .mark_existing(&sid, SessionRuntimeStatus::Shutdown, None);
    assert!(
        resurrected.is_none(),
        "mark_existing must return None for a removed session — never resurrect"
    );
    assert!(
        mgr.get_session_state(&sid).is_none(),
        "slot must remain absent after a teardown-path mark_existing call"
    );

    // Sanity: a fresh `apply_event` (i.e. the create-on-first-touch path
    // a brand-new session would take) does still create a slot, since
    // `apply_event` keeps insert-or-create semantics by design.
    let event = BridgeEvent {
        session_id: "fresh-session".into(),
        event_type: "session.idle".into(),
        timestamp: "2026-05-08T00:00:00Z".into(),
        id: Some("evt-1".into()),
        parent_id: None,
        ephemeral: false,
        data: serde_json::json!({}),
    };
    mgr.live_state.apply_event(&event);
    assert!(mgr.get_session_state("fresh-session").is_some());
}

#[tokio::test]
async fn disconnect_completes_promptly_and_clears_all_state() {
    let (mut mgr, _rx, _status_rx) = BridgeManager::new();

    for i in 0..2 {
        let sid = format!("sess-disc-{i}");
        let (handle, _flag) = spawn_drop_guard_task();
        mgr.event_tasks.insert(sid.clone(), handle);
        mgr.sessions.insert(sid.clone(), stub_session(&sid));
        mgr.mark_live_session_status(&sid, SessionRuntimeStatus::Running, None);
    }
    assert_eq!(mgr.event_tasks.len(), 2);
    assert_eq!(mgr.sessions.len(), 2);
    assert_eq!(mgr.list_session_states().len(), 2);

    let result = tokio::time::timeout(std::time::Duration::from_secs(1), mgr.disconnect()).await;

    assert!(
        result.is_ok(),
        "disconnect did not return within 1s — likely waiting on natural forwarder drain"
    );
    result.unwrap().expect("disconnect must report Ok");

    assert!(mgr.event_tasks.is_empty(), "event_tasks must be drained");
    assert!(mgr.sessions.is_empty(), "sessions must be drained");
    assert!(
        mgr.list_session_states().is_empty(),
        "live-state must be cleared on disconnect"
    );
    assert_eq!(mgr.connection_state(), BridgeConnectionState::Disconnected);
}
