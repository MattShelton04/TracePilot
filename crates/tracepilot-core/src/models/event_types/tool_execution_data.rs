use serde::{Deserialize, Serialize};

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
pub struct ToolUserRequestedData {
    pub tool_call_id: Option<String>,
    pub tool_name: Option<String>,
    pub arguments: Option<serde_json::Value>,
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
pub struct HookStartData {
    pub hook_invocation_id: Option<String>,
    pub hook_type: Option<String>,
    pub input: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HookEndData {
    pub hook_invocation_id: Option<String>,
    pub hook_type: Option<String>,
    pub success: Option<bool>,
    pub output: Option<serde_json::Value>,
    pub error: Option<HookError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HookError {
    pub message: Option<String>,
    pub stack: Option<String>,
}
