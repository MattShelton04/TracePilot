//! Tool transaction model — a complete tool execution lifecycle.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// A complete tool execution from `tool.execution_start` to `tool.execution_complete`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolTransaction {
    pub tool_name: String,
    pub tool_call_id: Option<String>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub duration_ms: Option<u64>,
    pub status: Option<String>,
    pub is_subagent: bool,
}
