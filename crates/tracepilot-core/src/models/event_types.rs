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
    // ── New event types ──
    #[strum(serialize = "session.truncation")]
    SessionTruncation,
    #[strum(serialize = "assistant.reasoning")]
    AssistantReasoning,
    #[strum(serialize = "system.message")]
    SystemMessage,
    #[strum(serialize = "session.warning")]
    SessionWarning,
    #[strum(serialize = "session.mode_changed")]
    SessionModeChanged,
    #[strum(serialize = "session.task_complete")]
    SessionTaskComplete,
    #[strum(serialize = "subagent.selected")]
    SubagentSelected,
    #[strum(serialize = "subagent.deselected")]
    SubagentDeselected,
    #[strum(serialize = "hook.start")]
    HookStart,
    #[strum(serialize = "hook.end")]
    HookEnd,
    #[strum(serialize = "session.handoff")]
    SessionHandoff,
    #[strum(serialize = "session.import_legacy")]
    SessionImportLegacy,
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
    // New event types
    "session.truncation",
    "assistant.reasoning",
    "system.message",
    "session.warning",
    "session.mode_changed",
    "session.task_complete",
    "subagent.selected",
    "subagent.deselected",
    "hook.start",
    "hook.end",
    "session.handoff",
    "session.import_legacy",
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
    /// The model selected at session creation.
    pub selected_model: Option<String>,
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
    /// The agent mode active when the user sent this message.
    pub agent_mode: Option<String>,
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
    /// Encrypted reasoning content (session-bound, stripped on resume).
    pub encrypted_content: Option<String>,
    /// Generation phase for phased-output models.
    pub phase: Option<String>,
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
    /// Whether the tool call was initiated by the user (vs the agent).
    pub is_user_requested: Option<bool>,
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
    /// URL with additional error details.
    pub url: Option<String>,
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
    /// URL with additional information.
    pub url: Option<String>,
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

// ── New event data structs (Tier 1 + Tier 2) ─────────────────────────

/// Data for `session.truncation` events — context window pressure metrics.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTruncationData {
    pub token_limit: Option<u64>,
    pub pre_truncation_tokens_in_messages: Option<u64>,
    pub pre_truncation_messages_length: Option<u64>,
    pub post_truncation_tokens_in_messages: Option<u64>,
    pub post_truncation_messages_length: Option<u64>,
    pub tokens_removed_during_truncation: Option<u64>,
    pub messages_removed_during_truncation: Option<u64>,
    pub performed_by: Option<String>,
}

/// Data for `assistant.reasoning` events — standalone reasoning blocks.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantReasoningData {
    pub reasoning_id: Option<String>,
    pub content: Option<String>,
}

/// Data for `system.message` events — system/developer prompts.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemMessageData {
    pub content: Option<String>,
    /// "system" or "developer".
    pub role: Option<String>,
    pub name: Option<String>,
    pub metadata: Option<SystemMessageMetadata>,
}

/// Metadata attached to system messages.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemMessageMetadata {
    pub prompt_version: Option<String>,
    pub variables: Option<serde_json::Value>,
}

/// Data for `session.warning` events.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionWarningData {
    pub warning_type: Option<String>,
    pub message: Option<String>,
    pub url: Option<String>,
}

/// Data for `session.mode_changed` events.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionModeChangedData {
    pub previous_mode: Option<String>,
    pub new_mode: Option<String>,
}

/// Data for `session.task_complete` events.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTaskCompleteData {
    pub summary: Option<String>,
}

/// Data for `subagent.selected` events — custom agent activation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubagentSelectedData {
    pub agent_name: Option<String>,
    pub agent_display_name: Option<String>,
    pub tools: Option<Vec<String>>,
}

/// Data for `subagent.deselected` events — custom agent deactivation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubagentDeselectedData {}

/// Data for `hook.start` events.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HookStartData {
    pub hook_invocation_id: Option<String>,
    pub hook_type: Option<String>,
    pub input: Option<serde_json::Value>,
}

/// Data for `hook.end` events.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HookEndData {
    pub hook_invocation_id: Option<String>,
    pub hook_type: Option<String>,
    pub success: Option<bool>,
    pub output: Option<serde_json::Value>,
    pub error: Option<HookError>,
}

/// Structured error from a hook execution.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HookError {
    pub message: Option<String>,
    pub stack: Option<String>,
}

/// Data for `session.handoff` events — cross-session handoff.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionHandoffData {
    pub handoff_time: Option<String>,
    /// "remote" or "local".
    pub source_type: Option<String>,
    pub repository: Option<HandoffRepository>,
    pub context: Option<String>,
    pub summary: Option<String>,
    pub remote_session_id: Option<String>,
}

/// Repository context in a session handoff.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HandoffRepository {
    pub owner: Option<String>,
    pub name: Option<String>,
    pub branch: Option<String>,
}

/// Data for `session.import_legacy` events — importing pre-events sessions.
/// Uses `Value` for the nested legacy session to avoid a massive type tree.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionImportLegacyData {
    pub legacy_session: Option<serde_json::Value>,
    pub import_time: Option<String>,
    pub source_file: Option<String>,
}
