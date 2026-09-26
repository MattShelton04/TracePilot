use super::attach::HOST_GONE_MESSAGE;
use super::fake_cli::FakeCli;
use super::forwarder::STATE_EMIT_INTERVAL;
use super::*;
use crate::bridge::{LiveHostState, LiveSessionHost};
use serde_json::json;
use std::time::Duration;

const ADDRESS: &str = "127.0.0.1:54618";

/// A manager whose endpoint table already holds a client for [`ADDRESS`]
/// connected to a fake peer, so `attach_session` never opens a socket.
fn manager_with_endpoint() -> (BridgeManager, broadcast::Receiver<BridgeEvent>, FakeCli) {
    let (mut mgr, events_rx, _status_rx) = BridgeManager::new();
    let (client, fake) = FakeCli::start();
    mgr.endpoints.insert(ADDRESS.to_string(), client);
    (mgr, events_rx, fake)
}

fn host(session_id: &str, state: LiveHostState, address: Option<&str>) -> LiveSessionHost {
    LiveSessionHost {
        session_id: session_id.to_string(),
        state,
        pid: Some(10552),
        address: address.map(String::from),
        attached: false,
    }
}

#[tokio::test]
async fn attach_resumes_as_observer_on_the_hosting_endpoint() {
    let (mut mgr, _events, fake) = manager_with_endpoint();

    let info = mgr
        .attach_session("tui-session", ADDRESS)
        .await
        .expect("attach against fake endpoint");

    assert!(info.is_active && info.is_remote);
    let params = fake.last_params("session.resume").expect("resume sent");
    assert_eq!(params["sessionId"], "tui-session");
    assert_eq!(params["requestPermission"], false);
    assert!(params.get("workingDirectory").is_none());
    assert!(params.get("model").is_none());
    assert_eq!(mgr.attached_session_ids(), vec!["tui-session".to_string()]);
    assert_eq!(
        mgr.get_session_state("tui-session").map(|s| s.status),
        Some(SessionRuntimeStatus::Idle)
    );
    // Renderer hydration must keep the session identified as live.
    let hydrated = mgr.hydrate().sessions;
    assert!(
        hydrated
            .iter()
            .any(|s| s.session_id == "tui-session" && s.is_remote)
    );
}

#[tokio::test]
async fn attach_waits_for_a_terminal_that_is_still_loading_the_session() {
    let (mut mgr, _events, fake) = manager_with_endpoint();
    // A freshly started terminal serves its port before the session loads.
    fake.fail_times("session.resume", "Session not found: tui-session", 2);

    let info = mgr.attach_session("tui-session", ADDRESS).await.unwrap();

    assert!(info.is_remote);
    let resumes = fake
        .methods()
        .into_iter()
        .filter(|m| m == "session.resume")
        .count();
    assert_eq!(resumes, 3);
}

#[tokio::test]
async fn attach_does_not_retry_other_resume_failures() {
    let (mut mgr, _events, fake) = manager_with_endpoint();
    fake.fail("session.resume", "boom");

    assert!(mgr.attach_session("tui-session", ADDRESS).await.is_err());

    assert_eq!(fake.methods(), vec!["session.resume".to_string()]);
    assert!(mgr.endpoints.is_empty());
}

#[tokio::test]
async fn attach_is_idempotent_and_never_resumes_twice() {
    let (mut mgr, _events, fake) = manager_with_endpoint();
    mgr.attach_session("tui-session", ADDRESS).await.unwrap();
    fake.clear_calls();

    let again = mgr.attach_session("tui-session", ADDRESS).await.unwrap();

    assert!(again.is_remote);
    assert!(
        fake.methods().is_empty(),
        "no RPC on re-attach: {:?}",
        fake.methods()
    );
}

#[tokio::test]
async fn attach_respects_the_preference_guard() {
    let (mut mgr, _events, fake) = manager_with_endpoint();
    mgr.set_preference_reader(Arc::new(|| false));

    let err = mgr
        .attach_session("tui-session", ADDRESS)
        .await
        .unwrap_err();

    assert!(matches!(err, BridgeError::DisabledByPreference));
    assert!(fake.methods().is_empty());
}

#[tokio::test]
async fn detaching_the_last_session_closes_the_endpoint_client() {
    let (mut mgr, _events, fake) = manager_with_endpoint();
    mgr.attach_session("a", ADDRESS).await.unwrap();
    mgr.attach_session("b", ADDRESS).await.unwrap();

    mgr.unlink_session("a").await;
    assert!(
        mgr.endpoints.contains_key(ADDRESS),
        "endpoint still serves b"
    );
    assert_eq!(mgr.attached_session_ids(), vec!["b".to_string()]);

    mgr.destroy_session("b").await.unwrap();
    assert!(mgr.endpoints.is_empty());
    assert!(mgr.attached_session_ids().is_empty());
    let detached: Vec<_> = fake
        .methods()
        .into_iter()
        .filter(|m| m == "session.detach")
        .collect();
    assert_eq!(detached.len(), 2);
}

#[tokio::test]
async fn detach_is_bounded_when_the_terminal_died() {
    let (mut mgr, _events, fake) = manager_with_endpoint();
    mgr.attach_session("s", ADDRESS).await.unwrap();
    // A closed or Ctrl+C'd terminal never answers the detach request.
    fake.stall("session.detach");

    tokio::time::timeout(Duration::from_secs(5), mgr.unlink_session("s"))
        .await
        .expect("detach must not wedge the manager");

    assert!(!mgr.is_tracked("s"));
    assert!(mgr.attached_session_ids().is_empty());
    assert!(mgr.endpoints.is_empty());
    assert!(mgr.get_session_state("s").is_none());
}

