use super::*;
use crate::bridge::{BridgeConnectConfig, BridgeConnectionState, BridgeError};

#[test]
fn manager_reports_sdk_availability() {
    let (mgr, _rx, _status_rx) = BridgeManager::new();
    // Availability depends on compile-time feature
    let status = mgr.status();
    assert_eq!(status.state, BridgeConnectionState::Disconnected);
    assert_eq!(status.active_sessions, 0);
}

#[tokio::test]
async fn connect_without_feature_returns_not_available() {
    let (mut mgr, _rx, _status_rx) = BridgeManager::new();
    if !mgr.is_sdk_available() {
        let result = mgr
            .connect(BridgeConnectConfig {
                cli_url: None,
                cwd: None,
                log_level: None,
                github_token: None,
            })
            .await;
        assert!(matches!(result, Err(BridgeError::NotAvailable)));
    }
}

#[test]
fn manager_new_has_no_cli_url() {
    let (mgr, _rx, _status_rx) = BridgeManager::new();
    assert!(mgr.cli_url.is_none());
    assert!(mgr.connection_mode.is_none());
}

// ─── raw_rpc_call tests ───────────────────────────────────────────

/// Helper: starts a minimal Content-Length framed JSON-RPC server that
/// returns a canned response for the first request, then shuts down.
#[cfg(feature = "copilot-sdk")]
async fn mock_jsonrpc_server(response: serde_json::Value) -> (tokio::net::TcpListener, String) {
    use tokio::net::TcpListener;

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap().to_string();
    let response_clone = response.clone();

    tokio::spawn(async move {
        use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};

        let (stream, _) = listener.accept().await.unwrap();
        let mut reader = BufReader::new(stream);

        // Read headers
        let mut content_length: usize = 0;
        loop {
            let mut line = String::new();
            reader.read_line(&mut line).await.unwrap();
            let trimmed = line.trim();
            if trimmed.is_empty() {
                break;
            }
            if let Some(len_str) = trimmed.strip_prefix("Content-Length:") {
                content_length = len_str.trim().parse().unwrap();
            }
        }

        // Read body
        let mut body_buf = vec![0u8; content_length];
        reader.read_exact(&mut body_buf).await.unwrap();

        let request: serde_json::Value = serde_json::from_slice(&body_buf).unwrap();

        // Build JSON-RPC response with matching id
        let resp = serde_json::json!({
            "jsonrpc": "2.0",
            "id": request.get("id").cloned().unwrap_or(serde_json::json!(1)),
            "result": response_clone,
        });

        let resp_str = serde_json::to_string(&resp).unwrap();
        let msg = format!("Content-Length: {}\r\n\r\n{}", resp_str.len(), resp_str);
        reader.get_mut().write_all(msg.as_bytes()).await.unwrap();
    });

    // Return the listener (to keep it alive) and address
    let addr_for_caller = addr.clone();
    // We need to return something that keeps the spawned task's listener alive.
    // The listener is moved into the spawned task, so we just return the address.
    // Bind a new reference to keep things tidy:
    let listener2 = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    (listener2, addr_for_caller)
}

/// Helper: starts a JSON-RPC server that returns an error.
#[cfg(feature = "copilot-sdk")]
async fn mock_jsonrpc_error_server(code: i64, message: &str) -> String {
    use tokio::net::TcpListener;

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap().to_string();
    let msg_owned = message.to_string();

    tokio::spawn(async move {
        use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};

        let (stream, _) = listener.accept().await.unwrap();
        let mut reader = BufReader::new(stream);

        let mut content_length: usize = 0;
        loop {
            let mut line = String::new();
            reader.read_line(&mut line).await.unwrap();
            let trimmed = line.trim();
            if trimmed.is_empty() {
                break;
            }
            if let Some(len_str) = trimmed.strip_prefix("Content-Length:") {
                content_length = len_str.trim().parse().unwrap();
            }
        }

        let mut body_buf = vec![0u8; content_length];
        reader.read_exact(&mut body_buf).await.unwrap();

        let request: serde_json::Value = serde_json::from_slice(&body_buf).unwrap();

        let resp = serde_json::json!({
            "jsonrpc": "2.0",
            "id": request.get("id").cloned().unwrap_or(serde_json::json!(1)),
            "error": {
                "code": code,
                "message": msg_owned,
            },
        });

        let resp_str = serde_json::to_string(&resp).unwrap();
        let msg = format!("Content-Length: {}\r\n\r\n{}", resp_str.len(), resp_str);
        reader.get_mut().write_all(msg.as_bytes()).await.unwrap();
    });

    addr
}

#[cfg(feature = "copilot-sdk")]
#[tokio::test]
async fn raw_rpc_call_success_returns_result() {
    use super::raw_rpc::raw_rpc_call;
    let expected = serde_json::json!({ "modelId": "gpt-4.1" });
    let (_keep, addr) = mock_jsonrpc_server(expected.clone()).await;

    let result = raw_rpc_call(
        &addr,
        "session.model.getCurrent",
        serde_json::json!({ "sessionId": "test-123" }),
    )
    .await
    .expect("should succeed");

    assert_eq!(result, expected);
}

