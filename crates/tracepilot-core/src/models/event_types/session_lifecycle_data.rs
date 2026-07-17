use serde::{Deserialize, Serialize};
use std::collections::HashMap;

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
    /// Pricing/context-window tier selected for the session (for example
    /// `long_context`).
    pub context_tier: Option<String>,
    /// Optional AI Credit cap applied to this session.
    pub session_limits: Option<SessionLimitsConfig>,
    pub context: Option<SessionContext>,
    pub already_in_use: Option<bool>,
    /// The model selected at session creation.
    pub selected_model: Option<String>,
    /// Whether the session supports remote steering.
    pub remote_steerable: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionContext {
    pub cwd: Option<String>,
    pub git_root: Option<String>,
    pub branch: Option<String>,
    pub repository: Option<String>,
    pub host_type: Option<String>,
    pub repository_host: Option<String>,
    pub head_commit: Option<String>,
    pub base_commit: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShutdownData {
    pub shutdown_type: Option<String>,
    pub error_reason: Option<String>,
    pub total_premium_requests: Option<f64>,
    pub total_api_duration_ms: Option<u64>,
    pub session_start_time: Option<u64>,
    /// Persisted event-log size at shutdown. Its presence identifies the newer
    /// cumulative shutdown snapshot format without relying on a CLI version.
    pub events_file_size_bytes: Option<u64>,
    pub current_model: Option<String>,
    /// Total tokens in the context window at shutdown.
    pub current_tokens: Option<u64>,
    /// System prompt tokens at shutdown.
    pub system_tokens: Option<u64>,
    /// Conversation tokens at shutdown.
    pub conversation_tokens: Option<u64>,
    /// Tool definition tokens at shutdown.
    pub tool_definitions_tokens: Option<u64>,
    pub total_nano_aiu: Option<u64>,
    /// Whether source shutdown payloads were segment deltas or cumulative snapshots.
    pub source_metrics_scope: Option<ShutdownMetricsScope>,
    pub token_details: Option<HashMap<String, ShutdownTokenDetail>>,
    pub code_changes: Option<CodeChanges>,
    pub model_metrics: Option<HashMap<String, ModelMetricDetail>>,
    pub session_segments: Option<Vec<SessionSegment>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionSegment {
    pub start_timestamp: String,
    pub end_timestamp: String,
    pub tokens: u64,
    pub total_requests: u64,
    pub premium_requests: f64,
    pub api_duration_ms: u64,
    pub total_nano_aiu: Option<u64>,
    pub current_model: Option<String>,
    pub model_metrics: Option<HashMap<String, ModelMetricDetail>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ShutdownMetricsScope {
    Segment,
    Cumulative,
    Mixed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeChanges {
    pub lines_added: Option<u64>,
    pub lines_removed: Option<u64>,
    pub files_modified: Option<Vec<String>>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShutdownTokenDetail {
    pub token_count: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelMetricDetail {
    pub requests: Option<RequestMetrics>,
    pub usage: Option<UsageMetrics>,
    /// Observed usage-based billing amount for this model, in nano AI units.
    pub total_nano_aiu: Option<u64>,
    /// Observed billed token counts by billing category.
    pub token_details: Option<HashMap<String, ShutdownTokenDetail>>,
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
    pub reasoning_tokens: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionResumeData {
    pub resume_time: Option<String>,
    pub copilot_version: Option<String>,
    pub event_count: Option<u64>,
    pub selected_model: Option<String>,
    pub events_file_size_bytes: Option<u64>,
    pub reasoning_effort: Option<String>,
    pub context: Option<SessionContext>,
    pub context_tier: Option<String>,
    /// `None` represents either an omitted field or an explicitly cleared
    /// session limit, which are equivalent for persisted-session analysis.
    pub session_limits: Option<SessionLimitsConfig>,
    pub already_in_use: Option<bool>,
    pub session_was_active: Option<bool>,
    pub continue_pending_work: Option<bool>,
    /// Whether the session supports remote steering.
    pub remote_steerable: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionLimitsConfig {
    /// Maximum AI Credits allowed in the current session accounting window.
    pub max_ai_credits: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageCheckpointData {
    /// Session-wide accumulated usage in nano AI units.
    pub total_nano_aiu: u64,
    pub total_premium_requests: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionLimitsChangedData {
    pub session_limits: Option<SessionLimitsConfig>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionErrorData {
    pub error_type: Option<String>,
    pub message: Option<String>,
    pub stack: Option<String>,
    pub status_code: Option<u16>,
    pub provider_call_id: Option<String>,
    pub error_code: Option<String>,
    pub eligible_for_auto_switch: Option<bool>,
    /// URL with additional error details.
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfoData {
    pub info_type: Option<String>,
    pub message: Option<String>,
    /// URL with additional information.
    pub url: Option<String>,
    pub tip: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionWarningData {
    pub warning_type: Option<String>,
    pub message: Option<String>,
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionModeChangedData {
    pub previous_mode: Option<String>,
    pub new_mode: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTaskCompleteData {
    pub summary: Option<String>,
    pub success: Option<bool>,
}

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
    /// Host identifier for the handoff target.
    pub host: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HandoffRepository {
    pub owner: Option<String>,
    pub name: Option<String>,
    pub branch: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionImportLegacyData {
    pub legacy_session: Option<serde_json::Value>,
    pub import_time: Option<String>,
    pub source_file: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AbortData {
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemNotificationData {
    pub content: Option<String>,
    pub kind: Option<serde_json::Value>,
}

/// Data for `session.remote_steerable_changed` events.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRemoteSteerableChangedData {
    pub remote_steerable: Option<bool>,
}
