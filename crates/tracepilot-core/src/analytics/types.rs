//! Analytics data types matching the TypeScript interfaces in `@tracepilot/types`.
//!
//! All structs use `#[serde(rename_all = "camelCase")]` to align with the
//! frontend's camelCase field names when serialized to JSON.

use serde::{Deserialize, Serialize};

use crate::models::conversation::ConversationTurn;
use crate::models::session_summary::SessionSummary;

// ── Input type ────────────────────────────────────────────────────────

/// Pre-loaded session data needed for analytics aggregation.
///
/// Two loading tiers:
/// - **Summary-only** (`turns = None`): Sufficient for `compute_analytics()` and `compute_code_impact()`
/// - **Full** (`turns = Some(...)`): Required for `compute_tool_analysis()`
#[derive(Debug, Clone)]
pub struct SessionAnalyticsInput {
    pub summary: SessionSummary,
    /// Conversation turns — only loaded when tool analysis is needed.
    pub turns: Option<Vec<ConversationTurn>>,
}

// ── Analytics Dashboard ───────────────────────────────────────────────

/// Aggregated analytics data across all sessions.
/// Mirrors TS `AnalyticsData` interface.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsData {
    pub total_sessions: u32,
    pub total_tokens: u64,
    pub total_cost: f64,
    pub total_premium_requests: f64,
    pub token_usage_by_day: Vec<DayTokens>,
    pub activity_per_day: Vec<DayActivity>,
    pub model_distribution: Vec<ModelDistEntry>,
    pub cost_by_day: Vec<DayCost>,
    pub api_duration_stats: ApiDurationStats,
    pub productivity_metrics: ProductivityMetrics,
    pub cache_stats: CacheStats,
    pub sessions_with_errors: u32,
    pub total_rate_limits: u64,
    pub total_compactions: u64,
    pub total_truncations: u64,
    pub incidents_by_day: Vec<DayIncidents>,
}

/// Token usage for a single day.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DayTokens {
    pub date: String,
    pub tokens: u64,
}

/// Activity (session segment) count for a single day.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DayActivity {
    pub date: String,
    pub count: u32,
}

/// Model distribution entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelDistEntry {
    pub model: String,
    pub tokens: u64,
    pub percentage: f64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub premium_requests: f64,
    /// Number of API requests made to this model.
    pub request_count: u64,
    /// Total reasoning tokens consumed by this model (None = data unavailable).
    pub reasoning_tokens: Option<u64>,
}

/// Cost for a single day.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DayCost {
    pub date: String,
    pub cost: f64,
}

/// Incident counts for a single day.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DayIncidents {
    pub date: String,
    pub errors: u64,
    pub rate_limits: u64,
    pub compactions: u64,
    pub truncations: u64,
}

/// API duration statistics (avg, median, p95) computed from `total_api_duration_ms`.
///
/// These measure the cumulative time spent waiting for API responses per session,
/// not wall-clock session time.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiDurationStats {
    pub avg_ms: f64,
    pub median_ms: f64,
    pub p95_ms: f64,
    pub min_ms: u64,
    pub max_ms: u64,
    pub total_sessions_with_duration: u32,
}

/// Productivity heuristics across sessions.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductivityMetrics {
    pub avg_turns_per_session: f64,
    pub avg_tool_calls_per_turn: f64,
    pub avg_tokens_per_turn: f64,
    /// Average tokens generated per second of API time (throughput indicator).
    pub avg_tokens_per_api_second: f64,
}

/// Prompt cache efficiency metrics across all sessions.
///
/// `cache_hit_rate` = `total_cache_read_tokens` / `total_input_tokens` * 100.
/// `non_cached_input_tokens` = `total_input_tokens` - `total_cache_read_tokens`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheStats {
    /// Total tokens served from prompt cache across all sessions.
    pub total_cache_read_tokens: u64,
    /// Total input tokens (cache reads are a subset of this).
    pub total_input_tokens: u64,
    /// Fraction of input tokens served from cache (0–100 %).
    pub cache_hit_rate: f64,
    /// Fresh (non-cached) input tokens = total_input - cache_read.
    pub non_cached_input_tokens: u64,
}

// ── Tool Analysis ─────────────────────────────────────────────────────

/// Tool usage analysis data.
/// Mirrors TS `ToolAnalysisData` interface.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolAnalysisData {
    pub total_calls: u32,
    pub success_rate: f64,
    pub avg_duration_ms: f64,
    pub most_used_tool: String,
    pub tools: Vec<ToolUsageEntry>,
    pub activity_heatmap: Vec<HeatmapEntry>,
}

/// Per-tool usage statistics.
/// Mirrors TS `ToolUsageEntry` interface.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolUsageEntry {
    pub name: String,
    pub call_count: u32,
    pub success_rate: f64,
    pub avg_duration_ms: f64,
    pub total_duration_ms: f64,
}

/// Activity heatmap entry (hour × day-of-week).
/// `day` is 0=Monday..6=Sunday (ISO 8601 weekday).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeatmapEntry {
    pub day: u32,
    pub hour: u32,
    pub count: u32,
}

// ── Code Impact ───────────────────────────────────────────────────────

/// Code impact analysis data.
/// Mirrors TS `CodeImpactData` interface.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeImpactData {
    pub files_modified: u32,
    pub lines_added: u64,
    pub lines_removed: u64,
    pub net_change: i64,
    pub file_type_breakdown: Vec<FileTypeEntry>,
    pub most_modified_files: Vec<ModifiedFileEntry>,
    pub changes_by_day: Vec<DayChanges>,
}

/// File type breakdown entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileTypeEntry {
    pub extension: String,
    pub count: u32,
    pub percentage: f64,
}

/// Most-modified file entry.
/// Note: Per-file additions/deletions are not available from shutdown data.
/// `modifications` is the number of sessions that modified this file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModifiedFileEntry {
    pub path: String,
    pub additions: u64,
    pub deletions: u64,
}

/// Daily code change summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DayChanges {
    pub date: String,
    pub additions: u64,
    pub deletions: u64,
}
