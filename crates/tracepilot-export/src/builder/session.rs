use std::path::Path;

use crate::document::{PortableSession, PortableSessionMetadata, SectionId, SessionSource};
use crate::error::{ExportError, Result};
use crate::options::ExportOptions;
use tracepilot_core::paths::SessionPaths;

use super::sections::{
    build_checkpoints, build_conversation, build_custom_tables, build_events, build_incidents,
    build_metrics, build_parse_diagnostics, build_plan, build_rewind_snapshots, build_todos,
};
use tracepilot_core::parsing::events::parse_typed_events;
use tracepilot_core::parsing::workspace::parse_workspace_yaml;
use tracepilot_core::summary::load_session_summary_from_events;
use tracepilot_core::turns::reconstruct_turns;

/// Build a single [`PortableSession`] from a session directory.
pub(super) fn build_portable_session(
    session_dir: &Path,
    options: &ExportOptions,
) -> Result<PortableSession> {
    let session_paths = SessionPaths::from_root(session_dir);

    // 1. A session has workspace metadata, an event log, or both. Older CLIs
    // wrote no `workspace.yaml`; the app lists those sessions from their events.
    let workspace_path = session_paths.workspace_yaml();
    let events_path = session_paths.events_jsonl();
    if !workspace_path.exists() && !events_path.exists() {
        return Err(ExportError::SessionNotFound(session_dir.to_path_buf()));
    }

    // 2. Parse events if any event-dependent section is requested
    let needs_events = options.includes(SectionId::Conversation)
        || options.includes(SectionId::Events)
        || options.includes(SectionId::Metrics)
        || options.includes(SectionId::Incidents)
        || options.includes(SectionId::ParseDiagnostics);

    let (typed_events, diagnostics) = if needs_events && events_path.exists() {
        let parsed = parse_typed_events(&events_path).map_err(ExportError::session_data)?;
        (Some(parsed.events), Some(parsed.diagnostics))
    } else {
        (None, None)
    };

    // 3. Build metadata
    let event_count = typed_events
        .as_ref()
        .map(|e| e.len())
        .or_else(|| if events_path.exists() { None } else { Some(0) });
    // Keep the reconstruction used for metadata for the conversation section.
    let turns = typed_events
        .as_ref()
        .map(|events| reconstruct_turns(events));
    let turn_count = turns.as_ref().map(Vec::len);

    // The metadata the app shows: `workspace.yaml` enriched from the events
    // (last activity, and `session.start` context for fields it lacks). A
    // missing or malformed `workspace.yaml` falls back to the events, as in
    // the app. Without parsed events this is the workspace metadata alone.
    let summary =
        load_session_summary_from_events(session_dir, typed_events.as_deref().unwrap_or_default())
            .map_err(ExportError::session_data)?;
    // Fields only `workspace.yaml` records.
    let ws = parse_workspace_yaml(&workspace_path).ok();
    let metadata = PortableSessionMetadata {
        id: summary.id,
        source: SessionSource::Copilot,
        summary: summary.summary,
        repository: summary.repository,
        branch: summary.branch,
        cwd: summary.cwd,
        git_root: ws.as_ref().and_then(|ws| ws.git_root.clone()),
        host_type: summary.host_type,
        created_at: summary.created_at,
        updated_at: summary.updated_at,
        event_count,
        turn_count,
        summary_count: ws.and_then(|ws| ws.summary_count),
        lineage: None, // Fresh export — no prior lineage
    };

    // 4. Build each optional section
    let mut available_sections = Vec::new();

    let conversation = build_conversation(
        options,
        typed_events.as_deref(),
        turns,
        &mut available_sections,
    );
    let todos = build_todos(options, session_dir, &mut available_sections);
    let plan = build_plan(options, session_dir, &mut available_sections);
    let checkpoints = build_checkpoints(options, session_dir, &mut available_sections);
    let rewind_snapshots = build_rewind_snapshots(options, session_dir, &mut available_sections);
    let shutdown_metrics = build_metrics(options, typed_events.as_deref(), &mut available_sections);
    let incidents = build_incidents(options, typed_events.as_deref(), &mut available_sections);
    let custom_tables = build_custom_tables(options, session_dir, &mut available_sections);
    let parse_diagnostics = build_parse_diagnostics(
        options,
        diagnostics.as_ref(),
        // Copilot's event parser is its format report.
        None,
        typed_events.as_ref().map(|e| e.len()).unwrap_or(0),
        &mut available_sections,
    );

    // All typed-event consumers have finished. Move raw envelopes into the
    // export instead of retaining a second copy of every event's JSON tree.
    let raw_events = if options.includes(SectionId::Events) {
        typed_events.map(|events| events.into_iter().map(|event| event.raw).collect())
    } else {
        None
    };
    let events = build_events(options, raw_events, &mut available_sections);
    // Events is now built last; preserve the established manifest wire order.
    available_sections.sort_by_key(|section| {
        SectionId::ALL
            .iter()
            .position(|candidate| candidate == section)
    });

    Ok(PortableSession {
        metadata,
        available_sections,
        conversation,
        events,
        todos,
        plan,
        checkpoints,
        rewind_snapshots,
        shutdown_metrics,
        incidents,
        custom_tables,
        parse_diagnostics,
        extensions: None,
    })
}
