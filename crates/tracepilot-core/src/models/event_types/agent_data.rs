use serde::{Deserialize, Serialize};

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
    /// Model used by the subagent.
    pub model: Option<String>,
    /// Total tool calls made during subagent execution.
    pub total_tool_calls: Option<u64>,
    /// Total tokens consumed by the subagent.
    pub total_tokens: Option<u64>,
    /// Duration of the subagent execution in milliseconds.
    pub duration_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubagentFailedData {
    pub tool_call_id: Option<String>,
    pub agent_name: Option<String>,
    pub agent_display_name: Option<String>,
    pub error: Option<String>,
    /// Model used by the subagent.
    pub model: Option<String>,
    /// Total tool calls made before failure.
    pub total_tool_calls: Option<u64>,
    /// Total tokens consumed before failure.
    pub total_tokens: Option<u64>,
    /// Duration before failure in milliseconds.
    pub duration_ms: Option<u64>,
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
