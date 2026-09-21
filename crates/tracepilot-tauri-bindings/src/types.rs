//! Shared DTO types returned by Tauri IPC commands.

use serde::Serialize;
use std::sync::{Arc, Mutex};
use tracepilot_core::SessionId;

// ── LRU Turn Cache ──────────────────────────────────────────────────

/// Cached turns for a single session, keyed by session ID in the LRU.
pub(crate) struct CachedTurns {
    pub turns: Vec<tracepilot_core::ConversationTurn>,
    pub events_file_size: u64,
    pub events_file_mtime: Option<std::time::SystemTime>,
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
    pub events_file_mtime: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextTimelineResponse {
    pub timeline: tracepilot_core::context_window::ContextTimeline,
    pub events_file_size: u64,
    pub events_file_mtime: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptCacheResponse {
    pub timeline: tracepilot_core::prompt_cache::PromptCacheTimeline,
    /// What the resuming request recorded, where the optional session store
    /// could supply it. Empty is the normal state: it means no reliable
    /// association was found, not that no reuse happened.
    pub observations: Vec<tracepilot_core::prompt_cache::CacheObservation>,
    pub events_file_size: u64,
    pub events_file_mtime: Option<i64>,
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FreshnessResponse {
    pub events_file_size: u64,
    pub events_file_mtime: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResultItem {
    pub id: i64,
    pub session_id: SessionId,
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

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionListItem {
    pub id: SessionId,
    pub summary: Option<String>,
    pub repository: Option<String>,
    pub branch: Option<String>,
    pub cwd: Option<String>,
    pub host_type: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub event_count: Option<usize>,
    pub turn_count: Option<usize>,
    pub current_model: Option<String>,
    pub copilot_version: Option<String>,
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

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ValidateSessionDirResult {
    pub valid: bool,
    pub session_count: usize,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Clone, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub current_version: String,
    pub latest_version: Option<String>,
    pub has_update: bool,
    pub release_url: Option<String>,
    pub published_at: Option<String>,
    pub release_notes: Option<String>,
}

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GitInfo {
    pub commit_hash: Option<String>,
    pub branch: Option<String>,
}

/// Enriched indexing progress payload emitted via Tauri events.
#[derive(Debug, Clone, Serialize, specta::Type)]
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
    /// Rendered content (JSON or Markdown).
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
    pub session_id: SessionId,
    pub has_conversation: bool,
    pub has_events: bool,
    pub has_todos: bool,
    pub has_plan: bool,
    pub has_checkpoints: bool,
    pub has_metrics: bool,
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

impl From<tracepilot_export::import::ValidationIssue> for ImportIssue {
    fn from(issue: tracepilot_export::import::ValidationIssue) -> Self {
        Self {
            severity: match issue.severity {
                tracepilot_export::import::IssueSeverity::Error => "error".into(),
                tracepilot_export::import::IssueSeverity::Warning => "warning".into(),
            },
            message: issue.message,
        }
    }
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

// ── Session-store enrichment ──────────────────────────────────────
//
// Each response carries `enabled` and an availability separately from its
// data, because "the user turned this off", "the source is not installed"
// and "the source recorded nothing for this session" must not render the
// same way. `enabled` reflects the stored preference, which a missing store
// never rewrites — the CLI may be installed or updated later.

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStoreStatusResponse {
    pub enabled: bool,
    /// Where the store would be, whether or not it exists. Shown in Settings
    /// so a user can see which Copilot home is bound.
    pub resolved_path: Option<String>,
    pub source: Option<tracepilot_indexer::index_db::StoreSourceStatus>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRequestUsageResponse {
    pub enabled: bool,
    pub page: tracepilot_indexer::index_db::RequestLedgerPage,
    pub coverage: Option<tracepilot_indexer::index_db::SessionCoverageRow>,
}

impl SessionRequestUsageResponse {
    pub fn disabled() -> Self {
        Self {
            enabled: false,
            page: tracepilot_indexer::index_db::RequestLedgerPage {
                requests: Vec::new(),
                next_cursor: None,
                generation: None,
                available: false,
                cursor_expired: false,
            },
            coverage: None,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionWorkRefsResponse {
    pub enabled: bool,
    /// Whether a source was available to search at all. When false, the UI
    /// says the reference source is unavailable rather than implying that no
    /// such work exists.
    pub available: bool,
    pub refs: Vec<tracepilot_indexer::index_db::StoredWorkRef>,
    pub source_availability: Option<String>,
}

impl SessionWorkRefsResponse {
    pub fn disabled() -> Self {
        Self {
            enabled: false,
            available: false,
            refs: Vec::new(),
            source_availability: None,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestPerformanceResponse {
    pub enabled: bool,
    pub available: bool,
    pub performance: Option<tracepilot_core::session_store::RequestPerformance>,
    pub coverage: Option<tracepilot_indexer::index_db::SessionCoverageRow>,
}

impl RequestPerformanceResponse {
    pub fn disabled() -> Self {
        Self {
            enabled: false,
            available: false,
            performance: None,
            coverage: None,
        }
    }

    /// Summarise a population of stored requests.
    ///
    /// An empty population yields `available: false` rather than a
    /// distribution of zeros, which would read as a measurement.
    pub fn from_requests(
        requests: &[tracepilot_indexer::index_db::StoredRequest],
        coverage: Option<tracepilot_indexer::index_db::SessionCoverageRow>,
    ) -> Self {
        if requests.is_empty() {
            return Self {
                enabled: true,
                available: false,
                performance: None,
                coverage,
            };
        }
        let core: Vec<_> = requests.iter().map(|request| request.to_core()).collect();
        Self {
            enabled: true,
            available: true,
            performance: Some(tracepilot_core::session_store::request_performance(&core)),
            coverage,
        }
    }
}

/// Outcome of an explicit enrichment refresh.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnrichmentRefreshResponse {
    /// disabled | missing | ready | busy | unreadable | incompatible.
    pub availability: String,
    pub refreshed: usize,
    pub unchanged: usize,
    pub skipped: usize,
    pub detail: Option<String>,
}
