use super::fake_cli::fake_session;
use super::*;
use crate::bridge::{BridgeConnectionState, BridgeError};

#[test]
fn manager_reports_sdk_availability() {
    let (mgr, _rx, _status_rx) = BridgeManager::new();
    // SDK is always compiled in (ADR-0007).
    let status = mgr.status();
    assert_eq!(status.state, BridgeConnectionState::Disconnected);
    assert_eq!(status.active_sessions, 0);
    assert!(
        status.sdk_available,
        "sdk_available is now always true (ADR-0007)"
    );
    assert!(
        status.enabled_by_preference,
        "default reader (none installed) yields enabled=true"
    );
}

#[test]
fn manager_new_has_no_cli_url() {
    let (mgr, _rx, _status_rx) = BridgeManager::new();
    assert!(mgr.cli_url.is_none());
    assert!(mgr.connection_mode.is_none());
}

// ─── w84: SDK session hygiene — session_tasks lifecycle ───────────
//
// These tests lock in behaviour around aborting forwarder tasks and
// treating `resume_session` as idempotent when the caller is already
// tracking a session. Sessions are real `github_copilot_sdk` sessions
// attached to the scripted in-memory peer in `fake_cli`, so assertions
// see the exact JSON-RPC methods the manager drives.

/// Spawn a forever-pending tokio task that holds a oneshot sender as a
/// drop-guard. When the task is aborted, the sender is dropped, and the
/// returned receiver resolves with `Err(RecvError)` — giving the test a
/// deterministic, sleep-free signal that the abort actually ran.
fn spawn_abort_sentinel() -> (
    tokio::task::JoinHandle<()>,
    tokio::sync::oneshot::Receiver<()>,
) {
    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    let handle = tokio::spawn(async move {
        // Hold the sender so it is dropped iff the task is dropped (i.e. aborted).
        let _guard = tx;
        std::future::pending::<()>().await;
    });
    (handle, rx)
}
#[tokio::test]
async fn unlink_session_aborts_event_task_detaches_and_clears_maps() {
    let (mut mgr, _rx, _status_rx) = BridgeManager::new();
    let sid = "sess-unlink".to_string();
    let (session, fake) = fake_session(&sid).await;

    let (handle, rx) = spawn_abort_sentinel();
    mgr.event_tasks.insert(sid.clone(), handle);
    mgr.sessions.insert(sid.clone(), session);

    mgr.unlink_session(&sid).await;

    assert!(
        mgr.sessions.is_empty(),
        "sessions map must be cleared after unlink"
    );
    assert!(
        mgr.event_tasks.is_empty(),
        "event_tasks map must be cleared after unlink"
    );
    assert_eq!(fake.methods(), vec!["session.detach".to_string()]);

    // The forwarder task must actually have been aborted — wait for the
    // drop-guard sender to fire (deterministic; no real sleep required).
    let drop_observed = tokio::time::timeout(std::time::Duration::from_millis(500), rx).await;
    assert!(
        drop_observed.is_ok(),
        "event forwarder task was not aborted within 500ms"
    );
    assert!(
        drop_observed.unwrap().is_err(),
        "expected sender to be dropped (task cancelled), not completed"
    );
}
#[tokio::test]
async fn unlink_session_is_noop_when_not_tracked() {
    let (mut mgr, _rx, _status_rx) = BridgeManager::new();

    // Insert an unrelated entry to prove nothing else is touched.
    let sid_other = "sess-other".to_string();
    let (session, fake) = fake_session(&sid_other).await;
    let (handle_other, mut rx_other) = spawn_abort_sentinel();
    mgr.event_tasks.insert(sid_other.clone(), handle_other);
    mgr.sessions.insert(sid_other.clone(), session);

    mgr.unlink_session("sess-does-not-exist").await;

    assert_eq!(mgr.sessions.len(), 1, "untracked unlink must not touch map");
    assert_eq!(mgr.event_tasks.len(), 1);
    assert!(fake.methods().is_empty(), "no SDK RPC for untracked unlink");
    // The unrelated task must still be alive (sender not dropped).
    let still_alive =
        tokio::time::timeout(std::time::Duration::from_millis(100), &mut rx_other).await;
    assert!(still_alive.is_err(), "unrelated task must not be aborted");
}
#[tokio::test]
async fn destroy_session_detaches_without_writing_shutdown() {
    let (mut mgr, _rx, _status_rx) = BridgeManager::new();
    let sid = "sess-destroy".to_string();
    let (session, fake) = fake_session(&sid).await;
    let (handle, rx) = spawn_abort_sentinel();
    mgr.event_tasks.insert(sid.clone(), handle);
    mgr.sessions.insert(sid.clone(), session);

    mgr.destroy_session(&sid)
        .await
        .expect("destroy should succeed");

    assert!(mgr.sessions.is_empty());
    assert!(mgr.event_tasks.is_empty());
    // ADR-0015: detaching releases the attachment; it must never drive a
    // destroy/shutdown RPC that would end the user's session.
    assert_eq!(fake.methods(), vec!["session.detach".to_string()]);

    let drop_observed = tokio::time::timeout(std::time::Duration::from_millis(500), rx).await;
    assert!(
        drop_observed.is_ok() && drop_observed.unwrap().is_err(),
        "event forwarder task must be aborted on destroy"
    );
}
#[tokio::test]
async fn destroy_session_untracks_even_when_detach_fails() {
    let (mut mgr, _rx, _status_rx) = BridgeManager::new();
    let sid = "sess-detach-fails".to_string();
    let (session, fake) = fake_session(&sid).await;
    fake.fail("session.detach", "server went away");
    mgr.sessions.insert(sid.clone(), session);
    mgr.mark_live_session_status(&sid, crate::bridge::SessionRuntimeStatus::Running, None);

    let err = mgr
        .destroy_session(&sid)
        .await
        .expect_err("detach failure must be reported");

    assert!(matches!(err, BridgeError::Sdk(ref m) if m.contains("server went away")));
    assert!(mgr.sessions.is_empty());
    assert!(mgr.get_session_state(&sid).is_none());
}
#[tokio::test]
async fn destroy_session_is_noop_when_not_tracked() {
    let (mut mgr, _rx, _status_rx) = BridgeManager::new();
    // No entries inserted — destroy must silently succeed and not invoke SDK.
    mgr.destroy_session("sess-missing")
        .await
        .expect("destroy of unknown session must be Ok");
    assert!(mgr.sessions.is_empty());
    assert!(mgr.event_tasks.is_empty());
}
#[tokio::test]
async fn resume_session_is_idempotent_when_already_tracked() {
    let (mut mgr, _rx, _status_rx) = BridgeManager::new();
    let sid = "sess-resume".to_string();

    // Pre-populate the tracked session; `client` stays `None`. The early
    // cached-return branch must fire before any `require_client()` call,
    // otherwise this test would produce `BridgeError::NotConnected`.
    let (session, fake) = fake_session(&sid).await;
    mgr.sessions.insert(sid.clone(), session);

    let info = mgr
        .resume_session(&sid, Some("/tmp/work"), Some("gpt-5"))
        .await
        .expect("cached resume must succeed without a live client");

    assert_eq!(info.session_id, sid);
    assert!(info.is_active);
    assert_eq!(info.working_directory.as_deref(), Some("/tmp/work"));
    assert_eq!(info.model.as_deref(), Some("gpt-5"));
    assert_eq!(
        mgr.sessions.len(),
        1,
        "idempotent resume must not duplicate sessions"
    );
    assert!(
        fake.methods().is_empty(),
        "idempotent resume must not issue any SDK RPC (each resume writes session.resume)"
    );
}
#[tokio::test]
async fn abort_session_drives_session_abort_rpc() {
    let (mut mgr, _rx, _status_rx) = BridgeManager::new();
    let sid = "sess-abort".to_string();
    let (session, fake) = fake_session(&sid).await;
    mgr.sessions.insert(sid.clone(), session);

    mgr.abort_session(&sid)
        .await
        .expect("abort_session should succeed against the fake peer");

    assert_eq!(
        fake.methods(),
        vec!["session.abort".to_string()],
        "abort_session must drive exactly one session.abort RPC"
    );
}
#[tokio::test]
async fn abort_session_unknown_id_returns_session_not_found() {
    let (mgr, _rx, _status_rx) = BridgeManager::new();
    let err = mgr
        .abort_session("sess-missing")
        .await
        .expect_err("abort of unknown session must error");
    assert!(
        matches!(err, BridgeError::SessionNotFound(ref s) if s == "sess-missing"),
        "expected SessionNotFound, got {err:?}"
    );
}
