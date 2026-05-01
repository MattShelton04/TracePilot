use std::path::Path;

use crate::error::Result;
use crate::models::session_summary::SessionSummary;
use crate::parsing::events::{TypedEvent, parse_typed_events};

use super::artifacts::apply_artifact_flags;
use super::enrichment::apply_event_enrichment;
use super::types::SessionLoadResult;
use super::workspace::load_workspace_summary;

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

/// Build a [`SessionSummary`] from pre-parsed events, avoiding a second disk read.
///
/// Used by `get_session_detail` after pulling events from the [`EventCache`].
/// The caller is responsible for passing an up-to-date events slice (i.e. one
/// that was loaded with a cache key that matches the current file metadata).
/// An empty slice means the session has no `events.jsonl` yet.
///
/// [`EventCache`]: tracepilot_tauri_bindings::types::EventCache
pub fn load_session_summary_from_events(
    session_dir: &Path,
    events: &[TypedEvent],
) -> Result<SessionSummary> {
    let mut summary = load_workspace_summary(session_dir)?;

    if !events.is_empty() {
        summary.has_events = true;
        apply_event_enrichment(&mut summary, events);
    }

    apply_artifact_flags(&mut summary, session_dir);

    Ok(summary)
}

fn load_session_summary_impl(session_dir: &Path, retain_events: bool) -> Result<SessionLoadResult> {
    // 1. Parse workspace.yaml — preferred source of session metadata.
    //    For old Copilot CLI sessions that lack workspace.yaml we fall back to a
    //    minimal summary derived from the directory name (UUID) and events.jsonl.
    let mut summary = load_workspace_summary(session_dir)?;

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

                apply_event_enrichment(&mut summary, &typed_events);

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

    apply_artifact_flags(&mut summary, session_dir);

    Ok(SessionLoadResult {
        summary,
        typed_events: typed_events_out,
        diagnostics: diagnostics_out,
    })
}
