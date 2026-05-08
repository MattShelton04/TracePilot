//! Unit tests for the four `raw_rpc` helpers.
//!
//! Split out of `raw_rpc.rs` to keep the production file under the
//! workspace LOC budget; included via `#[path]` from `raw_rpc.rs` so the
//! tests still live in the same module tree and can reach private items.

use super::*;
use std::io::Cursor;

// ─── parse_cli_addr ──────────────────────────────────────────

#[test]
fn parse_cli_addr_strips_http_prefix() {
    assert_eq!(
        parse_cli_addr("http://127.0.0.1:8080").unwrap(),
        "127.0.0.1:8080"
    );
}

#[test]
fn parse_cli_addr_strips_ws_prefix() {
    assert_eq!(
        parse_cli_addr("ws://localhost:1234").unwrap(),
        "localhost:1234"
    );
}

#[test]
fn parse_cli_addr_keeps_host_port() {
    assert_eq!(parse_cli_addr("127.0.0.1:9999").unwrap(), "127.0.0.1:9999");
}

#[test]
fn parse_cli_addr_promotes_bare_port() {
    assert_eq!(parse_cli_addr("9999").unwrap(), "127.0.0.1:9999");
}

#[test]
fn parse_cli_addr_rejects_empty() {
    assert!(matches!(parse_cli_addr(""), Err(RpcError::EmptyAddr)));
}

// ─── send_framed_request ─────────────────────────────────────

#[tokio::test]
async fn send_framed_request_writes_lsp_frame() {
    let (mut a, mut b) = tokio::io::duplex(1024);
    let body = br#"{"x":1}"#;
    send_framed_request(&mut a, body, Duration::from_secs(1))
        .await
        .expect("write succeeds");
    drop(a);
    let mut received = Vec::new();
    tokio::io::AsyncReadExt::read_to_end(&mut b, &mut received)
        .await
        .unwrap();
    assert_eq!(received, b"Content-Length: 7\r\n\r\n{\"x\":1}".to_vec());
}

// ─── read_content_length_response ────────────────────────────

fn frame(headers: &str, body: &[u8]) -> Vec<u8> {
    let mut v = headers.as_bytes().to_vec();
    v.extend_from_slice(body);
    v
}

#[tokio::test]
async fn read_response_happy_path() {
    let body = br#"{"jsonrpc":"2.0","id":1,"result":null}"#;
    let raw = frame(&format!("Content-Length: {}\r\n\r\n", body.len()), body);
    let mut reader = BufReader::new(Cursor::new(raw));
    let got = read_content_length_response(&mut reader, Duration::from_secs(1))
        .await
        .unwrap();
    assert_eq!(got, body);
}

#[tokio::test]
async fn read_response_case_insensitive_content_length() {
    let body = b"{}";
    let raw = frame("content-length: 2\r\n\r\n", body);
    let mut reader = BufReader::new(Cursor::new(raw));
    let got = read_content_length_response(&mut reader, Duration::from_secs(1))
        .await
        .unwrap();
    assert_eq!(got, body);
}

#[tokio::test]
async fn read_response_rejects_oversized_header_block() {
    // Build > 64 KiB of headers using fewer than `MAX_HEADER_LINES` lines so
    // the byte cap fires first.
    let mut headers = String::new();
    for i in 0..(MAX_HEADER_LINES - 1) {
        headers.push_str(&format!("X-Filler-{i}: {}\r\n", "a".repeat(1200)));
    }
    headers.push_str("Content-Length: 2\r\n\r\n");
    let raw = frame(&headers, b"{}");
    let mut reader = BufReader::new(Cursor::new(raw));
    let err = read_content_length_response(&mut reader, Duration::from_secs(2))
        .await
        .unwrap_err();
    assert!(
        matches!(err, RpcError::HeadersTooLarge { .. }),
        "got {err:?}"
    );
}

