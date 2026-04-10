//! MCP server health checking.
//!
//! Provides async health checks for stdio-based and HTTP-based MCP servers.
//! Stdio servers are checked by spawning the process and sending an
//! `initialize` JSON-RPC request. HTTP servers are checked via the
//! configured URL endpoint.

use crate::mcp::error::McpError;
use crate::mcp::headers::{
    MCP_SESSION_ID_HEADER, build_base_http_headers, inject_session_id_header,
};
use crate::mcp::types::{McpHealthResult, McpHealthStatus, McpServerConfig, McpTool, McpTransport};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::Child;
use std::time::Instant;

/// Sanitize error messages for safe logging.
///
/// Removes control characters (except spaces/tabs) to prevent log injection
/// attacks and truncates to 500 characters to prevent log spam.
fn sanitize_error_msg(err: &impl std::fmt::Display) -> String {
    err.to_string()
        .chars()
        .filter(|c| !c.is_control() || *c == ' ' || *c == '\t')
        .take(500)
        .collect()
}

/// Kill a child process and reap it to prevent zombie accumulation.
fn kill_and_reap(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

/// Cached health result including discovered tools.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpHealthResultCached {
    pub result: McpHealthResult,
    pub tools: Vec<McpTool>,
}

/// Run health checks for all enabled servers concurrently.
///
/// Returns results keyed by server name. Disabled servers get a
/// `Disabled` status without attempting connection. Enabled servers
/// are checked in parallel — total latency is bounded by the slowest
/// single check rather than the sum of all check latencies.
pub async fn check_all_servers(
    servers: &HashMap<String, McpServerConfig>,
) -> HashMap<String, McpHealthResultCached> {
    let mut results = HashMap::new();
    let mut join_set: tokio::task::JoinSet<(String, McpHealthResultCached)> =
        tokio::task::JoinSet::new();

    // Track names of spawned tasks so we can insert a fallback result if a
    // task panics (extremely unlikely — check_single_server handles all errors
    // internally — but guarantees results.len() == servers.len()).
    let mut spawned_names: Vec<String> = Vec::new();

    for (name, config) in servers {
        if !config.enabled {
            results.insert(
                name.clone(),
                McpHealthResultCached {
                    result: McpHealthResult {
                        server_name: name.clone(),
                        status: McpHealthStatus::Disabled,
                        latency_ms: None,
                        tool_count: None,
                        error_message: None,
                        checked_at: Utc::now(),
                    },
                    tools: vec![],
                },
            );
            continue;
        }

        let name = name.clone();
        let config = config.clone();
        spawned_names.push(name.clone());
        join_set.spawn(async move {
            let cached = check_single_server(&name, &config).await;
            (name, cached)
        });
    }

    while let Some(outcome) = join_set.join_next().await {
        match outcome {
            Ok((name, cached)) => {
                results.insert(name, cached);
            }
            Err(e) => {
                // Should not happen — check_single_server handles all errors
                // without panicking. Logged defensively; the missing entry is
                // filled in by the fallback loop below.
                tracing::warn!("An MCP health check task panicked unexpectedly: {e}");
            }
        }
    }

    // Insert Unreachable fallback for any server whose task panicked and did
    // not produce a result entry. The `Instant::now()` latency is approximate
    // (measured after all tasks finish, not at panic time) — acceptable since
    // task panics should never occur in practice.
    if results.len() < servers.len() {
        for name in spawned_names {
            results.entry(name).or_insert_with_key(|n| {
                make_error_result(n, Instant::now(), "health-check task panicked unexpectedly")
            });
        }
    }

    results
}

/// Check a single MCP server's health.
pub async fn check_single_server(name: &str, config: &McpServerConfig) -> McpHealthResultCached {
    let start = Instant::now();

    match config.effective_transport() {
        McpTransport::Stdio => check_stdio_server(name, config, start).await,
        McpTransport::Sse | McpTransport::StreamableHttp => {
            check_http_server(name, config, start).await
        }
    }
}

