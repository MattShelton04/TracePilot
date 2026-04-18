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
