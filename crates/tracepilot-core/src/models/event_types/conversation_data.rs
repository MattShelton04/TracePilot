use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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
pub struct SystemMessageData {
    pub content: Option<String>,
    /// "system" or "developer".
    pub role: Option<String>,
    pub name: Option<String>,
    pub metadata: Option<SystemMessageMetadata>,
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