/// Check a stdio-based MCP server by spawning the process and sending
/// an initialize request via JSON-RPC over stdin/stdout.
async fn check_stdio_server(
    name: &str,
    config: &McpServerConfig,
    start: Instant,
) -> McpHealthResultCached {
    let command = match &config.command {
        Some(cmd) => cmd.clone(),
        None => {
            return make_error_result(name, start, "No command specified for stdio server");
        }
    };

    // Spawn the server process
    let result = tokio::task::spawn_blocking({
        let args = config.args.clone();
        let env = config.env.clone();
        move || spawn_and_initialize(&command, &args, &env)
    })
    .await;

    match result {
        Ok(Ok((tools, latency_ms))) => {
            let tool_count = tools.len();
            McpHealthResultCached {
                result: McpHealthResult {
                    server_name: name.to_string(),
                    status: McpHealthStatus::Healthy,
                    latency_ms: Some(latency_ms),
                    tool_count: Some(tool_count),
                    error_message: None,
                    checked_at: Utc::now(),
                },
                tools,
            }
        }
        Ok(Err(e)) => make_error_result(name, start, &e.to_string()),
        Err(e) => make_error_result(name, start, &format!("Task join error: {e}")),
    }
}

/// Check an HTTP-based MCP server (SSE or Streamable HTTP).
///
/// Performs the full MCP handshake: initialize → initialized notification →
/// tools/list.  For servers that reject the request (405/406), marks them
/// as healthy but skips tool discovery.
async fn check_http_server(
    name: &str,
    config: &McpServerConfig,
    start: Instant,
) -> McpHealthResultCached {
    let url = match &config.url {
        Some(u) => u.clone(),
        None => {
            return make_error_result(name, start, "No URL specified for HTTP server");
        }
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build();

    let client = match client {
        Ok(c) => c,
        Err(e) => return make_error_result(name, start, &format!("HTTP client error: {e}")),
    };

    // Build request headers — include any user-configured headers.
    let base_headers = match build_base_http_headers(&config.headers) {
        Ok(headers) => headers,
        Err(err) => return make_error_result(name, start, &err.to_string()),
    };

    // Step 1: JSON-RPC initialize request per MCP spec.
    let init_req = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-03-26",
            "capabilities": {},
            "clientInfo": {
                "name": "tracepilot",
                "version": "1.0.0"
            }
        }
    });

    let init_resp = match client
        .post(&url)
        .headers(base_headers.clone())
        .json(&init_req)
        .send()
        .await
    {
        Ok(resp) => resp,
        Err(e) => return make_error_result(name, start, &format!("Connection failed: {e}")),
    };

    let latency_ms = start.elapsed().as_millis() as u64;
    let status_code = init_resp.status().as_u16();

    // 405/406 = endpoint exists but rejects method/content — healthy but can't
    // discover tools.
    if status_code == 405 || status_code == 406 {
        return McpHealthResultCached {
            result: McpHealthResult {
                server_name: name.to_string(),
                status: McpHealthStatus::Healthy,
                latency_ms: Some(latency_ms),
                tool_count: None,
                error_message: None,
                checked_at: Utc::now(),
            },
            tools: vec![],
        };
    }

    if !init_resp.status().is_success() {
        let reason = init_resp.status().canonical_reason().unwrap_or("Unknown");
        return McpHealthResultCached {
            result: McpHealthResult {
                server_name: name.to_string(),
                status: McpHealthStatus::Degraded,
                latency_ms: Some(latency_ms),
                tool_count: None,
                error_message: Some(format!("HTTP {status_code} {reason}")),
                checked_at: Utc::now(),
            },
            tools: vec![],
        };
    }

    // Extract Mcp-Session-Id if present (required for session continuity).
    let session_id = init_resp
        .headers()
        .get(MCP_SESSION_ID_HEADER)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    // Try to parse the initialize response body (may be JSON or SSE).
    if let Err(e) = init_resp.text().await {
        tracing::debug!(
            server = %name,
            error = %sanitize_error_msg(&e),
            "[MCP Health] Failed to read initialize response body"
        );
    }

    // Step 2: Send initialized notification (fire-and-forget).
    let notif = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "notifications/initialized"
    });

    let mut notif_headers = base_headers.clone();
    inject_session_id_header(&mut notif_headers, session_id.as_deref());
    if let Err(e) = client
        .post(&url)
        .headers(notif_headers)
        .json(&notif)
        .send()
        .await
    {
        tracing::debug!(
            server = %name,
            error = %sanitize_error_msg(&e),
            "[MCP Health] Failed to send initialized notification"
        );
    }

    // Step 3: Send tools/list request.
    let tools_req = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/list",
        "params": {}
    });

    let mut tools_headers = base_headers;
    inject_session_id_header(&mut tools_headers, session_id.as_deref());

    let tools = match client
        .post(&url)
        .headers(tools_headers)
        .json(&tools_req)
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => parse_tools_from_response(resp).await,
        Ok(resp) => {
            tracing::warn!(
                server = %name,
                status = %resp.status(),
                "[MCP Health] tools/list request failed"
            );
            vec![]
        }
        Err(e) => {
            tracing::warn!(
                server = %name,
                error = %sanitize_error_msg(&e),
                "[MCP Health] tools/list request failed"
            );
            vec![]
        }
    };

    let tool_count = tools.len();

    McpHealthResultCached {
        result: McpHealthResult {
            server_name: name.to_string(),
            status: McpHealthStatus::Healthy,
            latency_ms: Some(latency_ms),
            tool_count: Some(tool_count),
            error_message: None,
            checked_at: Utc::now(),
        },
        tools,
    }
}

