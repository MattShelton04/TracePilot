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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubagentFailedData {
    pub tool_call_id: Option<String>,
    pub agent_name: Option<String>,
    pub agent_display_name: Option<String>,
    pub error: Option<String>,
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
