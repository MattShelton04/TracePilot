//! Typed event types and data structs matching the real Copilot CLI event schema.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;

/// All known session event types, plus an Unknown catch-all.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionEventType {
    SessionStart,
    SessionShutdown,
    SessionCompactionStart,
    SessionCompactionComplete,
    SessionPlanChanged,
    SessionModelChange,
    SessionInfo,
    SessionContextChanged,
    SessionError,
    SessionResume,
    SessionWorkspaceFileChanged,
    UserMessage,
    AssistantMessage,
    AssistantTurnStart,
    AssistantTurnEnd,
    ToolExecutionStart,
    ToolExecutionComplete,
    ToolUserRequested,
    SubagentStarted,
    SubagentCompleted,
    SubagentFailed,
    SystemNotification,
    SkillInvoked,
    Abort,
    Unknown(String),
}

impl From<&str> for SessionEventType {
    fn from(s: &str) -> Self {
        match s {
            "session.start" => Self::SessionStart,
            "session.shutdown" => Self::SessionShutdown,
            "session.compaction_start" => Self::SessionCompactionStart,
            "session.compaction_complete" => Self::SessionCompactionComplete,
            "session.plan_changed" => Self::SessionPlanChanged,
            "session.model_change" => Self::SessionModelChange,
            "session.info" => Self::SessionInfo,
            "session.context_changed" => Self::SessionContextChanged,
            "session.error" => Self::SessionError,
            "session.resume" => Self::SessionResume,
            "session.workspace_file_changed" => Self::SessionWorkspaceFileChanged,
            "user.message" => Self::UserMessage,
            "assistant.message" => Self::AssistantMessage,
            "assistant.turn_start" => Self::AssistantTurnStart,
            "assistant.turn_end" => Self::AssistantTurnEnd,
            "tool.execution_start" => Self::ToolExecutionStart,
            "tool.execution_complete" => Self::ToolExecutionComplete,
            "tool.user_requested" => Self::ToolUserRequested,
            "subagent.started" => Self::SubagentStarted,
            "subagent.completed" => Self::SubagentCompleted,
            "subagent.failed" => Self::SubagentFailed,
            "system.notification" => Self::SystemNotification,
            "skill.invoked" => Self::SkillInvoked,
            "abort" => Self::Abort,
            other => Self::Unknown(other.to_string()),
        }
    }
}

impl fmt::Display for SessionEventType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            Self::SessionStart => "session.start",
            Self::SessionShutdown => "session.shutdown",
            Self::SessionCompactionStart => "session.compaction_start",
            Self::SessionCompactionComplete => "session.compaction_complete",
            Self::SessionPlanChanged => "session.plan_changed",
            Self::SessionModelChange => "session.model_change",
            Self::SessionInfo => "session.info",
            Self::SessionContextChanged => "session.context_changed",
            Self::SessionError => "session.error",
            Self::SessionResume => "session.resume",
            Self::SessionWorkspaceFileChanged => "session.workspace_file_changed",
            Self::UserMessage => "user.message",
            Self::AssistantMessage => "assistant.message",
            Self::AssistantTurnStart => "assistant.turn_start",
            Self::AssistantTurnEnd => "assistant.turn_end",
            Self::ToolExecutionStart => "tool.execution_start",
            Self::ToolExecutionComplete => "tool.execution_complete",
            Self::ToolUserRequested => "tool.user_requested",
            Self::SubagentStarted => "subagent.started",
            Self::SubagentCompleted => "subagent.completed",
            Self::SubagentFailed => "subagent.failed",
            Self::SystemNotification => "system.notification",
            Self::SkillInvoked => "skill.invoked",
            Self::Abort => "abort",
            Self::Unknown(s) => s.as_str(),
        };
        write!(f, "{}", s)
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
        Ok(SessionEventType::from(s.as_str()))
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