#[cfg(feature = "copilot-sdk")]
#[tokio::test]
async fn raw_rpc_call_null_result() {
    use super::raw_rpc::raw_rpc_call;
    let (_keep, addr) = mock_jsonrpc_server(serde_json::Value::Null).await;

    let result = raw_rpc_call(
        &addr,
        "session.model.switchTo",
        serde_json::json!({ "sessionId": "test-123", "modelId": "gpt-4.1" }),
    )
    .await
    .expect("should succeed");

    assert_eq!(result, serde_json::Value::Null);
}

#[cfg(feature = "copilot-sdk")]
#[tokio::test]
async fn raw_rpc_call_error_response() {
    use super::raw_rpc::raw_rpc_call;
    let addr = mock_jsonrpc_error_server(-32601, "Unhandled method").await;

    let result = raw_rpc_call(
        &addr,
        "session.model.switch_to",
        serde_json::json!({ "sessionId": "test-123" }),
    )
    .await;

    assert!(result.is_err());
    let err = result.unwrap_err().to_string();
    assert!(err.contains("-32601"), "error should contain code: {err}");
    assert!(
        err.contains("Unhandled method"),
        "error should contain message: {err}"
    );
}

#[cfg(feature = "copilot-sdk")]
#[tokio::test]
async fn raw_rpc_call_connection_refused() {
    use super::raw_rpc::raw_rpc_call;
    // Use a port that's extremely unlikely to be listening
    let result = raw_rpc_call("127.0.0.1:1", "test.method", serde_json::json!({})).await;

    assert!(result.is_err());
    let err = result.unwrap_err().to_string();
    assert!(
        err.contains("TCP connect"),
        "error should mention TCP connect: {err}"
    );
}

#[cfg(feature = "copilot-sdk")]
#[tokio::test]
async fn raw_rpc_call_parses_http_prefix() {
    use super::raw_rpc::raw_rpc_call;
    let expected = serde_json::json!("ok");
    let (_keep, addr) = mock_jsonrpc_server(expected.clone()).await;

    let url_with_http = format!("http://{}", addr);
    let result = raw_rpc_call(&url_with_http, "test.method", serde_json::json!({}))
        .await
        .expect("should handle http:// prefix");

    assert_eq!(result, expected);
}

#[cfg(feature = "copilot-sdk")]
#[tokio::test]
async fn raw_rpc_call_parses_ws_prefix() {
    use super::raw_rpc::raw_rpc_call;
    let expected = serde_json::json!("ok");
    let (_keep, addr) = mock_jsonrpc_server(expected.clone()).await;

    let url_with_ws = format!("ws://{}", addr);
    let result = raw_rpc_call(&url_with_ws, "test.method", serde_json::json!({}))
        .await
        .expect("should handle ws:// prefix");

    assert_eq!(result, expected);
}

// ─── w84: SDK subprocess hygiene — session_tasks lifecycle ─────────
//
// These tests lock in behaviour around aborting forwarder tasks and
// treating `resume_session` as idempotent when the caller is already
// tracking a session. They fabricate stub `copilot_sdk::Session`
// handles with a tracked `invoke_fn` so we can assert which JSON-RPC
// methods the manager drives without spawning a real CLI subprocess.

#[cfg(feature = "copilot-sdk")]
fn stub_session(id: &str) -> std::sync::Arc<copilot_sdk::Session> {
    std::sync::Arc::new(copilot_sdk::Session::new(
        id.to_string(),
        None,
        |_method, _params| Box::pin(async { Ok(serde_json::Value::Null) }),
    ))
}

#[cfg(feature = "copilot-sdk")]
type InvokeLog = std::sync::Arc<std::sync::Mutex<Vec<String>>>;

#[cfg(feature = "copilot-sdk")]
fn stub_session_with_log(id: &str) -> (std::sync::Arc<copilot_sdk::Session>, InvokeLog) {
    let log: InvokeLog = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let log_for_closure = std::sync::Arc::clone(&log);
    let session = std::sync::Arc::new(copilot_sdk::Session::new(
        id.to_string(),
        None,
        move |method, _params| {
            let method = method.to_string();
            let log = std::sync::Arc::clone(&log_for_closure);
            Box::pin(async move {
                log.lock().unwrap().push(method);
                Ok(serde_json::Value::Null)
            })
        },
    ));
    (session, log)
}

/// Spawn a forever-pending tokio task that holds a oneshot sender as a
/// drop-guard. When the task is aborted, the sender is dropped, and the
/// returned receiver resolves with `Err(RecvError)` — giving the test a
/// deterministic, sleep-free signal that the abort actually ran.
#[cfg(feature = "copilot-sdk")]
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

