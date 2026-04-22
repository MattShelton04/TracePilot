//! MCP server health checking.
//!
//! Provides async health checks for stdio-based and HTTP-based MCP servers.
//! Stdio servers are checked by spawning the process and sending an
//! `initialize` JSON-RPC request. HTTP servers are checked via the
//! configured URL endpoint.
//!
//! Submodules:
//! - [`runner`]: orchestration + per-server dispatch + shared helpers
//! - [`stdio`]: stdio transport health check (process spawn + JSON-RPC handshake)
//! - [`http`]: HTTP transport health check (initialize → notifications/initialized → tools/list)

use crate::mcp::types::{McpHealthResult, McpTool};
use serde::{Deserialize, Serialize};

mod http;
mod runner;
mod stdio;

#[cfg(test)]
mod tests;

/// Cached health result including discovered tools.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpHealthResultCached {
    pub result: McpHealthResult,
    pub tools: Vec<McpTool>,
}

pub use runner::{check_all_servers, check_single_server};