#[tokio::test]
async fn disconnecting_the_bridge_can_keep_terminal_attachments() {
    let (mut mgr, _events, _fake) = manager_with_endpoint();
    mgr.attach_session("s", ADDRESS).await.unwrap();

    mgr.disconnect_keep_live().await.unwrap();
    assert!(mgr.is_tracked("s"));
    assert!(mgr.endpoints.contains_key(ADDRESS));
    assert!(mgr.get_session_state("s").is_some());

    mgr.disconnect().await.unwrap();
    assert!(!mgr.is_tracked("s"));
    assert!(mgr.endpoints.is_empty());
}

#[tokio::test]
async fn reconcile_drops_attachments_whose_host_went_away() {
    let (mut mgr, _events, _fake) = manager_with_endpoint();
    let mut states = mgr.subscribe_session_state();
    mgr.attach_session("still-live", ADDRESS).await.unwrap();
    mgr.attach_session("gone", ADDRESS).await.unwrap();
    while states.try_recv().is_ok() {}

    let dropped = mgr
        .reconcile_attachments(&[
            host("still-live", LiveHostState::Attachable, Some(ADDRESS)),
            host("gone", LiveHostState::Idle, None),
            host("never-attached", LiveHostState::Running, None),
        ])
        .await;

    assert_eq!(dropped, vec!["gone".to_string()]);
    assert_eq!(mgr.attached_session_ids(), vec!["still-live".to_string()]);
    assert!(mgr.endpoints.contains_key(ADDRESS));
    let terminal = states.try_recv().expect("terminal snapshot for gone");
    assert_eq!(terminal.session_id, "gone");
    assert_eq!(terminal.status, SessionRuntimeStatus::Shutdown);
    assert_eq!(terminal.last_error.as_deref(), Some(HOST_GONE_MESSAGE));
    assert!(mgr.get_session_state("gone").is_none());
}

#[tokio::test]
async fn reconcile_drops_attachment_when_the_session_moved_endpoint() {
    let (mut mgr, _events, _fake) = manager_with_endpoint();
    mgr.attach_session("s", ADDRESS).await.unwrap();

    let dropped = mgr
        .reconcile_attachments(&[host(
            "s",
            LiveHostState::Attachable,
            Some("127.0.0.1:60000"),
        )])
        .await;

    assert_eq!(dropped, vec!["s".to_string()]);
    assert!(mgr.endpoints.is_empty());
}

#[tokio::test]
async fn stale_attachments_names_only_attached_sessions_that_moved_or_ended() {
    let (mut mgr, _events, _fake) = manager_with_endpoint();
    mgr.attach_session("live", ADDRESS).await.unwrap();
    mgr.attach_session("gone", ADDRESS).await.unwrap();

    let stale = mgr.stale_attachments(&[
        host("live", LiveHostState::Attachable, Some(ADDRESS)),
        host("gone", LiveHostState::Idle, None),
        host("never-attached", LiveHostState::Idle, None),
    ]);

    assert_eq!(stale, vec!["gone".to_string()]);
    assert!(!mgr.has_finished_sessions());
}

#[tokio::test]
async fn mark_attached_flags_tracked_sessions() {
    let (mut mgr, _events, _fake) = manager_with_endpoint();
    mgr.attach_session("s", ADDRESS).await.unwrap();
    let mut hosts = vec![
        host("s", LiveHostState::Attachable, Some(ADDRESS)),
        host("other", LiveHostState::Attachable, Some(ADDRESS)),
    ];

    mgr.mark_attached(&mut hosts);

    assert!(hosts[0].attached);
    assert!(!hosts[1].attached);
}

#[tokio::test]
async fn forwarder_coalesces_streaming_snapshots_and_trims_diagnostics() {
    let (mut mgr, mut events, fake) = manager_with_endpoint();
    let mut states = mgr.subscribe_session_state();
    mgr.attach_session("s", ADDRESS).await.unwrap();
    while states.try_recv().is_ok() {}

    fake.push_event(
        "s",
        "tool.execution_start",
        json!({ "toolCallId": "c1", "toolName": "powershell" }),
    );
    let mut output = String::new();
    for i in 0..20 {
        output.push_str(&format!("tick {i}\n"));
        fake.push_event(
            "s",
            "tool.execution_partial_result",
            json!({ "toolCallId": "c1", "partialOutput": output }),
        );
    }
    fake.push_event(
        "s",
        "model.messages_snapshot",
        json!({ "messages": ["huge"] }),
    );

    // Every raw event is forwarded; diagnostics lose their payload.
    let mut raw = Vec::new();
    while raw.len() < 22 {
        let event = tokio::time::timeout(Duration::from_secs(2), events.recv())
            .await
            .expect("raw event within 2s")
            .expect("channel open");
        raw.push(event);
    }
    let diagnostic = raw.last().unwrap();
    assert_eq!(diagnostic.event_type, "model.messages_snapshot");
    assert_eq!(diagnostic.data, json!({ "omitted": true }));

    // Snapshots are coalesced, and the trailing flush carries the final output.
    tokio::time::sleep(STATE_EMIT_INTERVAL * 3).await;
    let mut snapshots = Vec::new();
    while let Ok(state) = states.try_recv() {
        snapshots.push(state);
    }
    assert!(
        snapshots.len() < 21,
        "expected coalescing, got {} snapshots",
        snapshots.len()
    );
    let last_tool = snapshots
        .iter()
        .rev()
        .find_map(|s| s.tools.first().cloned())
        .expect("tool snapshot");
    assert_eq!(
        last_tool.partial_result,
        Some(serde_json::Value::String(output))
    );
}