#[cfg(feature = "copilot-sdk")]
#[tokio::test]
async fn unlink_session_aborts_event_task_and_clears_maps() {
    let (mut mgr, _rx, _status_rx) = BridgeManager::new();
    let sid = "sess-unlink".to_string();

    let (handle, rx) = spawn_abort_sentinel();
    mgr.event_tasks.insert(sid.clone(), handle);
    mgr.sessions.insert(sid.clone(), stub_session(&sid));

    mgr.unlink_session(&sid);

    assert!(
        mgr.sessions.is_empty(),
        "sessions map must be cleared after unlink"
    );
    assert!(
        mgr.event_tasks.is_empty(),
        "event_tasks map must be cleared after unlink"
    );

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

#[cfg(feature = "copilot-sdk")]
#[tokio::test]
async fn unlink_session_is_noop_when_not_tracked() {
    let (mut mgr, _rx, _status_rx) = BridgeManager::new();

    // Insert an unrelated entry to prove nothing else is touched.
    let sid_other = "sess-other".to_string();
    let (handle_other, mut rx_other) = spawn_abort_sentinel();
    mgr.event_tasks.insert(sid_other.clone(), handle_other);
    mgr.sessions.insert(sid_other.clone(), stub_session(&sid_other));

    mgr.unlink_session("sess-does-not-exist");

    assert_eq!(mgr.sessions.len(), 1, "untracked unlink must not touch map");
    assert_eq!(mgr.event_tasks.len(), 1);
    // The unrelated task must still be alive (sender not dropped).
    let still_alive = tokio::time::timeout(
        std::time::Duration::from_millis(100),
        &mut rx_other,
    )
    .await;
    assert!(still_alive.is_err(), "unrelated task must not be aborted");
}

#[cfg(feature = "copilot-sdk")]
#[tokio::test]
async fn destroy_session_aborts_event_task_and_invokes_session_destroy() {
    let (mut mgr, _rx, _status_rx) = BridgeManager::new();
    let sid = "sess-destroy".to_string();

    let (session, log) = stub_session_with_log(&sid);
    let (handle, rx) = spawn_abort_sentinel();
    mgr.event_tasks.insert(sid.clone(), handle);
    mgr.sessions.insert(sid.clone(), session);

    mgr.destroy_session(&sid).await.expect("destroy should succeed");

    assert!(mgr.sessions.is_empty());
    assert!(mgr.event_tasks.is_empty());

    // SDK-side destroy RPC must have been driven.
    let calls = log.lock().unwrap().clone();
    assert!(
        calls.iter().any(|m| m == "session.destroy"),
        "expected session.destroy RPC, saw: {calls:?}"
    );

    let drop_observed = tokio::time::timeout(std::time::Duration::from_millis(500), rx).await;
    assert!(
        drop_observed.is_ok() && drop_observed.unwrap().is_err(),
        "event forwarder task must be aborted on destroy"
    );
}

#[cfg(feature = "copilot-sdk")]
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

#[cfg(feature = "copilot-sdk")]
#[tokio::test]
async fn resume_session_is_idempotent_when_already_tracked() {
    let (mut mgr, _rx, _status_rx) = BridgeManager::new();
    let sid = "sess-resume".to_string();

    // Pre-populate the tracked session; `client` stays `None`. The early
    // cached-return branch must fire before any `require_client()` call,
    // otherwise this test would produce `BridgeError::NotConnected`.
    let (session, log) = stub_session_with_log(&sid);
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
        log.lock().unwrap().is_empty(),
        "idempotent resume must not issue any SDK RPC"
    );
}

#[cfg(feature = "copilot-sdk")]
#[tokio::test]
async fn abort_session_drives_session_abort_rpc() {
    let (mut mgr, _rx, _status_rx) = BridgeManager::new();
    let sid = "sess-abort".to_string();
    let (session, log) = stub_session_with_log(&sid);
    mgr.sessions.insert(sid.clone(), session);

    mgr.abort_session(&sid)
        .await
        .expect("abort_session should succeed with stub");

    let calls = log.lock().unwrap().clone();
    assert_eq!(
        calls,
        vec!["session.abort".to_string()],
        "abort_session must drive exactly one session.abort RPC"
    );
}

#[cfg(feature = "copilot-sdk")]
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

#[cfg(feature = "copilot-sdk")]
#[tokio::test]
async fn raw_rpc_call_rejects_oversized_body() {
    use super::raw_rpc::raw_rpc_call;
    // Simulate a server that claims a body larger than 10MB — raw_rpc_call should reject
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();

    let _server = tokio::spawn(async move {
        if let Ok((mut stream, _)) = listener.accept().await {
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            let mut buf = vec![0u8; 4096];
            let _ = stream.read(&mut buf).await;
            // Respond with a Content-Length that exceeds MAX_BODY_SIZE
            let response = "Content-Length: 20000000\r\n\r\n{}";
            let _ = stream.write_all(response.as_bytes()).await;
        }
    });

    let result = raw_rpc_call(&addr.to_string(), "test.method", serde_json::json!({})).await;

    assert!(result.is_err());
    let err = result.unwrap_err().to_string();
    assert!(
        err.contains("too large"),
        "error should mention body too large: {err}"
    );
}
