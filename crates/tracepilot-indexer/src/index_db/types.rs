//! Types and constants for the index database.

/// Maximum byte length for full-text search content per session.
pub(super) const FTS_CONTENT_MAX_BYTES: usize = 100_000;

/// Bump this when the analytics schema or extraction logic changes.
/// Sessions with a stored analytics_version below this will be re-indexed.
/// v5: Tool-result-only cache — byte offsets for tool.execution_complete events.
pub(super) const CURRENT_ANALYTICS_VERSION: i64 = 5;

/// Maximum incidents stored per session to prevent DB bloat.
pub(super) const MAX_INCIDENTS_PER_SESSION: usize = 100;

/// Lightweight per-session info returned after indexing a session.
/// Used to enrich progress events with live stats.
#[derive(Debug, Clone)]
pub struct SessionIndexInfo {
    pub repository: Option<String>,
    pub branch: Option<String>,
    pub current_model: Option<String>,
    pub total_tokens: u64,
    pub event_count: usize,
    pub turn_count: usize,
}

/// A session record from the index database.
#[derive(Debug, Clone)]
pub struct IndexedSession {
    pub id: String,
    pub path: String,
    pub summary: Option<String>,
    pub repository: Option<String>,
    pub branch: Option<String>,
    pub cwd: Option<String>,
    pub host_type: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub event_count: Option<i64>,
    pub turn_count: Option<i64>,
    pub current_model: Option<String>,
    pub error_count: Option<i64>,
    pub rate_limit_count: Option<i64>,
    pub compaction_count: Option<i64>,
    pub truncation_count: Option<i64>,
}

/// Public return struct for session incident queries.
#[derive(Debug, Clone)]
pub struct IndexedIncident {
    pub event_type: String,
    pub source_event_type: String,
    pub timestamp: Option<String>,
    pub severity: String,
    pub summary: String,
    pub detail_json: Option<String>,
}

// ── Internal types used by the session writer ─────────────────────────

/// Named row for per-model metrics.
pub(super) struct ModelMetricsRow {
    pub model: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_write_tokens: i64,
    pub cost: f64,
    pub premium_requests: i64,
}

/// Named row for per-tool call stats.
pub(super) struct ToolCallRow {
    pub name: String,
    pub calls: i64,
    pub success: i64,
    pub failure: i64,
    pub duration_ms: i64,
    pub calls_with_duration: i64,
}

/// Named row for activity heatmap data.
pub(super) struct ActivityRow {
    pub day_of_week: i64,
    pub hour: i64,
    pub tool_call_count: i64,
}

/// Named row for modified file data.
pub(super) struct ModifiedFileRow {
    pub file_path: String,
    pub extension: Option<String>,
}

/// Row for the session_incidents table.
#[derive(Debug)]
pub(super) struct IncidentRow {
    pub event_type: String,
    pub source_event_type: String,
    pub timestamp: Option<String>,
    pub severity: String,
    pub summary: String,
    pub detail_json: Option<String>,
}

/// Aggregated analytics extracted from a session's events and summary.
/// This is a pure data struct produced by `extract_session_analytics`
/// without any database interaction, making analytics computation
/// independently testable.
pub(super) struct SessionAnalytics {
    // Aggregate token/cost metrics
    pub total_tokens: i64,
    pub total_cost: f64,
    pub lines_added: Option<i64>,
    pub lines_removed: Option<i64>,
    pub duration_ms: Option<i64>,
    pub health_score: f64,
    pub tool_call_count: Option<i64>,

    // Shutdown metrics pass-through
    pub shutdown_type: Option<String>,
    pub current_model: Option<String>,
    pub total_premium_requests: Option<f64>,
    pub total_api_duration_ms: Option<i64>,

    // File system metadata
    pub workspace_mtime: Option<String>,
    pub events_mtime: Option<String>,
    pub events_size: Option<i64>,

    // Child table rows
    pub model_rows: Vec<ModelMetricsRow>,
    pub tool_call_rows: Vec<ToolCallRow>,
    pub activity_rows: Vec<ActivityRow>,
    pub modified_file_rows: Vec<ModifiedFileRow>,
    pub fts_content: String,

    // Incident counters
    pub error_count: i64,
    pub rate_limit_count: i64,
    pub warning_count: i64,
    pub compaction_count: i64,
    pub truncation_count: i64,
    pub last_error_type: Option<String>,
    pub last_error_message: Option<String>,
    pub total_compaction_input: i64,
    pub total_compaction_output: i64,
    pub incidents: Vec<IncidentRow>,
}

/// Return value from `IndexDb::get_file_metadata`.
pub(super) struct SessionFileMeta {
    pub workspace_mtime: Option<String>,
    pub events_mtime: Option<String>,
    pub events_size: Option<i64>,
}

/// Build file metadata for a session path.
impl SessionFileMeta {
    pub fn from_session_path(session_path: &std::path::Path) -> Self {
        let workspace_mtime = get_workspace_mtime(session_path);
        let events_meta = get_events_mtime_and_size(session_path);
        let events_mtime = events_meta.as_ref().map(|(m, _)| m.clone());
        let events_size = events_meta.map(|(_, s)| s as i64);
        Self {
            workspace_mtime,
            events_mtime,
            events_size,
        }
    }
}

pub(super) fn get_workspace_mtime(session_path: &std::path::Path) -> Option<String> {
    let ws_path = session_path.join("workspace.yaml");
    std::fs::metadata(&ws_path)
        .ok()
        .and_then(|m| m.modified().ok())
        .map(|t| {
            let dt: chrono::DateTime<chrono::Utc> = t.into();
            dt.to_rfc3339()
        })
}

pub(super) fn get_events_mtime_and_size(session_path: &std::path::Path) -> Option<(String, u64)> {
    let ev_path = session_path.join("events.jsonl");
    let meta = std::fs::metadata(&ev_path).ok()?;
    let mtime = meta.modified().ok()?;
    let dt: chrono::DateTime<chrono::Utc> = mtime.into();
    Some((dt.to_rfc3339(), meta.len()))
}

/// Decision for how to reindex a session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReindexDecision {
    /// Session is up-to-date, skip it.
    Skip,
    /// Full reindex: clear all cached data and reparse from scratch.
    FullReindex,
}

/// Key session fields from the index, used to construct a SessionSummary
/// without re-parsing disk files.
#[derive(Debug, Clone)]
pub struct SessionIndexedData {
    pub id: String,
    pub path: String,
    pub summary: Option<String>,
    pub repository: Option<String>,
    pub branch: Option<String>,
    pub cwd: Option<String>,
    pub host_type: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub event_count: Option<i64>,
    pub turn_count: Option<i64>,
    pub has_plan: Option<bool>,
    pub has_checkpoints: Option<bool>,
    pub checkpoint_count: Option<i64>,
    pub shutdown_type: Option<String>,
    pub current_model: Option<String>,
    pub total_premium_requests: Option<f64>,
    pub total_api_duration_ms: Option<i64>,
    pub total_tokens: Option<i64>,
    pub total_cost: Option<f64>,
    pub tool_call_count: Option<i64>,
    pub lines_added: Option<i64>,
    pub lines_removed: Option<i64>,
    pub duration_ms: Option<i64>,
    pub health_score: Option<f64>,
    /// Serialized ShutdownData JSON for full-fidelity ShutdownMetrics reconstruction.
    pub shutdown_data_json: Option<String>,
}
