//! Conversation turn model — groups flat events into logical turns.
//!
//! A "turn" is one user message + the assistant's full response (including tool calls).

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// A single conversation turn.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationTurn {
    pub turn_index: usize,
    pub user_message: Option<String>,
    pub assistant_message: Option<String>,
    pub model: Option<String>,
    pub timestamp: Option<DateTime<Utc>>,
    pub tool_calls: Vec<TurnToolCall>,
    pub duration_ms: Option<u64>,
}

/// A tool call within a conversation turn.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TurnToolCall {
    pub tool_name: String,
    pub status: Option<String>,
    pub duration_ms: Option<u64>,
    pub timestamp: Option<DateTime<Utc>>,
}
