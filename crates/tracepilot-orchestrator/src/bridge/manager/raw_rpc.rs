//! Raw JSON-RPC framing over TCP — used to bypass the SDK when it sends the
//! wrong method name (e.g. `session.model.switch_to` should be
//! `session.model.switchTo`). See `docs/copilot-sdk-rpc-method-bug.md`.
//!
//! Uses LSP-style `Content-Length` framing (the same framing the CLI uses
//! for stdio and `--ui-server` transports).

use crate::bridge::BridgeError;
use tracing::debug;

/// Send a raw JSON-RPC request to the CLI server over TCP.
///
/// Bypasses the SDK to work around upstream method name bugs
/// (e.g. `session.model.switch_to` should be `session.model.switchTo`).
/// Uses Content-Length framing (LSP-style protocol).
pub(super) async fn raw_rpc_call(
    cli_url: &str,
    method: &str,
    params: serde_json::Value,
) -> Result<serde_json::Value, BridgeError> {
    use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
    use tokio::net::TcpStream;
    use tokio::time::{Duration, timeout};

    const RPC_TIMEOUT: Duration = Duration::from_secs(10);
    const MAX_BODY_SIZE: usize = 10 * 1024 * 1024; // 10 MB

    // Parse URL — accepts "host:port", "http://host:port", "ws://host:port", or bare "port"
    let addr = if let Some(rest) = cli_url.strip_prefix("http://") {
        rest.to_string()
    } else if let Some(rest) = cli_url.strip_prefix("ws://") {
        rest.to_string()
    } else if cli_url.contains(':') {
        cli_url.to_string()
    } else {
        format!("127.0.0.1:{cli_url}")
    };

    debug!("raw_rpc_call: {} → {} params={}", addr, method, params);

    let mut stream = timeout(RPC_TIMEOUT, TcpStream::connect(&addr))
        .await
        .map_err(|_| {
            BridgeError::Sdk(format!(
                "TCP connect to {addr}: timed out after {RPC_TIMEOUT:?}"
            ))
        })?
        .map_err(|e| BridgeError::Sdk(format!("TCP connect to {addr}: {e}")))?;

    let body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params,
    });
    let body_str = serde_json::to_string(&body)
        .map_err(|e| BridgeError::Sdk(format!("JSON serialize: {e}")))?;

    let msg = format!("Content-Length: {}\r\n\r\n{}", body_str.len(), body_str);
    timeout(RPC_TIMEOUT, stream.write_all(msg.as_bytes()))
        .await
        .map_err(|_| BridgeError::Sdk("TCP write timed out".into()))?
        .map_err(|e| BridgeError::Sdk(format!("TCP write: {e}")))?;

    // Read Content-Length header from response
    let mut reader = BufReader::new(stream);
    let mut content_length: usize = 0;
    let header_result = timeout(RPC_TIMEOUT, async {
        loop {
            let mut line = String::new();
            reader
                .read_line(&mut line)
                .await
                .map_err(|e| BridgeError::Sdk(format!("TCP read header: {e}")))?;
            let trimmed = line.trim();
            if trimmed.is_empty() {
                break;
            }
            if let Some(len_str) = trimmed.strip_prefix("Content-Length:") {
                content_length = len_str
                    .trim()
                    .parse()
                    .map_err(|_| BridgeError::Sdk("Invalid Content-Length".into()))?;
            }
        }
        Ok::<(), BridgeError>(())
    })
    .await
    .map_err(|_| BridgeError::Sdk("TCP read header timed out".into()))?;
    header_result?;

    if content_length == 0 {
        return Err(BridgeError::Sdk("No Content-Length in response".into()));
    }
    if content_length > MAX_BODY_SIZE {
        return Err(BridgeError::Sdk(format!(
            "Response body too large: {content_length} bytes (max {MAX_BODY_SIZE})"
        )));
    }

    let mut body_buf = vec![0u8; content_length];
    timeout(RPC_TIMEOUT, reader.read_exact(&mut body_buf))
        .await
        .map_err(|_| BridgeError::Sdk("TCP read body timed out".into()))?
        .map_err(|e| BridgeError::Sdk(format!("TCP read body: {e}")))?;

    let response: serde_json::Value = serde_json::from_slice(&body_buf)
        .map_err(|e| BridgeError::Sdk(format!("JSON parse response: {e}")))?;

    debug!("raw_rpc_call: {} response={}", method, response);

    if let Some(error) = response.get("error") {
        let msg = error
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("Unknown");
        let code = error.get("code").and_then(|c| c.as_i64()).unwrap_or(0);
        return Err(BridgeError::Sdk(format!("JSON-RPC error {code}: {msg}")));
    }

    Ok(response
        .get("result")
        .cloned()
        .unwrap_or(serde_json::Value::Null))
}
