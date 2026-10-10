//! Types and constants for the index database.

use std::path::Path;

use tracepilot_core::provider::SourceFingerprint;

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

/// The analytics version of Claude Code rows, bumped on its own so Copilot
/// rows (and their golden snapshot) are not re-derived for a Claude-only
/// change. Never below [`CURRENT_ANALYTICS_VERSION`].
///
/// v27: a background agent resumed by `SendMessage` ends its run with its
/// next completion, so such runs are no longer counted as incomplete.
///
/// v26: a foreground `Agent` call's result ends its agent run (completed,
/// failed or cancelled), so such runs are no longer counted as incomplete.
///
/// v25: a session renamed in Claude Code (`custom-title`) keeps the user's
/// title over the generated `ai-title`.
///
/// v24: format observations (unmapped record and attachment types, Claude
/// Code versions) in `session_format_observations` for the diagnostics panel.
///
/// v23: one segment per run, from the difference between consecutive
/// `cost-state` snapshots plus the tail, so a resumed session's usage lands
/// on the day of each run. USD cost per session, run and model
/// (`cost_usd`), and native tool durations.
///
/// v22: slash-command prompts as typed (`/model opus`), a title for sessions
/// of commands only, and durations estimated from timestamps for sessions
/// without a `cost-state` snapshot.
///
/// v21: one session-level segment per Claude session, so the per-day
/// dashboard charts (tokens, activity, cost) include Claude totals.
///
/// v20: cache windows come from the core prompt-cache timeline: expiry counts
/// from the last call that read or wrote cache, tiers are tracked per model,
/// the last call leaves a pending window, and timestamps use milliseconds.
///
/// v19: per-call `tracepilot.model_call` events and turn usage, native tool
/// names (`session_native_tool_calls`), interrupt and denial incidents, and
/// cache windows timed by recorded calls.
///
/// v18: summary and metrics from `cost-state` plus the de-duplicated tail (C5).
pub(super) const CLAUDE_CODE_ANALYTICS_VERSION: i64 = 27;

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
    pub source: tracepilot_core::provider::SessionSource,
    /// Claude's recorded usage is always partial; a snapshot alone cannot
    /// prove exit. Derived from source, so old indexed Claude rows are safe too.
    pub metrics_partial: Option<bool>,
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
    pub cost: Option<f64>,
    pub premium_requests: i64,
    pub reasoning_tokens: Option<i64>,
    pub total_nano_aiu: Option<i64>,
    /// Provider-priced USD; `None` for Copilot and for unpriced models.
    pub cost_usd: Option<f64>,
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

/// Calls of one canonical tool under one source-native name, for sources
/// whose tools are normalized (`TurnToolCall::native_tool_name`).
pub(crate) struct NativeToolCallRow {
    pub name: String,
    pub native_name: String,
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
    pub cost_usd: Option<f64>,
}

/// Named row for modified file data.
pub(crate) struct ModifiedFileRow {
    pub file_path: String,
    pub extension: Option<String>,
}

/// Row for the session_cache_windows table: Copilot's predicted windows and
/// Claude Code's windows timed by recorded model calls.
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
    pub total_cost: Option<f64>,
    /// Provider-priced USD (never AI Credits); `None` when unpriced.
    pub total_cost_usd: Option<f64>,
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
    pub native_tool_call_rows: Vec<NativeToolCallRow>,
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
///
/// The columns predate other sources: `workspace_*` is Copilot's
/// `workspace.yaml`, and `events_*` is `events.jsonl` or, for a source whose
/// session is one main file, that file.
impl SessionFileMeta {
    pub fn from_fingerprint(source: &SourceFingerprint, primary_path: &Path) -> Self {
        let file = |found: &dyn Fn(&Path) -> bool| {
            source
                .files
                .iter()
                .find(|(path, _)| found(path))
                .and_then(|(_, file)| file.as_ref())
        };
        let workspace = file(&|path| path.ends_with("workspace.yaml"));
        let events = file(&|path| path.ends_with("events.jsonl") || path == primary_path);
        Self {
            workspace_mtime: workspace.map(|file| file.mtime()),
            events_mtime: events.map(|file| file.mtime()),
            events_size: events.map(|file| file.size as i64),
        }
    }
}
