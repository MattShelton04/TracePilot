use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserMessageData {
    pub content: Option<String>,
    pub transformed_content: Option<String>,
    pub attachments: Option<Vec<serde_json::Value>>,
    pub supported_native_document_mime_types: Option<Vec<String>>,
    pub native_document_path_fallback_paths: Option<Vec<String>>,
    pub interaction_id: Option<String>,
    pub source: Option<String>,
    /// The agent mode active when the user sent this message.
    pub agent_mode: Option<String>,
    /// Parent agent task when the message belongs to a delegated/background task.
    pub parent_agent_task_id: Option<String>,
    pub message_id: Option<String>,
    pub delivery: Option<String>,
    pub is_autopilot_continuation: Option<bool>,
    pub turn_id: Option<String>,
    /// Reasoning effort/model requested for this message (1.0.88+).
    pub responses_reasoning: Option<serde_json::Value>,
    /// Background tasks whose completion this message reports, one per
    /// `<task-notification>` block (Claude Code). Empty for typed prompts.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub notifications: Vec<TaskNotificationData>,
}

/// What kind of background task a [`TaskNotificationData`] reports on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskNotificationKind {
    /// A subagent launched with `Agent`.
    Agent,
    /// A background shell command.
    Shell,
}

/// One background task completion, as Claude Code reports it in a
/// `<task-notification>` block.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskNotificationData {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    /// The tool call that launched the task.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_use_id: Option<String>,
    pub kind: TaskNotificationKind,
    /// `completed`, `failed`, `stopped`, … as written.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    /// The task's final report, when the notification carries one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_file: Option<String>,
    /// A shell's exit code, from its summary.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_uses: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantMessageData {
    pub message_id: Option<String>,
    pub turn_id: Option<String>,
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
    /// LLM request ID for tracing individual API calls.
    pub request_id: Option<String>,
    pub model: Option<String>,
    pub reasoning_wire_field: Option<String>,
    pub chunk_index: Option<f64>,
    pub chunk_count: Option<f64>,
    pub client_request_id: Option<String>,
    pub service_request_id: Option<String>,
    pub rte: Option<bool>,
    pub api_call_id: Option<String>,
    pub server_tools: Option<serde_json::Value>,
    pub reasoning_blocks: Option<serde_json::Value>,
    pub citations: Option<serde_json::Value>,
    pub fusion: Option<serde_json::Value>,
    /// `messageId` of the user message that initiated this run, stable across
    /// tool iterations and steering (1.0.88+).
    pub originating_message_id: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnStartData {
    pub turn_id: Option<String>,
    pub interaction_id: Option<String>,
    pub model: Option<String>,
    /// Launching tool call when the turn belongs to a subagent (1.0.86+).
    pub parent_tool_call_id: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnEndData {
    pub turn_id: Option<String>,
    pub model: Option<String>,
    pub parent_tool_call_id: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemMessageData {
    pub content: Option<String>,
    /// "system" or "developer".
    pub role: Option<String>,
    pub name: Option<String>,
    pub metadata: Option<SystemMessageMetadata>,
    pub interaction_id: Option<String>,
    /// Prompt split into cacheable blocks (1.0.88+).
    pub content_blocks: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemMessageMetadata {
    pub prompt_version: Option<String>,
    pub variables: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanChangedData {
    pub operation: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileChangedData {
    pub path: Option<String>,
    pub operation: Option<String>,
}
