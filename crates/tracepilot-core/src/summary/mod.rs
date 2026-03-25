//! Session summary builder — single entry point to load all session data.
//!
//! Reads workspace metadata, events, checkpoints, and session artifacts,
//! then assembles a [`SessionSummary`] with context enrichment from events.

use std::path::Path;

use crate::error::{Result, TracePilotError};
use crate::models::event_types::ShutdownData;
use crate::models::session_summary::{SessionSummary, ShutdownMetrics};
use crate::parsing::checkpoints::parse_checkpoints;
use crate::parsing::diagnostics::ParseDiagnostics;
use crate::parsing::events::{
    extract_combined_shutdown_data, extract_session_start, parse_typed_events, TypedEvent,
};
use crate::parsing::workspace::parse_workspace_yaml;
use crate::turns::{reconstruct_turns, turn_stats};

/// Result of loading a session — includes parsed events and diagnostics for reuse.
///
/// The `typed_events` field allows callers (e.g., the indexer) to avoid re-parsing
/// `events.jsonl` for conversation FTS indexing or tool call extraction.
/// The `diagnostics` field exposes parsing quality info (unknown events, failures).
pub struct SessionLoadResult {
    pub summary: SessionSummary,
    pub typed_events: Option<Vec<TypedEvent>>,
    /// Parsing diagnostics (unknown event types, deserialization failures).
    /// Present when events were parsed, `None` if `events.jsonl` was missing.
    pub diagnostics: Option<ParseDiagnostics>,
}

/// Load a complete [`SessionSummary`] from a session directory.
///
/// The directory must contain at least `workspace.yaml`. Other files
/// (`events.jsonl`, `session.db`, `plan.md`, `checkpoints/`) are optional
/// and their presence is reflected in the summary flags.
pub fn load_session_summary(session_dir: &Path) -> Result<SessionSummary> {
    load_session_summary_impl(session_dir, false).map(|r| r.summary)
}

/// Load a session summary along with parsed events for reuse.
///
/// Used by the indexer to avoid re-parsing `events.jsonl` for FTS indexing
/// and tool call extraction.
pub fn load_session_summary_with_events(session_dir: &Path) -> Result<SessionLoadResult> {
    load_session_summary_impl(session_dir, true)
}

fn load_session_summary_impl(session_dir: &Path, retain_events: bool) -> Result<SessionLoadResult> {
    // 1. Parse workspace.yaml (required)
    let workspace_path = session_dir.join("workspace.yaml");
    if !workspace_path.exists() {
        return Err(TracePilotError::SessionNotFound(format!(
            "workspace.yaml not found in {}",
            session_dir.display()
        )));
    }
    let ws = parse_workspace_yaml(&workspace_path)?;

    let mut summary = SessionSummary {
        id: ws.id,
        summary: ws.summary,
        repository: ws.repository,
        branch: ws.branch,
        cwd: ws.cwd,
        host_type: ws.host_type,
        created_at: ws.created_at,
        updated_at: ws.updated_at,
        event_count: None,
        has_events: false,
        has_session_db: false,
        has_plan: false,
        has_checkpoints: false,
        checkpoint_count: None,
        turn_count: None,
        shutdown_metrics: None,
    };

    // 2–5. Events processing — parse ONCE, derive count from len()
    let events_path = session_dir.join("events.jsonl");
    let mut typed_events_out = None;
    let mut diagnostics_out = None;

    if events_path.exists() {
        summary.has_events = true;

        match parse_typed_events(&events_path) {
            Ok(parsed) => {
                let typed_events = parsed.events;
                diagnostics_out = Some(parsed.diagnostics);

                // Derive event count from parsed events (no separate count_events call)
                summary.event_count = Some(typed_events.len());

                // Shutdown metrics (summed across all shutdown events for resumed sessions)
                if let Some((sd, count)) = extract_combined_shutdown_data(&typed_events) {
                    summary.shutdown_metrics = Some(shutdown_data_to_metrics(&sd, count));
                }

                // Turn count
                let turns = reconstruct_turns(&typed_events);
                let stats = turn_stats(&turns);
                summary.turn_count = Some(stats.total_turns);

                // Context enrichment from session.start event
                if let Some(start_data) = extract_session_start(&typed_events)
                    && let Some(ctx) = &start_data.context
                {
                    if summary.repository.is_none() {
                        summary.repository = ctx.repository.clone();
                    }
                    if summary.branch.is_none() {
                        summary.branch = ctx.branch.clone();
                    }
                    if summary.host_type.is_none() {
                        summary.host_type = ctx.host_type.clone();
                    }
                }

                if retain_events {
                    typed_events_out = Some(typed_events);
                }
            }
            Err(e) => {
                tracing::warn!(
                    path = %events_path.display(),
                    error = %e,
                    "Failed to parse events.jsonl; proceeding without event data"
                );
            }
        }
    }

    // 6. session.db
    summary.has_session_db = session_dir.join("session.db").exists();

    // 7. plan.md
    summary.has_plan = session_dir.join("plan.md").exists();

    // 8. Checkpoints
    if let Ok(Some(cp_index)) = parse_checkpoints(session_dir) {
        summary.has_checkpoints = true;
        summary.checkpoint_count = Some(cp_index.checkpoints.len());
    }

    Ok(SessionLoadResult {
        summary,
        typed_events: typed_events_out,
        diagnostics: diagnostics_out,
    })
}

