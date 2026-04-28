//! Backend-owned live SDK session state.
//!
//! The raw SDK event stream remains available for debugging, while this module
//! promotes a compact, durable-in-process state snapshot keyed by session ID.

mod reducer;
mod store;

pub use store::LiveStateStore;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionRuntimeStatus {
    Idle,
    Running,
    WaitingForInput,
    WaitingForPermission,
    Error,
    Shutdown,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolProgressSummary {
    pub tool_call_id: Option<String>,
    pub tool_name: Option<String>,
    pub status: String,
    pub message: Option<String>,
    pub progress: Option<f64>,
    pub partial_result: Option<serde_json::Value>,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingRequestSummary {
    pub request_id: Option<String>,
    pub kind: String,
    pub summary: Option<String>,
    pub payload: serde_json::Value,
    pub requested_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionLiveState {
    pub session_id: String,
    pub status: SessionRuntimeStatus,
    pub current_turn_id: Option<String>,
    pub assistant_text: String,
    pub reasoning_text: String,
    pub tools: Vec<ToolProgressSummary>,
    pub usage: Option<serde_json::Value>,
    pub pending_permission: Option<PendingRequestSummary>,
    pub pending_user_input: Option<PendingRequestSummary>,
    pub last_event_id: Option<String>,
    pub last_event_type: Option<String>,
    pub last_event_timestamp: Option<String>,
    pub last_error: Option<String>,
    pub reducer_warnings: Vec<String>,
    /// Drained-out-of-buffer prefix of `assistant_text`. Internal bookkeeping
    /// for the timestamp-based reorder buffer; not serialized over the wire.
    #[serde(skip)]
    pub(super) assistant_committed: String,
    #[serde(skip)]
    pub(super) reasoning_committed: String,
    /// Pending message deltas, sorted ascending by `event.timestamp`. Pinned
    /// Copilot SDK `tokio::spawn`s a fresh task per `session.event` notification
    /// so adjacent deltas can race; we hold the most recent few here and sort
    /// before committing.
    #[serde(skip)]
    pub(super) assistant_pending: Vec<PendingDelta>,
    #[serde(skip)]
    pub(super) reasoning_pending: Vec<PendingDelta>,
}

#[derive(Debug, Clone, PartialEq)]
pub(super) struct PendingDelta {
    pub delta: String,
    pub timestamp: String,
}

impl SessionLiveState {
    pub fn new(session_id: impl Into<String>) -> Self {
        Self {
            session_id: session_id.into(),
            status: SessionRuntimeStatus::Unknown,
            current_turn_id: None,
            assistant_text: String::new(),
            reasoning_text: String::new(),
            tools: Vec::new(),
            usage: None,
            pending_permission: None,
            pending_user_input: None,
            last_event_id: None,
            last_event_type: None,
            last_event_timestamp: None,
            last_error: None,
            reducer_warnings: Vec::new(),
            assistant_committed: String::new(),
            reasoning_committed: String::new(),
            assistant_pending: Vec::new(),
            reasoning_pending: Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_reorder;
