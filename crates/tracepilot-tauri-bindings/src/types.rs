//! Shared DTO types returned by Tauri IPC commands.

use serde::Serialize;
use std::sync::{Arc, Mutex};

// ── LRU Turn Cache ──────────────────────────────────────────────────

/// Cached turns for a single session, keyed by session ID in the LRU.
pub(crate) struct CachedTurns {
    pub turns: Vec<tracepilot_core::ConversationTurn>,
    pub events_file_size: u64,
}

pub(crate) type TurnCache = Arc<Mutex<lru::LruCache<String, CachedTurns>>>;

/// Cached typed events for a single session, keyed by session ID in the LRU.
pub(crate) struct CachedEvents {
    pub events: Arc<Vec<tracepilot_core::parsing::events::TypedEvent>>,
    pub events_file_size: u64,
    pub events_file_mtime: Option<std::time::SystemTime>,
}

pub(crate) type EventCache = Arc<Mutex<lru::LruCache<String, CachedEvents>>>;

/// Response wrapper for `get_session_turns` — includes file size for
/// frontend freshness tracking.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnsResponse {
    pub turns: Vec<tracepilot_core::ConversationTurn>,
    pub events_file_size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FreshnessResponse {
    pub events_file_size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResultItem {
    pub id: i64,
    pub session_id: String,
    pub content_type: String,
    pub turn_number: Option<i64>,
    pub event_index: Option<i64>,
    pub timestamp_unix: Option<i64>,
    pub tool_name: Option<String>,
    pub snippet: Option<String>,
    pub metadata_json: Option<String>,
    pub session_summary: Option<String>,
    pub session_repository: Option<String>,
    pub session_branch: Option<String>,
    pub session_updated_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResultsResponse {
    pub results: Vec<SearchResultItem>,
    pub total_count: i64,
    pub has_more: bool,
    pub query: String,
    pub latency_ms: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchFacetsResponse {
    pub by_content_type: Vec<(String, i64)>,
    pub by_repository: Vec<(String, i64)>,
    pub by_tool_name: Vec<(String, i64)>,
    pub total_matches: i64,
    pub session_count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchStatsResponse {
    pub total_rows: i64,
    pub indexed_sessions: i64,
    pub total_sessions: i64,
    pub content_type_counts: Vec<(String, i64)>,
}

/// Newtype for the search indexing semaphore (separate from main indexing).
pub struct SearchSemaphore(pub Arc<tokio::sync::Semaphore>);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionListItem {
    pub id: String,
    pub summary: Option<String>,
    pub repository: Option<String>,
    pub branch: Option<String>,
    pub host_type: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub event_count: Option<usize>,
    pub turn_count: Option<usize>,
    pub current_model: Option<String>,
    /// Whether this session is currently running (has an `inuse.*.lock` file).
    pub is_running: bool,
    // Incident counts (populated from index DB; None in fallback disk-scan path)
    pub error_count: Option<usize>,
    pub rate_limit_count: Option<usize>,
    pub compaction_count: Option<usize>,
    pub truncation_count: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionIncidentItem {
    pub event_type: String,
    pub source_event_type: String,
    pub timestamp: Option<String>,
    pub severity: String,
    pub summary: String,
    pub detail_json: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventsResponse {
    pub events: Vec<EventItem>,
    pub total_count: usize,
    pub has_more: bool,
    pub all_event_types: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventItem {
    pub event_type: String,
    pub timestamp: Option<String>,
    pub id: Option<String>,
    pub parent_id: Option<String>,
    pub data: serde_json::Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodosResponse {
    pub todos: Vec<tracepilot_core::parsing::session_db::TodoItem>,
    pub deps: Vec<tracepilot_core::parsing::session_db::TodoDep>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateSessionDirResult {
    pub valid: bool,
    pub session_count: usize,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub current_version: String,
    pub latest_version: Option<String>,
    pub has_update: bool,
    pub release_url: Option<String>,
    pub published_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitInfo {
    pub commit_hash: Option<String>,
    pub branch: Option<String>,
}

/// Enriched indexing progress payload emitted via Tauri events.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexingProgressPayload {
    pub current: usize,
    pub total: usize,
    /// Per-session info (None if this session was skipped or failed).
    pub session_repo: Option<String>,
    pub session_branch: Option<String>,
    pub session_model: Option<String>,
    pub session_tokens: u64,
    pub session_events: usize,
    pub session_turns: usize,
    /// Running totals across all indexed sessions so far.
    pub total_tokens: u64,
    pub total_events: u64,
    pub total_repos: usize,
}

// ── Export / Import DTOs ────────────────────────────────────────────

/// Result returned to the frontend after a successful export.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSessionsResult {
    /// Number of sessions included in the export.
    pub sessions_exported: usize,
    /// Filesystem path where the export was written.
    pub file_path: String,
    /// Size of the output file in bytes.
    pub file_size_bytes: u64,
    /// ISO-8601 timestamp of the export.
    pub exported_at: String,
}

/// Preview content returned for the live preview panel.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPreviewResult {
    /// Rendered content (JSON, Markdown, or CSV).
    pub content: String,
    /// Format that was rendered.
    pub format: String,
    /// Estimated total output size in bytes.
    pub estimated_size_bytes: usize,
    /// Number of sections included.
    pub section_count: usize,
}

/// Info about which sections have data in a given session.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSectionsInfo {
    pub session_id: String,
    pub has_conversation: bool,
    pub has_events: bool,
    pub has_todos: bool,
    pub has_plan: bool,
    pub has_checkpoints: bool,
    pub has_metrics: bool,
    pub has_health: bool,
    pub has_incidents: bool,
    pub has_rewind_snapshots: bool,
    pub has_custom_tables: bool,
    pub event_count: Option<usize>,
    pub turn_count: Option<usize>,
}

/// Result of an import preview — shows what would be imported.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreviewResult {
    /// Whether the archive is valid for import.
    pub valid: bool,
    /// Validation issues (errors and warnings).
    pub issues: Vec<ImportIssue>,
    /// Sessions found in the archive.
    pub sessions: Vec<ImportSessionPreview>,
    /// Schema version of the archive.
    pub schema_version: String,
    /// Whether the archive needs migration.
    pub needs_migration: bool,
}

/// A single validation issue found during import preview.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportIssue {
    pub severity: String,
    pub message: String,
}

/// Summary of a session found in an import archive.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSessionPreview {
    pub id: String,
    pub summary: Option<String>,
    pub repository: Option<String>,
    pub created_at: Option<String>,
    pub section_count: usize,
    pub already_exists: bool,
}

/// Result returned to the frontend after import.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSessionsResult {
    pub imported_count: usize,
    pub skipped_count: usize,
    pub warnings: Vec<String>,
}
