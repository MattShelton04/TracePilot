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
    pub average_health_score: f64,
    pub token_usage_by_day: Vec<DayTokens>,
    pub sessions_per_day: Vec<DaySessions>,
    pub model_distribution: Vec<ModelDistEntry>,
    pub cost_by_day: Vec<DayCost>,
    pub session_duration_stats: SessionDurationStats,
    pub productivity_metrics: ProductivityMetrics,
}

/// Token usage for a single day.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DayTokens {
    pub date: String,
    pub tokens: u64,
}

/// Session count for a single day.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DaySessions {
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
}

/// Cost for a single day.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DayCost {
    pub date: String,
    pub cost: f64,
}

/// Session duration statistics (avg, median, p95).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDurationStats {
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
