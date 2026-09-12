use serde::{Deserialize, Serialize};

/// Persisted `session.schedule_created` payload. Fields remain optional for older producers.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionScheduleCreatedData {
    pub id: Option<f64>,
    pub interval_ms: Option<f64>,
    pub cron: Option<String>,
    pub tz: Option<String>,
    pub at: Option<f64>,
    pub prompt: Option<String>,
    pub recurring: Option<bool>,
    pub self_paced: Option<bool>,
    pub display_prompt: Option<String>,
    pub origin: Option<String>,
}

/// Persisted `session.schedule_cancelled` payload. Fields remain optional for older producers.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionScheduleCancelledData {
    pub id: Option<f64>,
}

/// Persisted `session.schedule_rearmed` payload. Fields remain optional for older producers.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionScheduleRearmedData {
    pub id: Option<f64>,
    pub next_run_at: Option<f64>,
}

/// Persisted `session.autopilot_objective_changed` payload. Fields remain optional for older producers.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionAutopilotObjectiveChangedData {
    pub operation: Option<String>,
    pub id: Option<f64>,
    pub status: Option<String>,
}

/// Persisted `session.mode_notice_delivered` payload. Fields remain optional for older producers.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionModeNoticeDeliveredData {
    pub mode: Option<String>,
    pub content: Option<String>,
}

/// Persisted `session.permissions_changed` payload. Fields remain optional for older producers.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionPermissionsChangedData {
    pub previous_mode: Option<String>,
    pub mode: Option<String>,
    pub assisted_approval_model: Option<String>,
    // Retained for sessions written before the permission-mode rename.
    pub previous_allow_all_permissions: Option<bool>,
    pub allow_all_permissions: Option<bool>,
    pub previous_allow_all_permission_mode: Option<String>,
    pub allow_all_permission_mode: Option<String>,
}

/// Persisted `session.context_cleared` payload. Fields remain optional for older producers.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionContextClearedData {
    pub initial_message: Option<String>,
    pub messages_cleared: Option<f64>,
}

/// Persisted `session.completion_receipt` payload. Fields remain optional for older producers.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCompletionReceiptData {
    pub schema_version: Option<f64>,
    pub attempt: Option<f64>,
    pub source_event_id: Option<String>,
    pub event_range: Option<serde_json::Value>,
    pub stop_reason: Option<String>,
    pub final_tool: Option<serde_json::Value>,
    pub successful_tool_count: Option<f64>,
    pub failed_tool_count: Option<f64>,
}

/// Persisted `tool_search.activated` payload. Fields remain optional for older producers.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolSearchActivatedData {
    pub strategy: Option<String>,
    pub tool_names: Option<Vec<String>>,
}

/// Persisted `subagent.configured` payload. Fields remain optional for older producers.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubagentConfiguredData {
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
    pub context_tier: Option<String>,
    pub multi_turn: Option<bool>,
}

/// Persisted `session.binary_asset` payload. Fields remain optional for older producers.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionBinaryAssetData {
    pub asset_id: Option<String>,
    #[serde(rename = "type")]
    pub asset_type: Option<String>,
    pub mime_type: Option<String>,
    pub byte_length: Option<f64>,
    pub data: Option<String>,
    pub description: Option<String>,
    pub metadata: Option<serde_json::Value>,
}

/// Persisted `session.auto_mode_resolved` payload. Fields remain optional for older producers.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionAutoModeResolvedData {
    pub chosen_model: Option<String>,
    pub reasoning_bucket: Option<String>,
    pub category_scores: Option<serde_json::Value>,
    pub predicted_label: Option<String>,
    pub confidence: Option<f64>,
    pub candidate_models: Option<Vec<String>>,
    pub routing_method: Option<String>,
    pub available_models: Option<Vec<String>>,
    pub fallback: Option<bool>,
    pub fallback_reason: Option<String>,
    pub sticky_override: Option<bool>,
    pub router_latency_ms: Option<f64>,
    pub end_to_end_latency_ms: Option<f64>,
    pub chosen_shortfall: Option<f64>,
    pub has_image: Option<bool>,
}

/// Persisted `session.canvas.recorded` payload. Fields remain optional for older producers.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCanvasRecordedData {
    pub instance_id: Option<String>,
    pub extension_id: Option<String>,
    pub canvas_id: Option<String>,
    pub title: Option<String>,
    pub input: Option<serde_json::Value>,
}

/// Persisted `session.canvas.removed` payload. Fields remain optional for older producers.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCanvasRemovedData {
    pub instance_id: Option<String>,
    pub extension_id: Option<String>,
    pub canvas_id: Option<String>,
}
