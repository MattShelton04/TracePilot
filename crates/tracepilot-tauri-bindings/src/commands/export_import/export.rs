//! Structured session export commands — JSON / Markdown export, live preview,
//! and section-availability detection.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use super::preview_cache::{self, PREVIEW_CACHE, PreviewCache, PreviewInputs, PreviewKey};
use super::sources::{ExportSession, INCIDENT_TYPES, provider_sections};

use crate::blocking_cmd;
use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::{read_config, resolve_session, with_session_locator};
use crate::types::{ExportPreviewResult, ExportSessionsResult, SessionSectionsInfo};

use tracepilot_core::SessionId;
use tracepilot_core::parsing::session_db::list_tables;
use tracepilot_core::provider::ResolvedSession;
use tracepilot_export::SectionId;
use tracepilot_export::options::{
    ContentDetailOptions, ExportFormat, ExportOptions, OutputTarget, RedactionOptions,
};

// ── Helper Functions ──────────────────────────────────────────────────────

/// Build `ContentDetailOptions` and `RedactionOptions` from optional parameters.
///
/// Centralises option-building logic used by both `export_sessions` and
/// `preview_export`, ensuring consistent defaults across all export commands.
pub(super) fn build_export_detail_options(
    include_subagent_internals: Option<bool>,
    include_tool_details: Option<bool>,
    include_full_tool_results: Option<bool>,
    anonymize_paths: Option<bool>,
    strip_secrets: Option<bool>,
    strip_pii: Option<bool>,
) -> (ContentDetailOptions, RedactionOptions) {
    let content_detail = ContentDetailOptions {
        include_subagent_internals: include_subagent_internals.unwrap_or(true),
        include_tool_details: include_tool_details.unwrap_or(true),
        include_full_tool_results: include_full_tool_results.unwrap_or(false),
    };

    let redaction = RedactionOptions {
        anonymize_paths: anonymize_paths.unwrap_or(false),
        strip_secrets: strip_secrets.unwrap_or(false),
        strip_pii: strip_pii.unwrap_or(false),
    };

    (content_detail, redaction)
}

pub(super) fn parse_format(format: &str) -> CmdResult<ExportFormat> {
    match format.to_lowercase().as_str() {
        "json" => Ok(ExportFormat::Json),
        "markdown" | "md" => Ok(ExportFormat::Markdown),
        other => Err(BindingsError::Validation(format!(
            "Unknown export format: '{}'. Supported: json, markdown",
            other
        ))),
    }
}

pub(super) fn parse_sections(sections: &[String]) -> CmdResult<HashSet<SectionId>> {
    if sections.is_empty() {
        return Ok(HashSet::new());
    }
    let mut result = HashSet::new();
    for s in sections {
        let section = match s.to_lowercase().as_str() {
            "conversation" => SectionId::Conversation,
            "events" => SectionId::Events,
            "todos" => SectionId::Todos,
            "plan" => SectionId::Plan,
            "checkpoints" => SectionId::Checkpoints,
            "metrics" | "shutdownmetrics" => SectionId::Metrics,
            "incidents" => SectionId::Incidents,
            "rewindsnapshots" | "rewind_snapshots" | "snapshots" => SectionId::RewindSnapshots,
            "customtables" | "custom_tables" | "tables" => SectionId::CustomTables,
            "parsediagnostics" | "parse_diagnostics" | "diagnostics" => SectionId::ParseDiagnostics,
            unknown => {
                return Err(BindingsError::Validation(format!(
                    "Unknown section '{}'. Valid sections: conversation, events, todos, plan, \
                     checkpoints, metrics, incidents, snapshots, tables, diagnostics",
                    unknown
                )));
            }
        };
        result.insert(section);
    }
    Ok(result)
}