/// Parse tools from an HTTP tools/list response.
///
/// Handles both direct JSON responses and SSE streams (looking for
/// the first `data:` line containing a JSON-RPC response with tools).
async fn parse_tools_from_response(resp: reqwest::Response) -> Vec<McpTool> {
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    let body = match resp.text().await {
        Ok(b) => b,
        Err(e) => {
            tracing::debug!(
                error = %sanitize_error_msg(&e),
                "[MCP Health] Failed to read tools/list response body"
            );
            return vec![];
        }
    };

    // For SSE responses, extract JSON from `data:` lines.
    let json_text = if content_type.contains("text/event-stream") {
        body.lines()
            .filter_map(|line| line.strip_prefix("data:").map(|d| d.trim().to_string()))
            .find(|d| d.contains("\"tools\""))
            .unwrap_or_default()
    } else {
        body
    };

    if json_text.is_empty() {
        return vec![];
    }

    let parsed: serde_json::Value = match serde_json::from_str(&json_text) {
        Ok(v) => v,
        Err(e) => {
            tracing::debug!(
                error = %sanitize_error_msg(&e),
                "[MCP Health] Failed to parse tools/list JSON response"
            );
            return vec![];
        }
    };

    extract_tools_from_json(&parsed)
}

/// Extract McpTool entries from a JSON-RPC response value.
fn extract_tools_from_json(resp: &serde_json::Value) -> Vec<McpTool> {
    let tool_list = resp
        .get("result")
        .and_then(|r| r.get("tools"))
        .and_then(|t| t.as_array());

    let Some(tools_arr) = tool_list else {
        return vec![];
    };

    tools_arr
        .iter()
        .map(|tool_val| {
            let name = tool_val
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string();
            let description = tool_val
                .get("description")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let input_schema = tool_val.get("inputSchema").cloned();

            McpTool::new(name, description, input_schema)
        })
        .collect()
}

/// Serialize a JSON-RPC message and write it as a newline-delimited JSON line.
fn write_jsonrpc(writer: &mut impl Write, msg: &serde_json::Value) -> Result<(), McpError> {
    let text = serde_json::to_string(msg)
        .map_err(|e| McpError::HealthCheck(format!("JSON serialization error: {e}")))?;
    writeln!(writer, "{text}")
        .map_err(|e| McpError::HealthCheck(format!("Failed to write JSON-RPC message: {e}")))
}

