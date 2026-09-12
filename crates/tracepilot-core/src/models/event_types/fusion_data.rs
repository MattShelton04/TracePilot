use serde::{Deserialize, Serialize};

/// Persisted `session.fusion_route_failed` payload. Fields remain optional for older producers.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionFusionRouteFailedData {
    pub attempt_id: Option<String>,
    pub synthetic_model: Option<String>,
    pub policy: Option<String>,
    pub reason: Option<String>,
    pub error_message: Option<String>,
    pub fallback_model: Option<String>,
    pub routing_latency_ms: Option<f64>,
}

/// Persisted `session.fusion_resolved` payload. Fields remain optional for older producers.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionFusionResolvedData {
    pub fusion_id: Option<String>,
    pub turn_id: Option<String>,
    pub contract_version: Option<f64>,
    pub synthetic_model: Option<String>,
    pub policy: Option<String>,
    pub route_source: Option<String>,
    pub plan_version: Option<String>,
    pub policy_version: Option<String>,
    pub model_universe_version: Option<String>,
    pub rule_id: Option<String>,
    pub rule_index: Option<f64>,
    pub rule_name: Option<String>,
    pub scores: Option<serde_json::Value>,
    pub pattern: Option<String>,
    pub phase_plan: Option<Vec<serde_json::Value>>,
    pub primary_model: Option<String>,
    pub secondary_model: Option<serde_json::Value>,
    pub fallback_model: Option<String>,
    pub follow_up_model: Option<String>,
    pub follow_up: Option<serde_json::Value>,
    pub routing_latency_ms: Option<f64>,
}

/// Persisted `session.fusion_handoff` payload. Fields remain optional for older producers.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionFusionHandoffData {
    pub fusion_id: Option<String>,
    pub source_phase_id: Option<String>,
    pub target_phase_id: Option<String>,
    pub target_model: Option<String>,
    pub message: Option<serde_json::Value>,
}

/// Persisted `session.fusion_commit_started` payload. Fields remain optional for older producers.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionFusionCommitStartedData {
    pub fusion_id: Option<String>,
    pub commit_id: Option<String>,
    pub source_phase_id: Option<String>,
    pub source_model: Option<String>,
    pub kind: Option<String>,
    pub tool_call_id: Option<serde_json::Value>,
}

/// Persisted `session.fusion_completed` payload. Fields remain optional for older producers.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionFusionCompletedData {
    pub fusion_id: Option<String>,
    pub commit_id: Option<String>,
    pub turn_id: Option<String>,
    pub synthetic_model: Option<String>,
    pub pattern: Option<String>,
    pub outcome: Option<String>,
    pub final_source_phase_id: Option<serde_json::Value>,
    pub final_source_model: Option<serde_json::Value>,
    pub follow_up_model: Option<String>,
    pub degraded_reason: Option<serde_json::Value>,
    pub phase_count: Option<f64>,
    pub request_count: Option<f64>,
    pub input_tokens: Option<f64>,
    pub output_tokens: Option<f64>,
    pub cached_tokens: Option<f64>,
    pub cache_write_tokens: Option<f64>,
    pub total_nano_aiu: Option<f64>,
    pub duration_ms: Option<f64>,
}

/// Persisted `assistant.fusion_phase_completed` payload. Fields remain optional for older producers.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantFusionPhaseCompletedData {
    pub fusion_id: Option<String>,
    pub phase_id: Option<String>,
    pub phase_kind: Option<String>,
    pub role: Option<String>,
    pub conversation_scope: Option<String>,
    pub model: Option<String>,
    pub status: Option<String>,
    pub content: Option<String>,
    pub verdict: Option<serde_json::Value>,
    pub duration_ms: Option<f64>,
    pub usage: Option<serde_json::Value>,
    pub projection_message: Option<serde_json::Value>,
    pub projection_mode: Option<String>,
    pub staged_terminal: Option<serde_json::Value>,
}

/// Persisted `assistant.fusion_phase_failed` payload. Fields remain optional for older producers.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantFusionPhaseFailedData {
    pub fusion_id: Option<String>,
    pub phase_id: Option<String>,
    pub phase_kind: Option<String>,
    pub role: Option<String>,
    pub conversation_scope: Option<String>,
    pub model: Option<String>,
    pub status: Option<String>,
    pub reason: Option<String>,
    pub duration_ms: Option<f64>,
    pub usage: Option<serde_json::Value>,
    pub error_message: Option<String>,
    pub degraded_to_phase_id: Option<String>,
}
