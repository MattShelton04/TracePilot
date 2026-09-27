//! Stalled real JSON-RPC peers exercise production shared-manager entry points.
use super::fake_cli::FakeCli;
use super::requests::RPC_TIMEOUT;
use super::{BridgeManager, SharedBridgeManager};
use crate::bridge::{
    BridgeConnectionState, BridgeError, BridgeMessagePayload, BridgeSessionConfig,
};
use std::time::Duration;
use tokio::time::timeout;

fn config() -> BridgeSessionConfig {
    BridgeSessionConfig {
        model: None,
        working_directory: None,
        system_message: None,
        reasoning_effort: None,
        agent: None,
    }
}

fn payload() -> BridgeMessagePayload {
    BridgeMessagePayload {
        prompt: "hello".into(),
        mode: None,
    }
}

async fn connected() -> (SharedBridgeManager, FakeCli) {
    let (mut mgr, _, _) = BridgeManager::new();
    let (client, fake) = FakeCli::start();
    mgr.client = Some(client);
    mgr.state = BridgeConnectionState::Connected;
    let bridge = SharedBridgeManager::new(mgr);
    bridge.resume_session("a", None, None).await.unwrap();
    bridge.resume_session("b", None, None).await.unwrap();
    fake.clear_calls();
    (bridge, fake)
}

#[derive(Clone, Copy, Debug)]
enum Operation {
    Create,
    Resume,
    Send,
    Query,
    Abort,
    Destroy,
}

impl Operation {
    fn method(self) -> &'static str {
        match self {
            Self::Create => "session.create",
            Self::Resume => "session.resume",
            Self::Send => "session.send",
            Self::Query => "account.getQuota",
            Self::Abort => "session.abort",
            Self::Destroy => "session.detach",
        }
    }

    async fn run(self, bridge: SharedBridgeManager) -> Result<(), BridgeError> {
        match self {
            Self::Create => bridge.create_session(config()).await.map(|_| ()),
            Self::Resume => bridge.resume_session("new", None, None).await.map(|_| ()),
            Self::Destroy => bridge.destroy_session("a").await,
            Self::Send => {
                let request = bridge.read().await.send_message("a", payload());
                request.await.map(|_| ())
            }
            Self::Query => {
                let request = bridge.read().await.get_quota();
                request.await.map(|_| ())
            }
            Self::Abort => {
                let request = bridge.read().await.abort_session("a");
                request.await
            }
        }
    }
}

async fn stalled_request_does_not_lock_manager(operation: Operation) {
    let (bridge, fake) = connected().await;
    fake.stall(operation.method());
    let request = tokio::spawn(operation.run(bridge.clone()));
    timeout(Duration::from_secs(1), fake.wait_for(operation.method()))
        .await
        .unwrap();

    // Same manager and transport, unrelated session: status and steering are
    // available while the first peer request is still unanswered.
    let foreground = bridge.read().await.get_foreground_session();
    assert!(
        timeout(Duration::from_millis(500), foreground)
            .await
            .unwrap()
            .is_ok()
    );
    if !matches!(operation, Operation::Abort) {
        let other = bridge.read().await.abort_session("b");
        assert!(
            timeout(Duration::from_millis(500), other)
                .await
                .unwrap()
                .is_ok()
        );
    } else {
        let other = bridge.read().await.send_message("b", payload());
        assert!(
            timeout(Duration::from_millis(500), other)
                .await
                .unwrap()
                .is_ok()
        );
    }
    timeout(Duration::from_secs(6), bridge.disconnect(false))
        .await
        .unwrap()
        .unwrap();
    let result = timeout(Duration::from_secs(1), request)
        .await
        .unwrap()
        .unwrap();
    assert!(
        matches!(
            result,
            Err(BridgeError::Cancelled | BridgeError::Timeout(_))
        ),
        "{operation:?}: {result:?}"
    );
    let mgr = bridge.read().await;
    assert_eq!(mgr.connection_state(), BridgeConnectionState::Disconnected);
    assert!(mgr.sessions.is_empty());
    assert!(mgr.event_tasks.is_empty());
    assert!(mgr.list_session_states().is_empty());
}