/// Convert [`ShutdownData`] (event-level) to [`ShutdownMetrics`] (summary-level).
fn shutdown_data_to_metrics(data: &ShutdownData, shutdown_count: u32) -> ShutdownMetrics {
    ShutdownMetrics {
        shutdown_type: data.shutdown_type.clone(),
        total_premium_requests: data.total_premium_requests,
        total_api_duration_ms: data.total_api_duration_ms,
        session_start_time: data.session_start_time,
        current_model: data.current_model.clone(),
        code_changes: data.code_changes.clone(),
        model_metrics: data.model_metrics.clone().unwrap_or_default(),
        session_segments: data.session_segments.clone(),
        shutdown_count: Some(shutdown_count),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// Sample workspace.yaml content with all fields populated.
    fn full_workspace_yaml() -> &'static str {
        r#"id: test-session-id
cwd: /test/project
repository: user/repo
branch: main
summary: "Test session"
created_at: "2026-03-10T07:14:50Z"
updated_at: "2026-03-10T07:15:00Z"
"#
    }

    /// Minimal workspace.yaml — only the required `id` field.
    fn minimal_workspace_yaml() -> &'static str {
        "id: minimal-session\n"
    }

    /// Workspace with missing repository/branch/host_type (for enrichment test).
    fn sparse_workspace_yaml() -> &'static str {
        r#"id: sparse-session