/// Spawn a stdio MCP server, send initialize + tools/list, return tools.
///
/// Takes ownership of stdin/stdout from the child process up-front and uses a
/// single `BufReader` for the entire handshake.  Previous versions created two
/// separate `BufReader` instances for the initialize and tools/list read phases.
/// Because `BufReader` may read ahead into its internal buffer, recreating it
/// could silently lose already-buffered data when a server responds quickly,
/// causing the health check to hang until timeout.
fn spawn_and_initialize(
    command: &str,
    args: &[String],
    env: &HashMap<String, String>,
) -> Result<(Vec<McpTool>, u64), McpError> {
    use std::process::{Command, Stdio};

    /// RAII guard that ensures the child process is always killed and reaped,
    /// even on early `?`-returns from `write_jsonrpc` or pipe setup.
    struct ChildGuard(Child);
    impl Drop for ChildGuard {
        fn drop(&mut self) {
            kill_and_reap(&mut self.0);
        }
    }

    let start = Instant::now();

    let mut cmd = Command::new(command);
    cmd.args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .envs(env);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| McpError::HealthCheck(format!("Failed to spawn '{command}': {e}")))?;

    // Wrap immediately so every subsequent return path reaps the child.
    // Take ownership of stdin/stdout before wrapping so the guard only
    // holds the (pipe-less) child handle used for kill/wait.
    let mut stdin = child.stdin.take().ok_or_else(|| {
        kill_and_reap(&mut child);
        McpError::HealthCheck("Failed to open stdin".into())
    })?;
    let stdout = child.stdout.take().ok_or_else(|| {
        kill_and_reap(&mut child);
        McpError::HealthCheck("Failed to open stdout".into())
    })?;
    let guard = ChildGuard(child);

    // A single BufReader for the entire handshake — prevents buffered data loss
    // that occurs when creating separate readers for each phase.
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    let timeout = std::time::Duration::from_secs(10);

    // ── Phase 1: Send initialize request ──────────────────────────────
    let init_req = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2025-03-26",
            "capabilities": {},
            "clientInfo": {
                "name": "tracepilot",
                "version": "1.0.0"
            }
        }
    });
    write_jsonrpc(&mut stdin, &init_req)?;

    // Read initialize response
    let deadline = Instant::now() + timeout;
    loop {
        if Instant::now() > deadline {
            return Err(McpError::HealthCheck("Initialize timed out".into()));
        }

        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => {
                return Err(McpError::HealthCheck("Server closed stdout".into()));
            }
            Ok(_) => {
                // Try parsing as JSON-RPC response
                if let Ok(resp) = serde_json::from_str::<serde_json::Value>(&line)
                    && resp.get("id").and_then(|v| v.as_u64()) == Some(1)
                {
                    // Got initialize response, proceed to next phase
                    break;
                }
            }
            Err(e) => {
                return Err(McpError::HealthCheck(format!("Read error: {e}")));
            }
        }
    }

    // ── Phase 2: Send initialized notification + tools/list request ───
    let notif = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "notifications/initialized"
    });
    write_jsonrpc(&mut stdin, &notif)?;

    let tools_req = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/list",
        "params": {}
    });
    write_jsonrpc(&mut stdin, &tools_req)?;

    // ── Phase 3: Read tools/list response (reuses same BufReader) ─────
    let deadline = Instant::now() + timeout;
    loop {
        if Instant::now() > deadline {
            tracing::debug!(
                "[MCP Health] Timeout waiting for tools/list response from stdio server"
            );
            break; // Return whatever we have
        }

        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => {
                tracing::debug!(
                    "[MCP Health] Stdio server closed stdout before sending tools/list response"
                );
                break;
            }
            Ok(_) => {
                if let Ok(resp) = serde_json::from_str::<serde_json::Value>(&line)
                    && resp.get("id").and_then(|v| v.as_u64()) == Some(2)
                {
                    let tools = extract_tools_from_json(&resp);
                    let latency_ms = start.elapsed().as_millis() as u64;
                    // guard drops here, killing and reaping the child
                    return Ok((tools, latency_ms));
                }
            }
            Err(e) => {
                tracing::debug!(
                    error = %sanitize_error_msg(&e),
                    "[MCP Health] Read error while waiting for tools/list response from stdio server"
                );
                break;
            }
        }
    }

    let latency_ms = start.elapsed().as_millis() as u64;
    // guard drops here, killing and reaping the child
    drop(guard);

    Ok((vec![], latency_ms))
}

fn make_error_result(name: &str, start: Instant, error: &str) -> McpHealthResultCached {
    McpHealthResultCached {
        result: McpHealthResult {
            server_name: name.to_string(),
            status: McpHealthStatus::Unreachable,
            latency_ms: Some(start.elapsed().as_millis() as u64),
            tool_count: None,
            error_message: Some(error.to_string()),
            checked_at: Utc::now(),
        },
        tools: vec![],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
            server.url = Some("http://127.0.0.1:1/mcp".into());
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
}
