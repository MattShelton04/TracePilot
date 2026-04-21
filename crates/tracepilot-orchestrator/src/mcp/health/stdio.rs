//! Stdio-based MCP server health check.
//!
//! Spawns the server subprocess and performs a JSON-RPC handshake over
//! stdin/stdout (`initialize` → `notifications/initialized` → `tools/list`).
//! On Windows the child process uses `CREATE_NO_WINDOW` via
//! [`crate::process::hidden_std_command`] so no console window flashes.

use super::McpHealthResultCached;
use super::runner::{extract_tools_from_json, make_error_result};
use crate::mcp::error::McpError;
use crate::mcp::types::{McpHealthResult, McpHealthStatus, McpServerConfig, McpTool};
use chrono::Utc;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::Child;
use std::time::Instant;
use tracepilot_core::utils::sanitize_error_msg;

/// Kill a child process and reap it to prevent zombie accumulation.
fn kill_and_reap(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

/// Check a stdio-based MCP server by spawning the process and sending
/// an initialize request via JSON-RPC over stdin/stdout.
pub(super) async fn check_stdio_server(
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

/// Serialize a JSON-RPC message and write it as a newline-delimited JSON line.
pub(super) fn write_jsonrpc(
    writer: &mut impl Write,
    msg: &serde_json::Value,
) -> Result<(), McpError> {
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
    use std::process::Stdio;

    /// RAII guard that ensures the child process is always killed and reaped,
    /// even on early `?`-returns from `write_jsonrpc` or pipe setup.
    struct ChildGuard(Child);
    impl Drop for ChildGuard {
        fn drop(&mut self) {
            kill_and_reap(&mut self.0);
        }
    }

    let start = Instant::now();

    let mut cmd = crate::process::hidden_std_command(command);
    cmd.args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .envs(env);

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
