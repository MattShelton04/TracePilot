//! Build a [`SessionArchive`] from a session directory on disk.
//!
//! The builder reads session files using `tracepilot-core` parsers and
//! assembles a [`SessionArchive`] according to the user's [`ExportOptions`].
//! Only requested sections are loaded, keeping memory usage proportional
//! to what the user actually wants to export.

use std::path::Path;

use chrono::Utc;

use crate::document::*;
use crate::error::{ExportError, Result};
use crate::options::{ExportFormat, ExportOptions};
use crate::schema;

use tracepilot_core::health::SessionIncidentCounts;
use tracepilot_core::health::compute_health;
use tracepilot_core::parsing::checkpoints::parse_checkpoints;
use tracepilot_core::parsing::events::{
    TypedEvent, TypedEventData, extract_combined_shutdown_data, parse_typed_events,
};
use tracepilot_core::parsing::rewind_snapshots::parse_rewind_index;
use tracepilot_core::parsing::session_db::{
    list_tables, read_custom_table, read_todo_deps, read_todos,
};
use tracepilot_core::parsing::workspace::parse_workspace_yaml;
use tracepilot_core::turns::reconstruct_turns;

/// Build a [`SessionArchive`] from one session directory.
pub fn build_session_archive(
    session_dir: &Path,
    options: &ExportOptions,
) -> Result<SessionArchive> {
    let session = build_portable_session(session_dir, options)?;

    Ok(SessionArchive {
        header: build_header(options),
        sessions: vec![session],
        export_options: build_options_record(options),
    })
}

/// Build a [`SessionArchive`] from multiple session directories (batch export).
pub fn build_session_archive_batch(
    session_dirs: &[&Path],
    options: &ExportOptions,
) -> Result<SessionArchive> {
    let mut sessions = Vec::with_capacity(session_dirs.len());
    for dir in session_dirs {
        sessions.push(build_portable_session(dir, options)?);
    }

    Ok(SessionArchive {
        header: build_header(options),
        sessions,
        export_options: build_options_record(options),
    })
}

// ── Internal builders ──────────────────────────────────────────────────────

fn build_header(_options: &ExportOptions) -> ArchiveHeader {
    ArchiveHeader {
        schema_version: schema::CURRENT_VERSION,
        exported_at: Utc::now(),
        exported_by: format!("TracePilot v{}", env!("CARGO_PKG_VERSION")),
        source_system: Some(build_source_system()),
        content_hash: None, // Set by the renderer after serialization
        minimum_reader_version: Some(schema::MINIMUM_READER_VERSION),
    }
}

fn build_source_system() -> SourceSystem {
    SourceSystem {
        os: Some(std::env::consts::OS.to_string()),
        hostname_hash: None, // Phase C: redaction will populate this
        timezone_offset: None,
    }
}

fn build_options_record(options: &ExportOptions) -> ArchiveOptionsRecord {
    ArchiveOptionsRecord {
        format: match options.format {
            ExportFormat::Json => "json".to_string(),
            ExportFormat::Markdown => "markdown".to_string(),
            ExportFormat::Csv => "csv".to_string(),
        },
        included_sections: options.sections.iter().copied().collect(),
        redaction_applied: false, // Phase C: redaction
    }
}

/// Build a single [`PortableSession`] from a session directory.
fn build_portable_session(session_dir: &Path, options: &ExportOptions) -> Result<PortableSession> {
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
        let raw: Vec<RawEvent> = parsed.events.iter().map(|te| te.raw.clone()).collect();
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

// ── Section builders ───────────────────────────────────────────────────────
// Each function checks if the section is requested, loads data, and pushes
// the SectionId to available_sections if data was successfully loaded.

fn build_conversation(
    options: &ExportOptions,
    typed_events: Option<&[TypedEvent]>,
    available: &mut Vec<SectionId>,
) -> Option<Vec<ConversationTurn>> {
    if !options.includes(SectionId::Conversation) {
        return None;
    }
    let events = typed_events?;
    let mut turns = reconstruct_turns(events);

    // Optionally replace truncated result_content with full content from events
    if options.content_detail.include_full_tool_results && !turns.is_empty() {
        let full_results = build_full_result_map(events);
        for turn in &mut turns {
            for tc in &mut turn.tool_calls {
                if let Some(tc_id) = tc.tool_call_id.as_deref()
                    && let Some(full) = full_results.get(tc_id)
                {
                    tc.result_content = Some(full.clone());
                }
            }
        }
    }

    if !turns.is_empty() {
        available.push(SectionId::Conversation);
    }
    Some(turns)
}

/// Build a map from tool_call_id → full (non-truncated) result string.
fn build_full_result_map(events: &[TypedEvent]) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    for event in events {
        if let TypedEventData::ToolExecutionComplete(data) = &event.typed_data
            && let (Some(id), Some(result)) = (&data.tool_call_id, &data.result)
            && let Some(text) = extract_full_result(result)
        {
            map.insert(id.clone(), text);
        }
    }
    map
}