cwd: /test/project
summary: "Sparse session"
"#
    }

    /// Sample events.jsonl with a full lifecycle.
    fn sample_events_jsonl() -> &'static str {
        concat!(
            r#"{"type":"session.start","data":{"sessionId":"test-session-id","version":"1.0","producer":"copilot-cli","context":{"cwd":"/test","branch":"main","repository":"user/repo","hostType":"cli"}},"id":"evt-1","timestamp":"2026-03-10T07:14:50.780Z","parentId":null}"#,
            "\n",
            r#"{"type":"user.message","data":{"content":"Hello world","interactionId":"int-1","attachments":[]},"id":"evt-2","timestamp":"2026-03-10T07:14:51.000Z","parentId":"evt-1"}"#,
            "\n",
            r#"{"type":"assistant.turn_start","data":{"turnId":"turn-1","interactionId":"int-1"},"id":"evt-3","timestamp":"2026-03-10T07:14:51.100Z","parentId":"evt-2"}"#,
            "\n",
            r#"{"type":"assistant.message","data":{"messageId":"msg-1","content":"Hi there!","interactionId":"int-1"},"id":"evt-4","timestamp":"2026-03-10T07:14:52.000Z","parentId":"evt-3"}"#,
            "\n",
            r#"{"type":"tool.execution_start","data":{"toolCallId":"tc-1","toolName":"read_file","arguments":{"path":"/test/foo.rs"}},"id":"evt-5","timestamp":"2026-03-10T07:14:52.100Z","parentId":"evt-4"}"#,
            "\n",
            r#"{"type":"tool.execution_complete","data":{"toolCallId":"tc-1","model":"claude-opus-4.6","interactionId":"int-1","success":true,"result":"file contents"},"id":"evt-6","timestamp":"2026-03-10T07:14:52.500Z","parentId":"evt-5"}"#,
            "\n",
            r#"{"type":"assistant.turn_end","data":{"turnId":"turn-1"},"id":"evt-7","timestamp":"2026-03-10T07:14:53.000Z","parentId":"evt-3"}"#,
            "\n",
            r#"{"type":"session.shutdown","data":{"shutdownType":"routine","totalPremiumRequests":1,"totalApiDurationMs":5000,"sessionStartTime":1773270552854,"currentModel":"claude-opus-4.6","codeChanges":{"linesAdded":10,"linesRemoved":2,"filesModified":["/test/foo.rs"]},"modelMetrics":{"claude-opus-4.6":{"requests":{"count":3,"cost":1},"usage":{"inputTokens":1000,"outputTokens":500,"cacheReadTokens":800,"cacheWriteTokens":0}}}},"id":"evt-8","timestamp":"2026-03-10T07:15:00.000Z","parentId":null}"#,
            "\n",
        )
    }

    /// Events with session.start containing context but no shutdown.
    fn enrichment_events_jsonl() -> &'static str {
        concat!(
            r#"{"type":"session.start","data":{"sessionId":"sparse-session","version":"1.0","producer":"copilot-cli","context":{"cwd":"/test","branch":"feature-x","repository":"org/project","hostType":"vscode"}},"id":"evt-1","timestamp":"2026-03-10T07:14:50.780Z","parentId":null}"#,
            "\n",
            r#"{"type":"user.message","data":{"content":"Hi","interactionId":"int-1"},"id":"evt-2","timestamp":"2026-03-10T07:14:51.000Z","parentId":"evt-1"}"#,
            "\n",
        )
    }

    /// Helper: create a checkpoint directory with an index and one entry.
    fn create_checkpoints(session_dir: &Path) {
        let cp_dir = session_dir.join("checkpoints");
        fs::create_dir_all(&cp_dir).unwrap();
        let index = "| # | Title | File |\n| --- | --- | --- |\n| 1 | Initial setup | cp1.md |\n| 2 | Add auth | cp2.md |\n";
        fs::write(cp_dir.join("index.md"), index).unwrap();
        fs::write(cp_dir.join("cp1.md"), "# Checkpoint 1").unwrap();
        fs::write(cp_dir.join("cp2.md"), "# Checkpoint 2").unwrap();
    }

    #[test]
    fn test_full_session_summary() {
        let dir = tempfile::tempdir().unwrap();
        let session_dir = dir.path();

        // workspace.yaml
        fs::write(session_dir.join("workspace.yaml"), full_workspace_yaml()).unwrap();
        // events.jsonl
        fs::write(session_dir.join("events.jsonl"), sample_events_jsonl()).unwrap();
        // session.db (empty file is enough for existence check)
        fs::write(session_dir.join("session.db"), b"").unwrap();
        // plan.md
        fs::write(session_dir.join("plan.md"), "# Plan").unwrap();
        // checkpoints
        create_checkpoints(session_dir);

        let summary = load_session_summary(session_dir).unwrap();

        assert_eq!(summary.id, "test-session-id");
        assert_eq!(summary.summary.as_deref(), Some("Test session"));
        assert_eq!(summary.repository.as_deref(), Some("user/repo"));
        assert_eq!(summary.branch.as_deref(), Some("main"));
        assert_eq!(summary.cwd.as_deref(), Some("/test/project"));
        assert!(summary.created_at.is_some());
        assert!(summary.updated_at.is_some());

        // Events
        assert!(summary.has_events);
        assert_eq!(summary.event_count, Some(8));

        // Turns (1 user message → 1 turn)
        assert_eq!(summary.turn_count, Some(1));

        // Shutdown metrics
        let metrics = summary.shutdown_metrics.as_ref().unwrap();
        assert_eq!(metrics.shutdown_type.as_deref(), Some("routine"));
        assert_eq!(metrics.total_premium_requests, Some(1.0));
        assert_eq!(metrics.current_model.as_deref(), Some("claude-opus-4.6"));
        assert!(metrics.code_changes.is_some());
        assert!(!metrics.model_metrics.is_empty());

        // Artifacts
        assert!(summary.has_session_db);
        assert!(summary.has_plan);
        assert!(summary.has_checkpoints);
        assert_eq!(summary.checkpoint_count, Some(2));
    }

    #[test]
    fn test_minimal_session_summary() {
        let dir = tempfile::tempdir().unwrap();
        let session_dir = dir.path();

        fs::write(session_dir.join("workspace.yaml"), minimal_workspace_yaml()).unwrap();

        let summary = load_session_summary(session_dir).unwrap();

        assert_eq!(summary.id, "minimal-session");
        assert!(summary.summary.is_none());
        assert!(summary.repository.is_none());
        assert!(summary.branch.is_none());
        assert!(summary.cwd.is_none());
        assert!(summary.host_type.is_none());

        assert!(!summary.has_events);
        assert!(summary.event_count.is_none());
        assert!(summary.turn_count.is_none());
        assert!(summary.shutdown_metrics.is_none());
        assert!(!summary.has_session_db);
        assert!(!summary.has_plan);
        assert!(!summary.has_checkpoints);
        assert!(summary.checkpoint_count.is_none());
    }

    #[test]
    fn test_context_enrichment_from_events() {
        let dir = tempfile::tempdir().unwrap();
        let session_dir = dir.path();

        // Workspace missing repository/branch/host_type
        fs::write(session_dir.join("workspace.yaml"), sparse_workspace_yaml()).unwrap();
        // Events with session.start containing context
        fs::write(
            session_dir.join("events.jsonl"),
            enrichment_events_jsonl(),
        )
        .unwrap();

        let summary = load_session_summary(session_dir).unwrap();

        assert_eq!(summary.id, "sparse-session");
        // Enriched from session.start context
        assert_eq!(summary.repository.as_deref(), Some("org/project"));
        assert_eq!(summary.branch.as_deref(), Some("feature-x"));
        assert_eq!(summary.host_type.as_deref(), Some("vscode"));
    }

    #[test]
    fn test_no_workspace_yaml_returns_error() {
        let dir = tempfile::tempdir().unwrap();
        let result = load_session_summary(dir.path());
        assert!(result.is_err());

        match result.unwrap_err() {
            TracePilotError::SessionNotFound(msg) => {
                assert!(msg.contains("workspace.yaml"));
            }
            other => panic!("Expected SessionNotFound, got {:?}", other),
        }
    }

    /// Events.jsonl with two shutdown events simulating a resumed session.
    fn resumed_events_jsonl() -> &'static str {
        concat!(
            r#"{"type":"session.start","data":{"sessionId":"test-session-id","version":"1.0","producer":"copilot-cli","context":{"cwd":"/test","branch":"main","repository":"user/repo"}},"id":"evt-1","timestamp":"2026-03-10T07:00:00.000Z","parentId":null}"#,
            "\n",
            r#"{"type":"user.message","data":{"content":"Hello","interactionId":"int-1"},"id":"evt-2","timestamp":"2026-03-10T07:01:00.000Z","parentId":"evt-1"}"#,
            "\n",
            r#"{"type":"assistant.turn_start","data":{"turnId":"t1","interactionId":"int-1"},"id":"evt-3","timestamp":"2026-03-10T07:01:01.000Z","parentId":"evt-2"}"#,
            "\n",
            r#"{"type":"assistant.turn_end","data":{"turnId":"t1"},"id":"evt-4","timestamp":"2026-03-10T07:01:02.000Z","parentId":"evt-3"}"#,
            "\n",
            r#"{"type":"session.shutdown","data":{"shutdownType":"routine","totalPremiumRequests":12,"totalApiDurationMs":5000,"sessionStartTime":1000,"currentModel":"claude-sonnet-4.5","codeChanges":{"linesAdded":10,"linesRemoved":2,"filesModified":["/a.rs"]},"modelMetrics":{"claude-sonnet-4.5":{"requests":{"count":20,"cost":5.0},"usage":{"inputTokens":1000,"outputTokens":500,"cacheReadTokens":0,"cacheWriteTokens":0}}}},"id":"evt-5","timestamp":"2026-03-10T07:10:00.000Z","parentId":null}"#,
            "\n",
            r#"{"type":"session.resume","data":{"resumeTime":"2026-03-10T08:00:00.000Z"},"id":"evt-6","timestamp":"2026-03-10T08:00:00.000Z","parentId":null}"#,
            "\n",
            r#"{"type":"user.message","data":{"content":"Continue","interactionId":"int-2"},"id":"evt-7","timestamp":"2026-03-10T08:01:00.000Z","parentId":null}"#,
            "\n",
            r#"{"type":"assistant.turn_start","data":{"turnId":"t2","interactionId":"int-2"},"id":"evt-8","timestamp":"2026-03-10T08:01:01.000Z","parentId":"evt-7"}"#,
            "\n",
            r#"{"type":"assistant.turn_end","data":{"turnId":"t2"},"id":"evt-9","timestamp":"2026-03-10T08:01:02.000Z","parentId":"evt-8"}"#,
            "\n",
            r#"{"type":"session.shutdown","data":{"shutdownType":"user_exit","totalPremiumRequests":6,"totalApiDurationMs":3000,"sessionStartTime":2000,"currentModel":"claude-opus-4.6","codeChanges":{"linesAdded":5,"linesRemoved":3,"filesModified":["/a.rs","/b.rs"]},"modelMetrics":{"claude-opus-4.6":{"requests":{"count":8,"cost":4.0},"usage":{"inputTokens":2000,"outputTokens":1000,"cacheReadTokens":0,"cacheWriteTokens":0}}}},"id":"evt-10","timestamp":"2026-03-10T08:10:00.000Z","parentId":null}"#,
            "\n",
        )
    }

    #[test]
    fn test_resumed_session_summary() {
        let dir = tempfile::tempdir().unwrap();
        let session_dir = dir.path();

        fs::write(session_dir.join("workspace.yaml"), full_workspace_yaml()).unwrap();
        fs::write(session_dir.join("events.jsonl"), resumed_events_jsonl()).unwrap();

        let summary = load_session_summary(session_dir).unwrap();

        let metrics = summary.shutdown_metrics.as_ref().expect("should have shutdown metrics");
        // shutdown_count = 2 (two shutdown events combined)
        assert_eq!(metrics.shutdown_count, Some(2));
        // Summed premium requests: 12 + 6 = 18
        assert_eq!(metrics.total_premium_requests, Some(18.0));
        // Summed API duration: 5000 + 3000 = 8000
        assert_eq!(metrics.total_api_duration_ms, Some(8000));
        // session_start_time from FIRST shutdown
        assert_eq!(metrics.session_start_time, Some(1000));
        // shutdown_type and current_model from LAST shutdown
        assert_eq!(metrics.shutdown_type.as_deref(), Some("user_exit"));
        assert_eq!(metrics.current_model.as_deref(), Some("claude-opus-4.6"));

        // Code changes: lines summed, files deduped
        let changes = metrics.code_changes.as_ref().unwrap();
        assert_eq!(changes.lines_added, Some(15)); // 10 + 5
        assert_eq!(changes.lines_removed, Some(5)); // 2 + 3
        let files = changes.files_modified.as_ref().unwrap();
        assert_eq!(files.len(), 2); // /a.rs deduped, + /b.rs
        assert!(files.contains(&"/a.rs".to_string()));
        assert!(files.contains(&"/b.rs".to_string()));

        // Model metrics: sonnet from first, opus from second
        assert!(metrics.model_metrics.contains_key("claude-sonnet-4.5"));
        assert!(metrics.model_metrics.contains_key("claude-opus-4.6"));
        let sonnet = &metrics.model_metrics["claude-sonnet-4.5"];
        assert_eq!(sonnet.requests.as_ref().unwrap().count, Some(20));
        let opus = &metrics.model_metrics["claude-opus-4.6"];
        assert_eq!(opus.requests.as_ref().unwrap().count, Some(8));
    }
}
