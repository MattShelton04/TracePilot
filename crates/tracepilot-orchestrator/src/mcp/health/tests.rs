//! Tests for the `mcp::health` module.

use super::runner::{extract_tools_from_json, make_error_result};
use super::stdio::write_jsonrpc;
use super::{check_all_servers, check_single_server};
use crate::mcp::types::{McpHealthStatus, McpServerConfig};
use std::collections::HashMap;
use std::io::Write;
use std::time::Instant;

fn make_server(enabled: bool) -> McpServerConfig {
    McpServerConfig {
        command: Some("echo".into()),
        args: vec![],
        env: HashMap::new(),
        url: None,
        transport: None,
        headers: HashMap::new(),
        tools: vec![],
        description: None,
        tags: vec![],
        enabled,
    }
}

#[test]
fn disabled_server_returns_disabled_status() {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();

    rt.block_on(async {
        let mut servers = HashMap::new();
        servers.insert("disabled".to_string(), make_server(false));

        let results = check_all_servers(&servers).await;
        let result = results.get("disabled").unwrap();
        assert_eq!(result.result.status, McpHealthStatus::Disabled);
    });
}

#[test]
fn empty_server_map_returns_empty_results() {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();

    rt.block_on(async {
        let servers: HashMap<String, McpServerConfig> = HashMap::new();
        let results = check_all_servers(&servers).await;
        assert!(results.is_empty());
    });
}

#[test]
fn mixed_map_all_servers_appear_in_results() {
    // Verifies that every server (disabled or enabled-but-unreachable) produces
    // a result entry, exercising both the synchronous disabled path and the
    // JoinSet path in the same call.
    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .unwrap();

    rt.block_on(async {
        let mut servers = HashMap::new();
        // Disabled servers — handled synchronously, never spawned.
        servers.insert("disabled-1".to_string(), make_server(false));
        servers.insert("disabled-2".to_string(), make_server(false));
        // Enabled but unreachable — handled via JoinSet.
        let mut enabled_cfg = make_server(true);
        enabled_cfg.command = None;
        enabled_cfg.url = Some("http://127.0.0.1:1/mcp-unreachable".into());
        enabled_cfg.transport = Some(crate::mcp::types::McpTransport::StreamableHttp);
        servers.insert("enabled-unreachable".to_string(), enabled_cfg);

        let results = check_all_servers(&servers).await;
        assert_eq!(results.len(), 3, "all 3 servers must produce a result");
        assert_eq!(
            results["disabled-1"].result.status,
            McpHealthStatus::Disabled
        );
        assert_eq!(
            results["disabled-2"].result.status,
            McpHealthStatus::Disabled
        );
        assert_eq!(
            results["enabled-unreachable"].result.status,
            McpHealthStatus::Unreachable
        );
    });
}

#[test]
fn concurrent_unreachable_servers_all_produce_results() {
    // Verifies that multiple enabled-but-unreachable servers are all
    // checked and each produces an Unreachable result. Uses a multi-thread
    // runtime so checks run truly in parallel.
    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .unwrap();

    rt.block_on(async {
        let mut servers = HashMap::new();
        // These HTTP servers don't exist — each will fail quickly with a
        // connection error rather than waiting for the full 15s timeout.
        for i in 1..=3 {
            let mut cfg = make_server(true);
            cfg.command = None;
            cfg.url = Some(format!("http://127.0.0.1:1/mcp-nonexistent-{i}"));
            cfg.transport = Some(crate::mcp::types::McpTransport::StreamableHttp);
            servers.insert(format!("server-{i}"), cfg);
        }

        let results = check_all_servers(&servers).await;
        assert_eq!(results.len(), 3, "all 3 servers must produce results");
        for i in 1..=3 {
            let name = format!("server-{i}");
            let r = results.get(&name).expect("missing result");
            assert_eq!(
                r.result.status,
                McpHealthStatus::Unreachable,
                "server {name} should be Unreachable"
            );
        }
    });
}

