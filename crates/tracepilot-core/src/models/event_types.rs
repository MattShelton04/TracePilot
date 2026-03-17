//! Typed event types and data structs matching the real Copilot CLI event schema.
//!
//! ## Event Type Registry
//!
//! [`SessionEventType`] enumerates all known Copilot CLI event types using their
//! wire-format strings (e.g. `"session.start"`, `"user.message"`). The enum uses
//! [`strum`] derives for zero-boilerplate string conversion:
//!
//! - `EnumString` — parse from wire string: `"session.start".parse::<SessionEventType>()`
//! - `Display` / `IntoStaticStr` — render back to wire string
//!
//! Unrecognized event types are captured as `Unknown(String)` rather than failing,
//! enabling graceful handling of new events from evolving Copilot CLI versions.
//!
//! ## Adding a New Event Type
//!
//! 1. Add a data struct below (all fields `Option<T>` for forward compat)
//! 2. Add a variant to [`SessionEventType`] with `#[strum(serialize = "wire.name")]`
//! 3. Add a corresponding variant to [`TypedEventData`]
//! 4. Add a match arm in [`typed_data_from_raw`]
//! 5. Handle the new variant in `turns/mod.rs` if it affects turn state

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;
use strum::{EnumString, IntoStaticStr};

/// All known session event types, plus an `Unknown` catch-all for forward compatibility.
///
/// Wire-format strings are specified via `#[strum(serialize = "...")]` attributes.
/// Use `.to_string()` to get the wire string, or `"wire.name".parse()` to convert.
///
/// The `Unknown` variant with `#[strum(default)]` captures any unrecognized string,
/// ensuring forward compatibility with new Copilot CLI event types.
#[derive(Debug, Clone, PartialEq, Eq, EnumString, IntoStaticStr)]
pub enum SessionEventType {
    #[strum(serialize = "session.start")]
    SessionStart,
    #[strum(serialize = "session.shutdown")]
    SessionShutdown,
    #[strum(serialize = "session.compaction_start")]
    SessionCompactionStart,
    #[strum(serialize = "session.compaction_complete")]
    SessionCompactionComplete,
    #[strum(serialize = "session.plan_changed")]
    SessionPlanChanged,
    #[strum(serialize = "session.model_change")]
    SessionModelChange,
    #[strum(serialize = "session.info")]
    SessionInfo,
    #[strum(serialize = "session.context_changed")]
    SessionContextChanged,
    #[strum(serialize = "session.error")]
    SessionError,
    #[strum(serialize = "session.resume")]
    SessionResume,
    #[strum(serialize = "session.workspace_file_changed")]
    SessionWorkspaceFileChanged,
    #[strum(serialize = "user.message")]
    UserMessage,
    #[strum(serialize = "assistant.message")]
    AssistantMessage,
    #[strum(serialize = "assistant.turn_start")]
    AssistantTurnStart,
    #[strum(serialize = "assistant.turn_end")]
    AssistantTurnEnd,
    #[strum(serialize = "tool.execution_start")]
    ToolExecutionStart,
    #[strum(serialize = "tool.execution_complete")]
    ToolExecutionComplete,
    #[strum(serialize = "tool.user_requested")]
    ToolUserRequested,
    #[strum(serialize = "subagent.started")]
    SubagentStarted,
    #[strum(serialize = "subagent.completed")]
    SubagentCompleted,
    #[strum(serialize = "subagent.failed")]
    SubagentFailed,
    #[strum(serialize = "system.notification")]
    SystemNotification,
    #[strum(serialize = "skill.invoked")]
    SkillInvoked,
    #[strum(serialize = "abort")]
    Abort,
    /// Catch-all for unrecognized event types from newer Copilot CLI versions.
    /// The contained string is the original wire-format type name.
    #[strum(default)]
    Unknown(String),
}

/// All known event type wire strings, for runtime introspection and validation.
pub const KNOWN_EVENT_TYPES: &[&str] = &[
    "session.start",
    "session.shutdown",
    "session.compaction_start",
    "session.compaction_complete",
    "session.plan_changed",
    "session.model_change",
    "session.info",
    "session.context_changed",
    "session.error",
    "session.resume",
    "session.workspace_file_changed",
    "user.message",
    "assistant.message",
    "assistant.turn_start",
    "assistant.turn_end",
    "tool.execution_start",
    "tool.execution_complete",
    "tool.user_requested",
    "subagent.started",
    "subagent.completed",
    "subagent.failed",
    "system.notification",
    "skill.invoked",
    "abort",
];

impl fmt::Display for SessionEventType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unknown(s) => write!(f, "{}", s),
            // For known variants, strum's IntoStaticStr gives us the wire string
            other => {
                let s: &'static str = other.into();
                write!(f, "{}", s)
            }
        }
    }
}

/// Parse a wire-format event type string (e.g. `"session.start"`) into a
/// [`SessionEventType`]. Unknown strings are captured as `Unknown(s)`.
///
/// This is infallible because `#[strum(default)]` on `Unknown` catches all
/// unrecognized input.
impl SessionEventType {
    pub fn parse_wire(s: &str) -> Self {
        s.parse().expect("strum default variant makes this infallible")
    }
}

impl Serialize for SessionEventType {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl<'de> Deserialize<'de> for SessionEventType {
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        Ok(SessionEventType::parse_wire(s.as_str()))
    }
}

