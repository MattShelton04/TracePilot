//! Structured session export commands — JSON / Markdown export, live preview,
//! and section-availability detection.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use crate::blocking_cmd;
use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::{read_config, with_session_path};
use crate::types::{ExportPreviewResult, ExportSessionsResult, SessionSectionsInfo};

use tracepilot_core::parsing::session_db::list_tables;
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
        "csv" => Ok(ExportFormat::Csv),
        other => Err(BindingsError::Validation(format!(
            "Unknown export format: '{}'. Supported: json, markdown, csv",
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
            "health" => SectionId::Health,
            "incidents" => SectionId::Incidents,
            "rewindsnapshots" | "rewind_snapshots" | "snapshots" => SectionId::RewindSnapshots,
            "customtables" | "custom_tables" | "tables" => SectionId::CustomTables,
            "parsediagnostics" | "parse_diagnostics" | "diagnostics" => SectionId::ParseDiagnostics,
            unknown => {
                return Err(BindingsError::Validation(format!(
                    "Unknown section '{}'. Valid sections: conversation, events, todos, plan, \
                     checkpoints, metrics, health, incidents, snapshots, tables, diagnostics",
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
    let incident_types = [
        r#""type":"session.error""#,
        r#""type":"session.warning""#,
        r#""type":"session.compaction_complete""#,
        r#""type":"session.truncation""#,
    ];
    for line in reader.lines().map_while(Result::ok) {
        if incident_types.iter().any(|t| line.contains(t)) {
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
    let session_state_dir = cfg.session_state_dir();
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

        let session_paths: Vec<PathBuf> = session_ids
            .iter()
            .map(|id| {
                tracepilot_core::session::discovery::resolve_session_path_in(id, &session_state_dir)
            })
            .collect::<std::result::Result<Vec<_>, _>>()?;

        let path_refs: Vec<&Path> = session_paths.iter().map(|p| p.as_path()).collect();
        let files = tracepilot_export::export_sessions_batch(&path_refs, &options)?;

        if files.is_empty() {
            return Err(BindingsError::Validation(
                "Export produced no output".into(),
            ));
        }

        let out = PathBuf::from(&output_path);
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent)?;
        }

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
    let export_format = parse_format(&format)?;
    let section_set = parse_sections(&sections)?;
    let sid = crate::validators::validate_session_id(&session_id)?;

    with_session_path(&state, sid, move |session_path| {
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
            sections: section_set.clone(),
            output: OutputTarget::String,
            content_detail,
            redaction,
        };

        let full_content = tracepilot_export::preview_export(&session_path, &options, None)?;
        let estimated_size = full_content.len();

        let content = match max_bytes.or(Some(512 * 1024)) {
            Some(max) if full_content.len() > max => {
                let boundary = full_content.as_str().floor_char_boundary(max);
                full_content[..boundary].to_string()
            }
            _ => full_content,
        };
        let format_name = format.clone();

        Ok(ExportPreviewResult {
            content,
            format: format_name,
            estimated_size_bytes: estimated_size,
            section_count: section_set.len(),
        })
    })
    .await
}

/// Get info about which sections have data for a given session.
#[tauri::command]
pub async fn get_session_sections(
    state: tauri::State<'_, SharedConfig>,
    session_id: String,
) -> CmdResult<SessionSectionsInfo> {
    let sid = crate::validators::validate_session_id(&session_id)?;
    with_session_path(&state, sid, move |session_path| {
        let events_path = session_path.join("events.jsonl");
        let db_path = session_path.join("session.db");
        let plan_path = session_path.join("plan.md");
        let checkpoints_path = session_path.join("checkpoints");

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
            session_id,
            has_conversation,
            has_events,
            has_todos,
            has_plan,
            has_checkpoints,
            has_metrics,
            has_health: has_events,
            has_incidents: has_events && scan_events_for_incidents(&events_path),
            has_rewind_snapshots: session_path.join("rewind-snapshots").exists(),
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
