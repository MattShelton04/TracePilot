//! Types and constants for the index database.

/// Bump this when the analytics schema or extraction logic changes.
/// Sessions with a stored analytics_version below this will be re-indexed.
///
/// v17: derive tool counts, outcomes, durations and heatmap activity from the
/// reconstructed conversation, including pending invocations and authoritative
/// subagent terminal outcomes while deduplicating repeated lifecycle records.
///
/// v16: count Copilot CLI 1.0.86+ `skill.invoked_ref` repeat invocations with
/// their resolved skill body (previously tool-call-only fallbacks without a
/// path, hash or token estimate), and fold `skill.context_delivered(_ref)`
/// wrappers into context estimates.
///
/// v15: count inter-agent messaging per agent run (messages sent, received,
/// peer and queued) in `session_agent_runs`, and name runs by their launch name.
///
/// v14: derive `current_model` from the event log, so running, crashed and
/// resumed sessions record the model they are on, not only the model at the
/// last shutdown. Also stop listing an unexplained history re-render as a
/// prompt-cache break cause unless the resume request recorded a miss.
///
/// v13: preserve repeated skill tool calls when only some have an invocation
/// event, and retain subagent attribution for fallback invocations.
///
/// v12: extract per-invocation skill usage into `session_skill_invocations`
/// for Skills analytics, including tool-call-only invocations from older CLI
/// versions that recorded no `skill.invoked` event.
///
/// v11: extract per-invocation agent runs and main-agent selections into
/// `session_agent_runs` / `session_agent_selections` for the Agents explorer.
///
/// v10: extract prompt-cache windows (including what resumed each one) and
/// observed cache TTLs from `session.usage_checkpoint` events into their own
/// tables.
///
/// v9: retain legacy segments following cumulative shutdowns (downgrade / upgrade)
/// and recognize cumulative agent-ledger snapshots without a file-size marker.
/// Re-read unchanged logs so Models and Analytics receive corrected accounting.
/// Includes v8 main-turn reconstruction and modern subagent ownership fixes.
pub(super) const CURRENT_ANALYTICS_VERSION: i64 = 17;

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
    pub copilot_version: Option<String>,
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
pub(crate) struct ModelMetricsRow {
    pub model: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_write_tokens: i64,
    pub cost: f64,
    pub premium_requests: i64,
    pub reasoning_tokens: Option<i64>,
    pub total_nano_aiu: Option<i64>,
}

/// Named row for per-tool call stats.
pub(crate) struct ToolCallRow {
    pub name: String,
    pub calls: i64,
    pub success: i64,
    pub failure: i64,
    pub duration_ms: i64,
    pub calls_with_duration: i64,
}

/// Named row for activity heatmap data.
pub(crate) struct ActivityRow {
    pub day_of_week: i64,
    pub hour: i64,
    pub tool_call_count: i64,
}

/// Named row for session segment granular breakdown.
pub(crate) struct SessionSegmentRow {
    pub start_timestamp: String,
    pub end_timestamp: String,
    pub tokens: i64,
    pub total_requests: i64,
    pub premium_requests: f64,
    pub api_duration_ms: i64,
    pub current_model: Option<String>,
    pub model_metrics_json: Option<String>,
    pub total_nano_aiu: Option<i64>,
}

/// Named row for modified file data.
pub(crate) struct ModifiedFileRow {
    pub file_path: String,
    pub extension: Option<String>,
}

/// Row for the session_cache_windows table (predicted windows only).
pub(crate) struct CacheWindowRow {
    pub window_index: i64,
    pub idle_start: String,
    pub resume_at: Option<String>,
    pub idle_seconds: Option<i64>,
    pub model: Option<String>,
    pub expires_at: Option<String>,
    pub ttl_seconds: Option<i64>,
    pub outcome: &'static str,
    pub resume_source: Option<String>,
    pub prefix_tokens: Option<i64>,
    pub interaction_nano_aiu: Option<i64>,
    pub change_kinds: Option<String>,
}

/// Row for the session_cache_ttls table.
pub(crate) struct CacheTtlRow {
    pub model: String,
    pub ttl_seconds: i64,
    pub observation_count: i64,
}

/// Row for the session_incidents table.
#[derive(Debug)]
pub(crate) struct IncidentRow {
    pub event_type: String,
    pub source_event_type: String,
    pub timestamp: Option<String>,
    pub severity: String,
    pub summary: String,
    pub detail_json: Option<String>,
}

#[derive(Debug, Clone)]
pub struct IndexedSkillCallCandidate {
    pub normalized_name: String,
    pub display_name: String,
    pub session_path: std::path::PathBuf,
    pub invocation_count: usize,
}

/// Aggregated analytics extracted from a session's events and summary.
/// This is a pure data struct produced by `extract_session_analytics`
/// without any database interaction, making analytics computation
/// independently testable.
pub(crate) struct SessionAnalytics {
    // Aggregate token/cost metrics
    pub total_tokens: i64,
    pub total_cost: f64,
    pub total_nano_aiu: Option<i64>,
    pub lines_added: Option<i64>,
    pub lines_removed: Option<i64>,
    pub tool_call_count: Option<i64>,

    // Shutdown metrics pass-through
    pub current_model: Option<String>,
    pub copilot_version: Option<String>,
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
    pub session_segment_rows: Vec<SessionSegmentRow>,

    // Incident counters
    pub error_count: i64,
    pub rate_limit_count: i64,
    pub compaction_count: i64,
    pub truncation_count: i64,
    pub total_compaction_input: i64,
    pub total_compaction_output: i64,
    pub incidents: Vec<IncidentRow>,

    // Prompt cache
    pub cache_window_rows: Vec<CacheWindowRow>,
    pub cache_ttl_rows: Vec<CacheTtlRow>,

    // Agent runs
    pub agent_runs: tracepilot_core::agent_runs::AgentRunExtraction,
    pub skill_invocations: Vec<tracepilot_core::skill_invocations::SkillInvocation>,
}

/// File metadata from the successfully parsed session snapshot.
pub(crate) struct SessionFileMeta {
    pub workspace_mtime: Option<String>,
    pub events_mtime: Option<String>,
    pub events_size: Option<i64>,
}

/// Reuse the snapshot identity; never sample newer metadata after parsing.
impl SessionFileMeta {
    pub fn from_fingerprint(source: &tracepilot_core::summary::SessionFingerprint) -> Self {
        Self {
            workspace_mtime: source.workspace.as_ref().map(|file| file.mtime()),
            events_mtime: source.events.as_ref().map(|file| file.mtime()),
            events_size: source.events.as_ref().map(|file| file.size as i64),
        }
    }
}
