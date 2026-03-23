//! Conversation turn model — groups flat events into logical turns.
//!
//! A "turn" is one user message + the assistant's full response (including tool calls).

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// A message or reasoning text attributed to the agent that produced it.
///
/// When `parent_tool_call_id` is `Some`, this content was produced by the subagent
/// owning that tool call. When `None`, it belongs to the main (top-level) agent.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AttributedMessage {
    pub content: String,
    /// Links to the subagent's tool_call_id, or `None` for the main agent.
    pub parent_tool_call_id: Option<String>,
    /// Denormalized display name of the owning agent (e.g. "Explore Agent").
    pub agent_display_name: Option<String>,
}

/// Severity level for session events embedded in a conversation turn.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SessionEventSeverity {
    Error,
    Warning,
    Info,
}

/// A session-level event that occurred during a conversation turn.
///
/// These capture important session state changes (errors, compactions, truncations,
/// plan/mode changes) that are otherwise invisible in the conversation timeline.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnSessionEvent {
    /// Wire event type (e.g. "session.error", "session.compaction_complete").
    pub event_type: String,
    pub timestamp: Option<DateTime<Utc>>,
    pub severity: SessionEventSeverity,
    /// Human-readable summary of what happened.
    pub summary: String,
}

/// A single conversation turn.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationTurn {
    pub turn_index: usize,
    /// Index of the event that opened this turn (for deep-linking from search).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event_index: Option<usize>,
    pub turn_id: Option<String>,
    pub interaction_id: Option<String>,
    pub user_message: Option<String>,
    /// Assistant messages with agent attribution (who produced each message).
    #[serde(default)]
    pub assistant_messages: Vec<AttributedMessage>,
    pub model: Option<String>,
    pub timestamp: Option<DateTime<Utc>>,
    pub end_timestamp: Option<DateTime<Utc>>,
    #[serde(default)]
    pub tool_calls: Vec<TurnToolCall>,
    pub duration_ms: Option<u64>,
    #[serde(default)]
    pub is_complete: bool,
    /// Visible chain-of-thought reasoning with agent attribution.
    #[serde(default)]
    pub reasoning_texts: Vec<AttributedMessage>,
    /// Total output tokens across all assistant messages in this turn.
    pub output_tokens: Option<u64>,
    /// System-decorated version of the user message (includes datetime, reminders, SQL state).
    pub transformed_user_message: Option<String>,
    /// User message attachments (file selections, code snippets).
    pub attachments: Option<Vec<serde_json::Value>>,
    /// Session-level events (errors, compactions, etc.) that occurred during this turn.
    #[serde(default)]
    pub session_events: Vec<TurnSessionEvent>,
}

/// A tool call within a conversation turn.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnToolCall {
    pub tool_call_id: Option<String>,
    pub parent_tool_call_id: Option<String>,
    pub tool_name: String,
    /// Index of the ToolExecutionStart event in the session event stream.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event_index: Option<usize>,
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
    /// Whether this tool call represents a subagent invocation.
    #[serde(default)]
    pub is_subagent: bool,
    /// Human-readable display name of the subagent (e.g. "Explore Agent").
    pub agent_display_name: Option<String>,
    /// Description of what the subagent does.
    pub agent_description: Option<String>,
    /// The model used for this specific tool call (populated from ToolExecComplete).
    pub model: Option<String>,
    /// Human-readable description of what this tool call intends to do.
    pub intention_summary: Option<String>,
    /// Truncated preview of the tool result (≤1KB). Use `get_tool_result` for full content.
    pub result_content: Option<String>,
    /// Short summary of arguments, computed server-side for IPC efficiency.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args_summary: Option<String>,
}
