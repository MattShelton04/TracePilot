//! Orchestrator for MCP health checks.
//!
//! Dispatches per-server checks in parallel and aggregates results.
//! Houses shared helpers used by both transport backends.

use super::McpHealthResultCached;
use crate::mcp::types::{McpHealthResult, McpHealthStatus, McpServerConfig, McpTool, McpTransport};
use chrono::Utc;
use std::collections::HashMap;
use std::time::Instant;

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
        McpTransport::Stdio => super::stdio::check_stdio_server(name, config, start).await,
        McpTransport::Sse | McpTransport::StreamableHttp => {
            super::http::check_http_server(name, config, start).await
        }
    }
}

pub(super) fn make_error_result(name: &str, start: Instant, error: &str) -> McpHealthResultCached {
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

/// Extract [`McpTool`] entries from a JSON-RPC response value.
pub(super) fn extract_tools_from_json(resp: &serde_json::Value) -> Vec<McpTool> {
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