/// Extract the full result text from a tool execution result value.
/// Mirrors the core `extract_result_preview` logic but without truncation.
fn extract_full_result(result: &serde_json::Value) -> Option<String> {
    match result {
        serde_json::Value::String(s) if !s.trim().is_empty() => Some(s.clone()),
        serde_json::Value::Object(obj) => obj
            .get("content")
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
            .or_else(|| {
                obj.get("detailedContent")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.trim().is_empty())
            })
            .map(|s| s.to_string()),
        _ => None,
    }
}

fn build_events(
    options: &ExportOptions,
    raw_events: Option<Vec<RawEvent>>,
    available: &mut Vec<SectionId>,
) -> Option<Vec<RawEvent>> {
    if !options.includes(SectionId::Events) {
        return None;
    }
    let events = raw_events?;
    if !events.is_empty() {
        available.push(SectionId::Events);
    }
    Some(events)
}

fn build_todos(
    options: &ExportOptions,
    session_dir: &Path,
    available: &mut Vec<SectionId>,
) -> Option<TodoExport> {
    if !options.includes(SectionId::Todos) {
        return None;
    }
    let db_path = session_dir.join("session.db");
    if !db_path.exists() {
        return None;
    }

    let items = match read_todos(&db_path) {
        Ok(todos) => todos,
        Err(e) => {
            tracing::warn!(
                path = %db_path.display(),
                error = %e,
                "Failed to read todos from session database, returning empty list"
            );
            Vec::new()
        }
    };

    let deps = match read_todo_deps(&db_path) {
        Ok(deps) => deps,
        Err(e) => {
            tracing::warn!(
                path = %db_path.display(),
                error = %e,
                "Failed to read todo dependencies from session database, returning empty list"
            );
            Vec::new()
        }
    };

    let export = TodoExport {
        items: items
            .into_iter()
            .map(|t| TodoItemExport {
                id: t.id,
                title: t.title,
                description: t.description,
                status: t.status,
                created_at: t.created_at,
                updated_at: t.updated_at,
            })
            .collect(),
        deps: deps
            .into_iter()
            .map(|d| TodoDepExport {
                todo_id: d.todo_id,
                depends_on: d.depends_on,
            })
            .collect(),
    };

    if !export.items.is_empty() {
        available.push(SectionId::Todos);
    }
    Some(export)
}

fn build_plan(
    options: &ExportOptions,
    session_dir: &Path,
    available: &mut Vec<SectionId>,
) -> Option<String> {
    if !options.includes(SectionId::Plan) {
        return None;
    }
    let plan_path = session_dir.join("plan.md");
    match std::fs::read_to_string(&plan_path) {
        Ok(content) if !content.trim().is_empty() => {
            available.push(SectionId::Plan);
            Some(content)
        }
        Ok(_) => None,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => {
            tracing::warn!(
                path = %plan_path.display(),
                error = %e,
                "Failed to read plan file, skipping section"
            );
            None
        }
    }
}

fn build_checkpoints(
    options: &ExportOptions,
    session_dir: &Path,
    available: &mut Vec<SectionId>,
) -> Option<Vec<CheckpointExport>> {
    if !options.includes(SectionId::Checkpoints) {
        return None;
    }
    let index = match parse_checkpoints(session_dir) {
        Ok(Some(idx)) => idx,
        Ok(None) => return None,
        Err(e) => {
            tracing::warn!(
                path = %session_dir.join("checkpoints").join("index.md").display(),
                error = %e,
                "Failed to read or parse checkpoints, skipping section"
            );
            return None;
        }
    };
    let exports: Vec<CheckpointExport> = index
        .checkpoints
        .into_iter()
        .map(|cp| CheckpointExport {
            number: cp.number,
            title: cp.title,
            filename: cp.filename,
            content: cp.content,
        })
        .collect();

    if !exports.is_empty() {
        available.push(SectionId::Checkpoints);
    }
    Some(exports)
}