fn scan_events_for_incidents(events_path: &Path) -> bool {
    use std::io::{BufRead, BufReader};
    let Ok(file) = std::fs::File::open(events_path) else {
        return false;
    };
    let reader = BufReader::new(file);
    let incident_types: Vec<String> = INCIDENT_TYPES
        .iter()
        .map(|t| format!(r#""type":"{t}""#))
        .collect();
    for line in reader.lines().map_while(Result::ok) {
        if incident_types.iter().any(|t| line.contains(t.as_str())) {
            return true;
        }
    }
    false
}

fn check_custom_tables(db_path: &Path) -> bool {
    if !db_path.exists() {
        return false;
    }
    let standard = ["todos", "todo_deps"];
    match list_tables(db_path) {
        Ok(names) => names.iter().any(|n| !standard.contains(&n.as_str())),
        Err(_) => false,
    }
}

// ── Export Commands ────────────────────────────────────────────────────────

/// Export one or more sessions to the requested format and write to `output_path`.
#[tauri::command]
#[tracing::instrument(skip_all, err, fields(%format, session_count = session_ids.len(), section_count = sections.len()))]
#[allow(clippy::too_many_arguments)]
pub async fn export_sessions(
    state: tauri::State<'_, SharedConfig>,
    session_ids: Vec<String>,
    format: String,
    sections: Vec<String>,
    output_path: String,
    include_subagent_internals: Option<bool>,
    include_tool_details: Option<bool>,
    include_full_tool_results: Option<bool>,
    anonymize_paths: Option<bool>,
    strip_secrets: Option<bool>,
    strip_pii: Option<bool>,
) -> CmdResult<ExportSessionsResult> {
    if session_ids.is_empty() {
        return Err(BindingsError::Validation("No sessions selected".into()));
    }
    crate::validators::validate_session_id_list(&session_ids)?;

    let cfg = read_config(&state);
    let export_format = parse_format(&format)?;
    let section_set = parse_sections(&sections)?;

    blocking_cmd!({
        let (content_detail, redaction) = build_export_detail_options(
            include_subagent_internals,
            include_tool_details,
            include_full_tool_results,
            anonymize_paths,
            strip_secrets,
            strip_pii,
        );

        let options = ExportOptions {
            format: export_format,
            sections: section_set,
            output: OutputTarget::File(PathBuf::from(&output_path)),
            content_detail,
            redaction,
        };

        let sessions: Vec<ExportSession> = session_ids
            .iter()
            .map(|id| {
                let id = crate::validators::validate_session_id(id)?;
                ExportSession::load(resolve_session(&cfg, &id)?)
            })
            .collect::<CmdResult<Vec<_>>>()?;

        let inputs: Vec<_> = sessions.iter().map(ExportSession::input).collect();
        let files = tracepilot_export::export_inputs(&inputs, &options)?;

        if files.is_empty() {
            return Err(BindingsError::Validation(
                "Export produced no output".into(),
            ));
        }

        let out = PathBuf::from(&output_path);
        tracepilot_core::utils::fs::ensure_parent_dir(&out)?;

        let mut total_size: u64 = 0;
        if files.len() == 1 {
            std::fs::write(&out, &files[0].content)?;
            total_size = files[0].content.len() as u64;
        } else {
            let parent_dir = out
                .parent()
                .ok_or_else(|| BindingsError::Validation("Invalid output path".into()))?;
            for file in &files {
                let dest = parent_dir.join(&file.filename);
                std::fs::write(&dest, &file.content)?;
                total_size += file.content.len() as u64;
            }
        }

        let now: chrono::DateTime<chrono::Utc> = chrono::Utc::now();

        Ok(ExportSessionsResult {
            sessions_exported: session_ids.len(),
            file_path: output_path,
            file_size_bytes: total_size,
            exported_at: now.to_rfc3339(),
        })
    })
}

/// Generate a preview of the export output (for the live preview panel).
/// Recent previews are reused while the session's files are unchanged.
#[tauri::command]
#[tracing::instrument(skip_all, level = "debug", err, fields(%session_id, %format))]
#[allow(clippy::too_many_arguments)]
pub async fn preview_export(
    state: tauri::State<'_, SharedConfig>,
    session_id: String,
    format: String,
    sections: Vec<String>,
    max_bytes: Option<usize>,
    include_subagent_internals: Option<bool>,
    include_tool_details: Option<bool>,
    include_full_tool_results: Option<bool>,
    anonymize_paths: Option<bool>,
    strip_secrets: Option<bool>,
    strip_pii: Option<bool>,
) -> CmdResult<ExportPreviewResult> {
    parse_format(&format)?;
    parse_sections(&sections)?;
    let sid = crate::validators::validate_session_id(&session_id)?;
    let request = PreviewKey {
        session_id,
        primary_path: PathBuf::new(),
        format,
        sections,
        max_bytes,
        detail: [
            include_subagent_internals,
            include_tool_details,
            include_full_tool_results,
            anonymize_paths,
            strip_secrets,
            strip_pii,
        ],
    };
    with_session_locator(&state, sid, move |session| {
        cached_preview(&PREVIEW_CACHE, session, request)
    })
    .await
}

/// The preview for `request` (with its `primary_path` filled in here), from
/// the cache when nothing it was rendered from has changed, stamped with the
/// current export time. Blocking.
pub(super) fn cached_preview(
    cache: &PreviewCache,
    session: ResolvedSession,
    mut request: PreviewKey,
) -> CmdResult<ExportPreviewResult> {
    request.primary_path = session.locator.primary_path.clone();
    // Read before loading, so a change made during the render is a miss.
    let source_version = preview_cache::source_version(&session);
    if let Some(version) = &source_version
        && let Some(hit) = cache.get(&request, version)
    {
        return Ok(preview_cache::with_exported_at(hit, chrono::Utc::now()));
    }
    let session = ExportSession::load(session)?;
    let inputs = PreviewInputs::read(source_version, &session);
    let result = render_preview(&session, &request)?;
    if let Some(inputs) = inputs {
        cache.insert(request, inputs, &result);
    }
    Ok(result)
}

fn render_preview(session: &ExportSession, request: &PreviewKey) -> CmdResult<ExportPreviewResult> {
    let section_set = parse_sections(&request.sections)?;
    let [
        subagents,
        tool_details,
        full_results,
        anonymize,
        secrets,
        pii,
    ] = request.detail;
    let (content_detail, redaction) = build_export_detail_options(
        subagents,
        tool_details,
        full_results,
        anonymize,
        secrets,
        pii,
    );
    let options = ExportOptions {
        format: parse_format(&request.format)?,
        sections: section_set,
        output: OutputTarget::String,
        content_detail,
        redaction,
    };

    let full_content = tracepilot_export::preview_export_input(&session.input(), &options, None)?;
    let estimated_size = full_content.len();
    let content = match request.max_bytes.or(Some(512 * 1024)) {
        Some(max) if full_content.len() > max => {
            tracepilot_core::utils::truncate_utf8(&full_content, max).to_string()
        }
        _ => full_content,
    };

    Ok(ExportPreviewResult {
        content,
        format: request.format.clone(),
        estimated_size_bytes: estimated_size,
        section_count: options.sections.len(),
    })
}

/// Get info about which sections have data for a given session.
#[tauri::command]
pub async fn get_session_sections(
    state: tauri::State<'_, SharedConfig>,
    session_id: String,
) -> CmdResult<SessionSectionsInfo> {
    let sid = crate::validators::validate_session_id(&session_id)?;
    with_session_locator(&state, sid, move |session| {
        let session_path = match ExportSession::load(session)? {
            ExportSession::Directory(dir) => dir,
            ExportSession::Provider {
                snapshot,
                artifacts,
                ..
            } => {
                let session_id = SessionId::from_validated(session_id);
                return Ok(provider_sections(session_id, &snapshot, &artifacts));
            }
        };
        let sp = tracepilot_core::paths::SessionPaths::from_root(&session_path);
        let events_path = sp.events_jsonl();
        let db_path = sp.session_db();
        let plan_path = sp.plan_md();
        let checkpoints_path = sp.checkpoints_dir();

        let summary = tracepilot_core::summary::load_session_summary(&session_path).ok();

        let has_events =
            events_path.exists() && events_path.metadata().map(|m| m.len() > 0).unwrap_or(false);
        let has_todos = db_path.exists();
        let has_plan =
            plan_path.exists() && plan_path.metadata().map(|m| m.len() > 0).unwrap_or(false);
        let has_checkpoints = checkpoints_path.exists() && checkpoints_path.is_dir();
        let has_conversation = has_events;
        let has_metrics = summary
            .as_ref()
            .and_then(|s| s.shutdown_metrics.as_ref())
            .is_some();

        Ok(SessionSectionsInfo {
            session_id: SessionId::from_validated(session_id),
            has_conversation,
            has_events,
            has_todos,
            has_plan,
            has_checkpoints,
            has_metrics,
            has_incidents: has_events && scan_events_for_incidents(&events_path),
            has_rewind_snapshots: sp.rewind_snapshots_dir().exists(),
            has_custom_tables: check_custom_tables(&db_path),
            event_count: summary.as_ref().and_then(|s| s.event_count),
            turn_count: summary.as_ref().and_then(|s| s.turn_count),
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_export_detail_options_uses_defaults_when_all_none() {
        let (content, redaction) = build_export_detail_options(None, None, None, None, None, None);
        let default_content = ContentDetailOptions::default();
        let default_redaction = RedactionOptions::default();

        assert_eq!(
            content.include_subagent_internals,
            default_content.include_subagent_internals
        );
        assert_eq!(
            content.include_tool_details,
            default_content.include_tool_details
        );
        assert_eq!(
            content.include_full_tool_results,
            default_content.include_full_tool_results
        );

        assert_eq!(redaction.anonymize_paths, default_redaction.anonymize_paths);
        assert_eq!(redaction.strip_secrets, default_redaction.strip_secrets);
        assert_eq!(redaction.strip_pii, default_redaction.strip_pii);
    }

    #[test]
    fn build_export_detail_options_respects_explicit_values() {
        let (content, redaction) = build_export_detail_options(
            Some(false),
            Some(false),
            Some(true),
            Some(true),
            Some(true),
            Some(true),
        );

        assert!(!content.include_subagent_internals);
        assert!(!content.include_tool_details);
        assert!(content.include_full_tool_results);

        assert!(redaction.anonymize_paths);
        assert!(redaction.strip_secrets);
        assert!(redaction.strip_pii);
    }

    #[test]
    fn build_export_detail_options_handles_partial_overrides() {
        let (content, redaction) =
            build_export_detail_options(Some(false), None, None, None, Some(true), None);

        assert!(!content.include_subagent_internals); // overridden
        assert!(content.include_tool_details); // default
        assert!(!content.include_full_tool_results); // default

        assert!(!redaction.anonymize_paths); // default
        assert!(redaction.strip_secrets); // overridden
        assert!(!redaction.strip_pii); // default
    }

    #[test]
    fn empty_sections_returns_empty_set() {
        let result = parse_sections(&[]).unwrap();
        assert!(
            result.is_empty(),
            "empty input should produce empty set, not all sections"
        );
    }

    #[test]
    fn explicit_sections_are_parsed() {
        let result = parse_sections(&["conversation".to_string(), "plan".to_string()]).unwrap();
        assert_eq!(result.len(), 2);
        assert!(result.contains(&SectionId::Conversation));
        assert!(result.contains(&SectionId::Plan));
    }

    #[test]
    fn unknown_section_returns_error() {
        let result = parse_sections(&["nonexistent".to_string()]);
        assert!(result.is_err());
    }
}
