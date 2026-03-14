//! Conversation turn model — groups flat events into logical turns.
//!
//! A "turn" is one user message + the assistant's full response (including tool calls).

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// A single conversation turn.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationTurn {
    pub turn_index: usize,
    pub turn_id: Option<String>,
    pub interaction_id: Option<String>,
    pub user_message: Option<String>,
    #[serde(default)]
    pub assistant_messages: Vec<String>,
    pub model: Option<String>,
    pub timestamp: Option<DateTime<Utc>>,
    pub end_timestamp: Option<DateTime<Utc>>,
    #[serde(default)]
    pub tool_calls: Vec<TurnToolCall>,
    pub duration_ms: Option<u64>,
    #[serde(default)]
    pub is_complete: bool,
}

/// A tool call within a conversation turn.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnToolCall {
    pub tool_call_id: Option<String>,
    pub parent_tool_call_id: Option<String>,
    pub tool_name: String,
    pub arguments: Option<serde_json::Value>,
    pub success: Option<bool>,
    pub error: Option<String>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub duration_ms: Option<u64>,
    pub mcp_server_name: Option<String>,
    pub mcp_tool_name: Option<String>,
    #[serde(default)]
    pub is_complete: bool,
}