#[tokio::test]
async fn stalled_create_allows_other_session_and_disconnect() {
    stalled_request_does_not_lock_manager(Operation::Create).await;
}
#[tokio::test]
async fn stalled_resume_allows_other_session_and_disconnect() {
    stalled_request_does_not_lock_manager(Operation::Resume).await;
}
#[tokio::test]
async fn stalled_send_allows_other_session_and_disconnect() {
    stalled_request_does_not_lock_manager(Operation::Send).await;
}
#[tokio::test]
async fn stalled_query_allows_other_session_and_disconnect() {
    stalled_request_does_not_lock_manager(Operation::Query).await;
}
#[tokio::test]
async fn stalled_abort_allows_other_session_and_disconnect() {
    stalled_request_does_not_lock_manager(Operation::Abort).await;
}
#[tokio::test]
async fn stalled_destroy_allows_other_session_and_disconnect() {
    stalled_request_does_not_lock_manager(Operation::Destroy).await;
}

#[tokio::test]
async fn all_ordinary_requests_have_a_deadline_without_disconnect() {
    let mut pending = tokio::task::JoinSet::new();
    for operation in [
        Operation::Create,
        Operation::Resume,
        Operation::Send,
        Operation::Query,
        Operation::Abort,
        Operation::Destroy,
    ] {
        pending.spawn(async move {
            let (bridge, fake) = connected().await;
            fake.stall(operation.method());
            let result = timeout(
                RPC_TIMEOUT + Duration::from_secs(2),
                operation.run(bridge.clone()),
            )
            .await
            .unwrap();
            assert!(
                matches!(result, Err(BridgeError::Timeout(_))),
                "{operation:?}: {result:?}"
            );
            if matches!(operation, Operation::Destroy) {
                assert!(!bridge.read().await.is_tracked("a"));
            }
            bridge.disconnect(false).await.unwrap();
        });
    }
    while let Some(result) = pending.join_next().await {
        result.unwrap();
    }
}

#[tokio::test]
async fn unlink_cancels_a_pending_resume_without_late_publication() {
    let (bridge, fake) = connected().await;
    fake.stall("session.resume");
    let request = tokio::spawn(Operation::Resume.run(bridge.clone()));
    timeout(Duration::from_secs(1), fake.wait_for("session.resume"))
        .await
        .unwrap();
    timeout(Duration::from_secs(1), bridge.unlink_session("new"))
        .await
        .unwrap();
    assert!(matches!(
        request.await.unwrap(),
        Err(BridgeError::Cancelled)
    ));
    assert!(!bridge.read().await.is_tracked("new"));
    assert!(bridge.read().await.get_session_state("new").is_none());
    bridge.disconnect(false).await.unwrap();
}

#[tokio::test]
async fn concurrent_resume_is_idempotent_and_keeps_observer_permissions() {
    let (bridge, fake) = connected().await;
    let (first, second) = tokio::join!(
        bridge.resume_session("new", None, None),
        bridge.resume_session("new", None, None)
    );
    first.unwrap();
    second.unwrap();
    assert_eq!(
        fake.methods()
            .iter()
            .filter(|m| *m == "session.resume")
            .count(),
        1
    );
    let params = fake.last_params("session.resume").unwrap();
    assert_eq!(params["requestPermission"], false);
    assert!(params.get("streaming").is_none());
    bridge.disconnect(false).await.unwrap();
}

#[tokio::test]
async fn shared_launcher_preserves_explicit_permission_consent() {
    for approved in [false, true] {
        let (bridge, fake) = connected().await;
        bridge
            .create_launcher_session(config(), approved)
            .await
            .unwrap();
        let params = fake.last_params("session.create").unwrap();
        assert_eq!(params["requestPermission"], approved);
        bridge.disconnect(false).await.unwrap();
    }
}

#[tokio::test]
async fn disconnect_keep_live_preserves_attachment_and_its_requests() {
    let (bridge, _fake) = connected().await;
    let (client, live) = FakeCli::start();
    bridge.write().await.endpoints.insert("host".into(), client);
    bridge.attach_session("remote", "host").await.unwrap();
    live.clear_calls();
    bridge.disconnect(true).await.unwrap();
    assert!(bridge.read().await.is_tracked("remote"));
    let request = bridge.read().await.send_message("remote", payload());
    request.await.unwrap();
    assert_eq!(live.methods(), vec!["session.send"]);
    bridge.disconnect(false).await.unwrap();
}