fn build_rewind_snapshots(
    options: &ExportOptions,
    session_dir: &Path,
    available: &mut Vec<SectionId>,
) -> Option<RewindIndex> {
    if !options.includes(SectionId::RewindSnapshots) {
        return None;
    }
    let index = match parse_rewind_index(session_dir) {
        Ok(Some(idx)) => idx,
        Ok(None) => return None,
        Err(e) => {
            tracing::warn!(
                path = %session_dir.join("rewind-snapshots").join("index.json").display(),
                error = %e,
                "Failed to read or parse rewind snapshots, skipping section"
            );
            return None;
        }
    };
    if !index.snapshots.is_empty() {
        available.push(SectionId::RewindSnapshots);
    }
    Some(index)
}

fn build_metrics(
    options: &ExportOptions,
    typed_events: Option<&[TypedEvent]>,
    available: &mut Vec<SectionId>,
) -> Option<ShutdownMetrics> {
    if !options.includes(SectionId::Metrics) {
        return None;
    }
    let events = typed_events?;
    let (sd, count) = extract_combined_shutdown_data(events)?;

    available.push(SectionId::Metrics);
    Some(ShutdownMetrics {
        shutdown_type: sd.shutdown_type,
        total_premium_requests: sd.total_premium_requests,
        total_api_duration_ms: sd.total_api_duration_ms,
        session_start_time: sd.session_start_time,
        current_model: sd.current_model,
        current_tokens: sd.current_tokens,
        system_tokens: sd.system_tokens,
        conversation_tokens: sd.conversation_tokens,
        tool_definitions_tokens: sd.tool_definitions_tokens,
        code_changes: sd.code_changes,
        model_metrics: sd.model_metrics.unwrap_or_default(),
        session_segments: sd.session_segments,
        shutdown_count: Some(count),
    })
}

fn build_incidents(
    options: &ExportOptions,
    typed_events: Option<&[TypedEvent]>,
    available: &mut Vec<SectionId>,
) -> Option<Vec<IncidentExport>> {
    if !options.includes(SectionId::Incidents) {
        return None;
    }
    let events = typed_events?;
    let mut incidents = Vec::new();

    for event in events {
        let raw = &event.raw;
        let severity = match raw.event_type.as_str() {
            "session.error" => "error",
            "session.warning" => "warning",
            "session.compaction_complete" => "info",
            "session.truncation" => "warning",
            _ => continue,
        };

        let summary = match &event.typed_data {
            tracepilot_core::parsing::events::TypedEventData::SessionError(d) => d
                .message
                .clone()
                .unwrap_or_else(|| "Unknown error".to_string()),
            tracepilot_core::parsing::events::TypedEventData::SessionWarning(d) => {
                d.message.clone().unwrap_or_else(|| "Warning".to_string())
            }
            tracepilot_core::parsing::events::TypedEventData::CompactionComplete(d) => {
                format!(
                    "Compaction {}",
                    if d.success.unwrap_or(false) {
                        "succeeded"
                    } else {
                        "failed"
                    }
                )
            }
            tracepilot_core::parsing::events::TypedEventData::SessionTruncation(_) => {
                "Session truncated".to_string()
            }
            _ => continue,
        };

        incidents.push(IncidentExport {
            event_type: raw.event_type.clone(),
            timestamp: raw.timestamp,
            severity: severity.to_string(),
            summary,
        });
    }

    if !incidents.is_empty() {
        available.push(SectionId::Incidents);
    }
    Some(incidents)
}

fn build_health(
    options: &ExportOptions,
    typed_events: Option<&[TypedEvent]>,
    diagnostics: Option<&tracepilot_core::parsing::diagnostics::ParseDiagnostics>,
    available: &mut Vec<SectionId>,
) -> Option<SessionHealth> {
    if !options.includes(SectionId::Health) {
        return None;
    }

    // Count incidents for health scoring
    let incident_counts = typed_events.map(|events| {
        let mut counts = SessionIncidentCounts::default();
        for event in events {
            match event.raw.event_type.as_str() {
                "session.error" => counts.error_count += 1,
                "session.warning" => counts.warning_count += 1,
                "session.compaction_complete" => counts.compaction_count += 1,
                "session.truncation" => counts.truncation_count += 1,
                _ => {}
            }
        }
        counts
    });

    let event_count = typed_events.map(|e| e.len());
    let shutdown_metrics = typed_events.and_then(|events| {
        extract_combined_shutdown_data(events).map(|(sd, count)| ShutdownMetrics {
            shutdown_type: sd.shutdown_type,
            total_premium_requests: sd.total_premium_requests,
            total_api_duration_ms: sd.total_api_duration_ms,
            session_start_time: sd.session_start_time,
            current_model: sd.current_model,
            current_tokens: sd.current_tokens,
            system_tokens: sd.system_tokens,
            conversation_tokens: sd.conversation_tokens,
            tool_definitions_tokens: sd.tool_definitions_tokens,
            code_changes: sd.code_changes,
            model_metrics: sd.model_metrics.unwrap_or_default(),
            session_segments: sd.session_segments,
            shutdown_count: Some(count),
        })
    });

    let health = compute_health(
        event_count,
        shutdown_metrics.as_ref(),
        diagnostics,
        incident_counts.as_ref(),
    );

    available.push(SectionId::Health);
    Some(health)
}