// ── Typed event data structs ──────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStartData {
    pub session_id: Option<String>,
    /// Version can be a number or string depending on producer version.
    pub version: Option<serde_json::Value>,
    pub producer: Option<String>,
    pub copilot_version: Option<String>,
    /// ISO 8601 datetime string (e.g. "2026-03-11T23:09:12.854Z").
    pub start_time: Option<String>,
    pub reasoning_effort: Option<String>,
    pub context: Option<SessionContext>,
    pub already_in_use: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionContext {
    pub cwd: Option<String>,
    pub git_root: Option<String>,
    pub branch: Option<String>,
    pub repository: Option<String>,
    pub host_type: Option<String>,
    pub head_commit: Option<String>,
    pub base_commit: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShutdownData {
    pub shutdown_type: Option<String>,
    pub total_premium_requests: Option<f64>,
    pub total_api_duration_ms: Option<u64>,
    pub session_start_time: Option<u64>,
    pub current_model: Option<String>,
    pub code_changes: Option<CodeChanges>,
    pub model_metrics: Option<HashMap<String, ModelMetricDetail>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeChanges {
    pub lines_added: Option<u64>,
    pub lines_removed: Option<u64>,
    pub files_modified: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelMetricDetail {
    pub requests: Option<RequestMetrics>,
    pub usage: Option<UsageMetrics>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestMetrics {
    pub count: Option<u64>,
    pub cost: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageMetrics {
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub cache_read_tokens: Option<u64>,
    pub cache_write_tokens: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserMessageData {
    pub content: Option<String>,
    pub transformed_content: Option<String>,
    pub attachments: Option<Vec<serde_json::Value>>,
    pub interaction_id: Option<String>,
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantMessageData {
    pub message_id: Option<String>,
    pub content: Option<String>,
    pub interaction_id: Option<String>,
    pub tool_requests: Option<Vec<serde_json::Value>>,
    pub output_tokens: Option<u64>,
    pub parent_tool_call_id: Option<String>,
    /// Visible chain-of-thought reasoning text.
    pub reasoning_text: Option<String>,
    /// Encrypted/opaque reasoning blob (not human-readable).
    pub reasoning_opaque: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnStartData {
    pub turn_id: Option<String>,
    pub interaction_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnEndData {
    pub turn_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolExecStartData {
    pub tool_call_id: Option<String>,
    pub tool_name: Option<String>,
    pub arguments: Option<serde_json::Value>,
    pub parent_tool_call_id: Option<String>,
    pub mcp_server_name: Option<String>,
    pub mcp_tool_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolExecCompleteData {
    pub tool_call_id: Option<String>,
    pub parent_tool_call_id: Option<String>,
    pub model: Option<String>,
    pub interaction_id: Option<String>,
    pub success: Option<bool>,
    pub result: Option<serde_json::Value>,
    /// Error can be a string message or a structured object.
    pub error: Option<serde_json::Value>,
    pub tool_telemetry: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubagentStartedData {
    pub tool_call_id: Option<String>,
    pub agent_name: Option<String>,
    pub agent_display_name: Option<String>,
    pub agent_description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubagentCompletedData {
    pub tool_call_id: Option<String>,
    pub agent_name: Option<String>,
    pub agent_display_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubagentFailedData {
    pub tool_call_id: Option<String>,
    pub agent_name: Option<String>,
    pub agent_display_name: Option<String>,
    pub error: Option<String>,
}

// ── New typed event data structs ──────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompactionCompleteData {
    pub success: Option<bool>,
    pub error: Option<String>,
    pub pre_compaction_tokens: Option<u64>,
    pub pre_compaction_messages_length: Option<u64>,
    pub summary_content: Option<String>,
    pub checkpoint_number: Option<u64>,
    pub checkpoint_path: Option<String>,
    pub compaction_tokens_used: Option<CompactionTokenUsage>,
    pub request_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompactionTokenUsage {
    pub input: Option<u64>,
    pub output: Option<u64>,
    pub cached_input: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompactionStartData {
    // Typically empty — value is in the timestamp.
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelChangeData {
    pub previous_model: Option<String>,
    pub new_model: Option<String>,
    pub previous_reasoning_effort: Option<String>,
    pub reasoning_effort: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionErrorData {
    pub error_type: Option<String>,
    pub message: Option<String>,
    pub stack: Option<String>,
    pub status_code: Option<u16>,
    pub provider_call_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionResumeData {
    pub resume_time: Option<String>,
    pub event_count: Option<u64>,
    pub selected_model: Option<String>,
    pub reasoning_effort: Option<String>,
    pub context: Option<SessionContext>,
    pub already_in_use: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemNotificationData {
    pub content: Option<String>,
    pub kind: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInvokedData {
    pub name: Option<String>,
    pub path: Option<String>,
    pub content: Option<String>,
    pub allowed_tools: Option<Vec<String>>,
    pub plugin_name: Option<String>,
    pub plugin_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AbortData {
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanChangedData {
    pub operation: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfoData {
    pub info_type: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileChangedData {
    pub path: Option<String>,
    pub operation: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolUserRequestedData {
    pub tool_call_id: Option<String>,
    pub tool_name: Option<String>,
    pub arguments: Option<serde_json::Value>,
}
