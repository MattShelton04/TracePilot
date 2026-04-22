//! HTTP-based MCP server health check (SSE or Streamable HTTP).
//!
//! Performs the full MCP handshake: `initialize` → `notifications/initialized`
//! → `tools/list`. The request chain is guarded by the URL policy (SSRF) on
//! both the initial URL and every redirect target.

use super::McpHealthResultCached;
use super::runner::{extract_tools_from_json, make_error_result};
use crate::mcp::headers::{
    MCP_SESSION_ID_HEADER, build_base_http_headers, inject_session_id_header,
};
use crate::mcp::types::{McpHealthResult, McpHealthStatus, McpServerConfig, McpTool};
use chrono::Utc;
use std::time::Instant;
use tracepilot_core::utils::sanitize_error_msg;

/// Check an HTTP-based MCP server (SSE or Streamable HTTP).
///
/// Performs the full MCP handshake: initialize → initialized notification →
/// tools/list.  For servers that reject the request (405/406), marks them
/// as healthy but skips tool discovery.
pub(super) async fn check_http_server(
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

    // SSRF guard: enforce URL policy before firing any request.
    // See crates/tracepilot-orchestrator/src/mcp/url_policy.rs
    // Use the async variant so DNS resolution doesn't block this runtime.
    if let Err(e) = crate::mcp::url_policy::validate_mcp_url_async(&url).await {
        return make_error_result(name, start, &format!("Rejected MCP URL: {e}"));
    }

    // Custom redirect policy: re-validate every redirect target against the
    // same URL policy so a hostile server can't 302 us onto a loopback /
    // RFC1918 address after we've checked the initial URL. Also cap the
    // redirect chain to a small number to prevent amplification.
    let redirect_policy = reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() >= 5 {
            return attempt.error("Too many redirects");
        }
        match crate::mcp::url_policy::validate_mcp_url(attempt.url().as_str()) {
            Ok(()) => attempt.follow(),
            Err(e) => attempt.error(format!("Redirect target rejected by URL policy: {e}")),
        }
    });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .redirect(redirect_policy)
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