fn build_custom_tables(
    options: &ExportOptions,
    session_dir: &Path,
    available: &mut Vec<SectionId>,
) -> Option<Vec<CustomTableExport>> {
    if !options.includes(SectionId::CustomTables) {
        return None;
    }
    let db_path = session_dir.join("session.db");
    if !db_path.exists() {
        return None;
    }

    let table_names = match list_tables(&db_path) {
        Ok(names) => names,
        Err(e) => {
            tracing::warn!(
                path = %db_path.display(),
                error = %e,
                "Failed to list tables in session database, skipping custom tables"
            );
            return None;
        }
    };

    // Exclude standard tables — only export custom ones
    let standard = ["todos", "todo_deps"];
    let custom_names: Vec<_> = table_names
        .into_iter()
        .filter(|name| !standard.contains(&name.as_str()))
        .collect();

    if custom_names.is_empty() {
        return None;
    }

    let mut tables = Vec::new();
    for name in custom_names {
        match read_custom_table(&db_path, &name) {
            Ok(info) => {
                tables.push(CustomTableExport {
                    name: info.name,
                    columns: info.columns,
                    rows: info.rows,
                });
            }
            Err(e) => {
                tracing::warn!(
                    path = %db_path.display(),
                    table = %name,
                    error = %e,
                    "Failed to read custom table, skipping"
                );
            }
        }
    }

    if !tables.is_empty() {
        available.push(SectionId::CustomTables);
    }
    Some(tables)
}

fn build_parse_diagnostics(
    options: &ExportOptions,
    diagnostics: Option<&tracepilot_core::parsing::diagnostics::ParseDiagnostics>,
    total_events: usize,
    available: &mut Vec<SectionId>,
) -> Option<ParseDiagnosticsExport> {
    if !options.includes(SectionId::ParseDiagnostics) {
        return None;
    }
    let diag = diagnostics?;

    available.push(SectionId::ParseDiagnostics);
    Some(ParseDiagnosticsExport {
        total_events,
        malformed_lines: diag.malformed_lines,
        unknown_event_types: diag.unknown_event_types.len(),
        deserialization_failures: diag.deserialization_failures.len(),
        warnings: if diag.has_warnings() {
            // Reconstruct warnings from the diagnostic maps
            let mut warnings = Vec::new();
            for event_type in diag.unknown_event_types.keys() {
                warnings.push(EventParseWarning::UnknownEventType {
                    event_type: event_type.clone(),
                });
            }
            for (event_type, info) in &diag.deserialization_failures {
                warnings.push(EventParseWarning::DeserializationFailed {
                    event_type: event_type.clone(),
                    error: info.first_error.clone(),
                });
            }
            Some(warnings)
        } else {
            None
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn extract_full_result_string_value() {
        let val = json!("Hello, world!");
        assert_eq!(extract_full_result(&val), Some("Hello, world!".into()));
    }

    #[test]
    fn extract_full_result_empty_string() {
        let val = json!("  ");
        assert_eq!(extract_full_result(&val), None);
    }

    #[test]
    fn extract_full_result_object_with_content() {
        let val = json!({"content": "full result text", "other": 42});
        assert_eq!(extract_full_result(&val), Some("full result text".into()));
    }

    #[test]
    fn extract_full_result_object_with_detailed_content_fallback() {
        let val = json!({"detailedContent": "detailed text"});
        assert_eq!(extract_full_result(&val), Some("detailed text".into()));
    }

    #[test]
    fn extract_full_result_object_prefers_content_over_detailed() {
        let val = json!({"content": "primary", "detailedContent": "fallback"});
        assert_eq!(extract_full_result(&val), Some("primary".into()));
    }

    #[test]
    fn extract_full_result_null() {
        let val = json!(null);
        assert_eq!(extract_full_result(&val), None);
    }

    #[test]
    fn extract_full_result_object_empty_content() {
        let val = json!({"content": "", "detailedContent": "fallback"});
        assert_eq!(extract_full_result(&val), Some("fallback".into()));
    }
}
