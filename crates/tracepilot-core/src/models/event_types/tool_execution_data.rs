use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolExecStartData {
    pub tool_call_id: Option<String>,
    pub turn_id: Option<String>,
    pub tool_name: Option<String>,
    pub arguments: Option<serde_json::Value>,
    pub parent_tool_call_id: Option<String>,
    pub mcp_server_name: Option<String>,
    pub mcp_tool_name: Option<String>,
    pub shell_tool_info: Option<serde_json::Value>,
    pub model: Option<String>,
    pub rte: Option<bool>,
    pub display_verbatim: Option<bool>,
    pub tool_description: Option<serde_json::Value>,
    pub fusion: Option<serde_json::Value>,
    /// Human-readable tool title (1.0.86+).
    pub tool_title: Option<String>,
    pub mcp_config_server_name: Option<String>,
    pub mcp_transport: Option<String>,
    pub mcp_config_source: Option<String>,
    /// The source's own tool name when `tool_name` is a canonical mapping
    /// (non-Copilot sources). Never written for Copilot events.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub native_tool_name: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolExecCompleteData {
    pub tool_call_id: Option<String>,
    pub turn_id: Option<String>,
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
    pub mcp_meta: Option<serde_json::Value>,
    pub rte: Option<bool>,
    pub tool_description: Option<serde_json::Value>,
    pub sandboxed: Option<bool>,
    pub fusion: Option<serde_json::Value>,
    /// Structured shell process outcome, including exit code (1.0.88+).
    pub shell_execution: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolUserRequestedData {
    pub tool_call_id: Option<String>,
    pub tool_name: Option<String>,
    pub arguments: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInvokedData {
    pub name: Option<String>,
    pub path: Option<String>,
    pub content: Option<String>,
    pub allowed_tools: Option<Vec<String>>,
    pub plugin_name: Option<String>,
    pub plugin_version: Option<String>,
    /// Human-readable description of the skill.
    pub description: Option<String>,
    pub model: Option<String>,
    pub disable_model_invocation: Option<bool>,
    pub source: Option<String>,
    pub trigger: Option<String>,
    /// Projected chat-message count at invocation (1.0.86+).
    pub invoked_at_turn: Option<u64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HookStartData {
    pub hook_invocation_id: Option<String>,
    pub hook_type: Option<String>,
    pub input: Option<serde_json::Value>,
    pub parent_tool_call_id: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HookEndData {
    pub hook_invocation_id: Option<String>,
    pub hook_type: Option<String>,
    pub success: Option<bool>,
    pub output: Option<serde_json::Value>,
    pub error: Option<HookError>,
    pub parent_tool_call_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HookError {
    pub message: Option<String>,
    pub stack: Option<String>,
    pub source: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionRequestedData {
    pub request_id: Option<String>,
    pub permission_request: Option<serde_json::Value>,
    pub prompt_request: Option<serde_json::Value>,
    pub resolved_by_hook: Option<bool>,
    pub agent_mode: Option<String>,
    pub risk_assessment: Option<serde_json::Value>,
    pub permission_mode: Option<String>,
    /// Autopilot permission-recovery episode this request belongs to.
    pub recovery_episode_id: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionCompletedData {
    pub request_id: Option<String>,
    pub tool_call_id: Option<String>,
    pub result: Option<serde_json::Value>,
    pub recovery_episode_id: Option<String>,
    pub blocker: Option<serde_json::Value>,
    /// Who decided: assisted approval, a human, host policy, etc.
    pub decision_source: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalToolRequestedData {
    pub request_id: Option<String>,
    pub session_id: Option<String>,
    pub tool_call_id: Option<String>,
    pub tool_name: Option<String>,
    pub arguments: Option<serde_json::Value>,
    pub traceparent: Option<String>,
    pub tracestate: Option<String>,
    pub provider_id: Option<serde_json::Value>,
    pub working_directory: Option<String>,
}