#[test]
fn error_result_has_unreachable_status() {
    let result = make_error_result("test", Instant::now(), "test error");
    assert_eq!(result.result.status, McpHealthStatus::Unreachable);
    assert_eq!(result.result.error_message, Some("test error".to_string()));
}

#[test]
fn http_server_with_invalid_headers_returns_actionable_error() {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();

    rt.block_on(async {
        let mut server = make_server(true);
        server.command = None;
        server.url = Some("http://198.51.100.1:1/mcp".into());
        server.transport = Some(crate::mcp::types::McpTransport::StreamableHttp);
        server.headers.insert("Bad Header".into(), "value".into());

        let result = check_single_server("invalid-http", &server).await;
        let error_message = result.result.error_message.unwrap_or_default();

        assert_eq!(result.result.status, McpHealthStatus::Unreachable);
        assert!(error_message.contains("Invalid HTTP header name"));
        assert!(error_message.contains("Bad Header"));
    });
}

// ── extract_tools_from_json tests ─────────────────────────────────

#[test]
fn extract_tools_from_json_parses_valid_response() {
    let resp = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 2,
        "result": {
            "tools": [
                {
                    "name": "read_file",
                    "description": "Read a file from disk",
                    "inputSchema": {
                        "type": "object",
                        "properties": { "path": { "type": "string" } }
                    }
                },
                {
                    "name": "write_file",
                    "description": "Write content to a file"
                }
            ]
        }
    });

    let tools = extract_tools_from_json(&resp);
    assert_eq!(tools.len(), 2);
    assert_eq!(tools[0].name, "read_file");
    assert_eq!(
        tools[0].description.as_deref(),
        Some("Read a file from disk")
    );
    assert!(tools[0].input_schema.is_some());
    assert_eq!(tools[1].name, "write_file");
    assert_eq!(
        tools[1].description.as_deref(),
        Some("Write content to a file")
    );
    assert!(tools[1].input_schema.is_none());
}

#[test]
fn extract_tools_from_json_handles_empty_tools_array() {
    let resp = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 2,
        "result": { "tools": [] }
    });

    let tools = extract_tools_from_json(&resp);
    assert!(tools.is_empty());
}

#[test]
fn extract_tools_from_json_handles_missing_result() {
    let resp = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 2,
        "error": { "code": -32600, "message": "Invalid Request" }
    });

    let tools = extract_tools_from_json(&resp);
    assert!(tools.is_empty());
}

#[test]
fn extract_tools_from_json_handles_missing_name() {
    let resp = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 2,
        "result": {
            "tools": [
                { "description": "A tool without a name" }
            ]
        }
    });

    let tools = extract_tools_from_json(&resp);
    assert_eq!(tools.len(), 1);
    assert_eq!(tools[0].name, "unknown");
}

// ── write_jsonrpc tests ───────────────────────────────────────────

#[test]
fn write_jsonrpc_writes_valid_json_line() {
    let mut buf = Vec::new();
    let msg = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize"
    });

    write_jsonrpc(&mut buf, &msg).unwrap();

    let output = String::from_utf8(buf).unwrap();
    // Must end with a newline (newline-delimited JSON-RPC)
    assert!(output.ends_with('\n'));
    // The line (without trailing newline) must be valid JSON
    let parsed: serde_json::Value = serde_json::from_str(output.trim_end()).unwrap();
    assert_eq!(parsed["method"], "initialize");
}

#[test]
fn write_jsonrpc_returns_error_on_write_failure() {
    // A writer that always fails
    struct FailWriter;
    impl Write for FailWriter {
        fn write(&mut self, _buf: &[u8]) -> std::io::Result<usize> {
            Err(std::io::Error::new(
                std::io::ErrorKind::BrokenPipe,
                "simulated broken pipe",
            ))
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    let msg = serde_json::json!({"jsonrpc": "2.0", "id": 1});
    let result = write_jsonrpc(&mut FailWriter, &msg);
    assert!(result.is_err());

    let err = result.unwrap_err();
    let err_msg = err.to_string();
    assert!(
        err_msg.contains("Failed to write JSON-RPC message"),
        "unexpected error message: {err_msg}"
    );
}