#[tokio::test]
async fn read_response_rejects_too_many_header_lines() {
    // Many tiny headers — under the byte cap but over the line cap.
    let mut headers = String::new();
    for i in 0..(MAX_HEADER_LINES + 5) {
        headers.push_str(&format!("X-{i}:v\r\n"));
    }
    headers.push_str("Content-Length: 2\r\n\r\n");
    let raw = frame(&headers, b"{}");
    let mut reader = BufReader::new(Cursor::new(raw));
    let err = read_content_length_response(&mut reader, Duration::from_secs(2))
        .await
        .unwrap_err();
    assert!(
        matches!(err, RpcError::TooManyHeaders { .. }),
        "got {err:?}"
    );
}

#[tokio::test]
async fn read_response_rejects_duplicate_content_length() {
    let raw = frame("Content-Length: 2\r\nContent-Length: 4\r\n\r\n", b"{}");
    let mut reader = BufReader::new(Cursor::new(raw));
    let err = read_content_length_response(&mut reader, Duration::from_secs(1))
        .await
        .unwrap_err();
    assert!(
        matches!(err, RpcError::DuplicateContentLength),
        "got {err:?}"
    );
}

#[tokio::test]
async fn read_response_rejects_missing_content_length() {
    let raw = frame("X-Other: 1\r\n\r\n", b"{}");
    let mut reader = BufReader::new(Cursor::new(raw));
    let err = read_content_length_response(&mut reader, Duration::from_secs(1))
        .await
        .unwrap_err();
    assert!(matches!(err, RpcError::MissingContentLength), "got {err:?}");
}

#[tokio::test]
async fn read_response_rejects_oversized_body() {
    let raw = frame("Content-Length: 20000000\r\n\r\n", b"{}");
    let mut reader = BufReader::new(Cursor::new(raw));
    let err = read_content_length_response(&mut reader, Duration::from_secs(1))
        .await
        .unwrap_err();
    assert!(matches!(err, RpcError::BodyTooLarge { .. }), "got {err:?}");
}

// ─── rpc_error_from_response ─────────────────────────────────

#[test]
fn rpc_error_from_response_extracts_code_and_message() {
    let v = serde_json::json!({
        "error": {"code": -32601, "message": "Method not found"}
    });
    match rpc_error_from_response(&v) {
        RpcError::JsonRpc { code, message } => {
            assert_eq!(code, -32601);
            assert_eq!(message, "Method not found");
        }
        other => panic!("unexpected: {other:?}"),
    }
}

#[test]
fn rpc_error_from_response_handles_missing_fields() {
    let v = serde_json::json!({ "error": {} });
    match rpc_error_from_response(&v) {
        RpcError::JsonRpc { code, message } => {
            assert_eq!(code, 0);
            assert_eq!(message, "Unknown");
        }
        other => panic!("unexpected: {other:?}"),
    }
}

#[test]
fn rpc_error_display_strings_match_legacy_contract() {
    // The orchestrator wraps `RpcError` via `BridgeError::sdk(..)`, which
    // calls `Display::to_string`. Lock in the user-visible strings so any
    // future change to the wording is a visible diff.
    assert_eq!(
        RpcError::HeadersTooLarge {
            observed: 70_000,
            limit: MAX_HEADER_BYTES,
        }
        .to_string(),
        format!("Response headers too large: 70000 bytes (max {MAX_HEADER_BYTES})")
    );
    assert_eq!(
        RpcError::TooManyHeaders {
            observed: 70,
            limit: MAX_HEADER_LINES,
        }
        .to_string(),
        format!("Too many response headers: 70 lines (max {MAX_HEADER_LINES})")
    );
    assert_eq!(
        RpcError::DuplicateContentLength.to_string(),
        "Duplicate Content-Length header in response"
    );
    assert_eq!(
        RpcError::JsonRpc {
            code: -32601,
            message: "Unhandled method".into(),
        }
        .to_string(),
        "JSON-RPC error -32601: Unhandled method"
    );
}
