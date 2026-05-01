use std::path::Path;

use crate::document::{PortableSession, PortableSessionMetadata, SectionId};
use crate::error::{ExportError, Result};
use crate::options::ExportOptions;

use super::sections::{
    build_checkpoints, build_conversation, build_custom_tables, build_events, build_health,
    build_incidents, build_metrics, build_parse_diagnostics, build_plan, build_rewind_snapshots,
    build_todos,
};
use tracepilot_core::parsing::events::parse_typed_events;
use tracepilot_core::parsing::workspace::parse_workspace_yaml;
use tracepilot_core::turns::reconstruct_turns;

/// Build a single [`PortableSession`] from a session directory.
pub(super) fn build_portable_session(
    session_dir: &Path,
    options: &ExportOptions,
) -> Result<PortableSession> {
    // 1. Load workspace metadata (always required)
    let workspace_path = session_dir.join("workspace.yaml");
    if !workspace_path.exists() {
        return Err(ExportError::SessionNotFound(session_dir.to_path_buf()));
    }
    let ws = parse_workspace_yaml(&workspace_path).map_err(ExportError::session_data)?;

    // 2. Parse events if any event-dependent section is requested
    let needs_events = options.includes(SectionId::Conversation)
        || options.includes(SectionId::Events)
        || options.includes(SectionId::Metrics)
        || options.includes(SectionId::Incidents)
        || options.includes(SectionId::Health)
        || options.includes(SectionId::ParseDiagnostics);

    let events_path = session_dir.join("events.jsonl");
    let (typed_events, raw_events, diagnostics) = if needs_events && events_path.exists() {
        let parsed = parse_typed_events(&events_path).map_err(ExportError::session_data)?;
        let raw = parsed.events.iter().map(|te| te.raw.clone()).collect();
        (Some(parsed.events), Some(raw), Some(parsed.diagnostics))
    } else {
        (None, None, None)
    };

    // 3. Build metadata
    let event_count = typed_events
        .as_ref()
        .map(|e| e.len())
        .or_else(|| if events_path.exists() { None } else { Some(0) });
    let turn_count = typed_events.as_ref().map(|events| {
        let turns = reconstruct_turns(events);
        turns.len()
    });

    let metadata = PortableSessionMetadata {
        id: ws.id,
        summary: ws.summary,
        repository: ws.repository,
        branch: ws.branch,
        cwd: ws.cwd,
        git_root: ws.git_root,
        host_type: ws.host_type,
        created_at: ws.created_at,
        updated_at: ws.updated_at,
        event_count,
        turn_count,
        summary_count: ws.summary_count,
        lineage: None, // Fresh export — no prior lineage
    };

    // 4. Build each optional section
    let mut available_sections = Vec::new();

    let conversation =
        build_conversation(options, typed_events.as_deref(), &mut available_sections);
    let events = build_events(options, raw_events, &mut available_sections);
    let todos = build_todos(options, session_dir, &mut available_sections);
    let plan = build_plan(options, session_dir, &mut available_sections);
    let checkpoints = build_checkpoints(options, session_dir, &mut available_sections);
    let rewind_snapshots = build_rewind_snapshots(options, session_dir, &mut available_sections);
    let shutdown_metrics = build_metrics(options, typed_events.as_deref(), &mut available_sections);
    let incidents = build_incidents(options, typed_events.as_deref(), &mut available_sections);
    let health = build_health(
        options,
        typed_events.as_deref(),
        diagnostics.as_ref(),
        &mut available_sections,
    );
    let custom_tables = build_custom_tables(options, session_dir, &mut available_sections);
    let parse_diagnostics = build_parse_diagnostics(
        options,
        diagnostics.as_ref(),
        typed_events.as_ref().map(|e| e.len()).unwrap_or(0),
        &mut available_sections,
    );

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
        health,
        custom_tables,
        parse_diagnostics,
        extensions: None,
    })
}