#[tokio::test]
async fn stale_host_probe_cannot_detach_a_replacement_attachment() {
    use crate::bridge::{LiveHostState, LiveSessionHost};
    let (bridge, _fake) = connected().await;
    let (client, _live) = FakeCli::start();
    bridge.write().await.endpoints.insert("host".into(), client);
    bridge.attach_session("remote", "host").await.unwrap();
    let snapshot = bridge.attachment_snapshot().await;
    bridge.unlink_session("remote").await;
    let (client, _replacement) = FakeCli::start();
    bridge.write().await.endpoints.insert("host".into(), client);
    bridge.attach_session("remote", "host").await.unwrap();
    let hosts = [LiveSessionHost {
        session_id: "remote".into(),
        state: LiveHostState::Idle,
        pid: None,
        address: None,
        attached: false,
    }];
    bridge.reconcile_attachments(&hosts, snapshot).await;
    assert!(bridge.read().await.is_tracked("remote"));
    bridge.disconnect(false).await.unwrap();
}

#[tokio::test]
async fn deferred_owned_request_is_cancelled_before_sending_to_a_closed_session() {
    let (bridge, fake) = connected().await;
    let request = bridge.read().await.send_message("a", payload());
    bridge.destroy_session("a").await.unwrap();
    assert!(matches!(request.await, Err(BridgeError::Cancelled)));
    assert!(!fake.methods().iter().any(|m| m == "session.send"));
    bridge.disconnect(false).await.unwrap();
}

#[tokio::test]
async fn stalled_live_attach_does_not_block_local_session_or_disconnect() {
    let (bridge, _fake) = connected().await;
    let (client, live) = FakeCli::start();
    live.stall("session.resume");
    bridge.write().await.endpoints.insert("host".into(), client);
    let joining = bridge.clone();
    let attach = tokio::spawn(async move { joining.attach_session("remote", "host").await });
    timeout(Duration::from_secs(1), live.wait_for("session.resume"))
        .await
        .unwrap();
    let request = bridge.read().await.send_message("b", payload());
    timeout(Duration::from_millis(500), request)
        .await
        .unwrap()
        .unwrap();
    timeout(Duration::from_secs(1), bridge.disconnect(false))
        .await
        .unwrap()
        .unwrap();
    assert!(matches!(attach.await.unwrap(), Err(BridgeError::Cancelled)));
    assert!(bridge.read().await.sessions.is_empty());
    assert!(bridge.read().await.session_scopes.is_empty());
}

#[tokio::test]
async fn disconnect_cancels_an_attach_queued_before_any_rpc() {
    let (bridge, _fake) = connected().await;
    let (client, live) = FakeCli::start();
    bridge.write().await.endpoints.insert("host".into(), client);
    let gate = bridge.endpoint_gate("host").await;
    let joining = bridge.clone();
    let attach = tokio::spawn(async move { joining.attach_session("remote", "host").await });
    timeout(Duration::from_secs(1), async {
        while !bridge.read().await.session_scopes.contains_key("remote") {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    timeout(Duration::from_secs(1), bridge.disconnect(false))
        .await
        .unwrap()
        .unwrap();
    assert!(matches!(
        timeout(Duration::from_secs(1), attach)
            .await
            .unwrap()
            .unwrap(),
        Err(BridgeError::Cancelled)
    ));
    assert!(
        live.methods().is_empty(),
        "queued attach must not send a resume after disconnect"
    );
    drop(gate);
    let (client, _new_live) = FakeCli::start();
    bridge.write().await.endpoints.insert("host".into(), client);
    bridge.attach_session("remote", "host").await.unwrap();
    bridge.disconnect(false).await.unwrap();
}

#[test]
fn lifecycle_futures_keep_sdk_state_off_the_stack() {
    fn future_size<A, F: std::future::Future>(_: impl FnOnce(A) -> F) -> usize {
        std::mem::size_of::<F>()
    }

    // Inspect types without constructing the futures: a regression must fail
    // an assertion, rather than overflowing the test thread before it runs.
    // Leave ample room for callers, SDK polling frames, and debug-build moves
    // on an ordinary Windows thread. Nested unboxed scopes exceeded 130 KiB.
    for (operation, size) in [
        (
            "attach",
            future_size(|mgr: &'static SharedBridgeManager| mgr.attach_session("s", "address")),
        ),
        (
            "connect",
            future_size(|mgr: &'static SharedBridgeManager| {
                mgr.connect(crate::bridge::BridgeConnectConfig {
                    cli_url: None,
                    cwd: None,
                    log_level: None,
                    github_token: None,
                })
            }),
        ),
        (
            "resume",
            future_size(|mgr: &'static SharedBridgeManager| mgr.resume_session("s", None, None)),
        ),
        (
            "create",
            future_size(|mgr: &'static SharedBridgeManager| mgr.create_session(config())),
        ),
    ] {
        assert!(size < 16 * 1024, "{operation} future occupies {size} bytes");
    }
}
