//! Tauri commands for session export and import.
//!
//! Wraps the `tracepilot-export` crate's builder, renderer, and import pipeline
//! for IPC consumption. All heavy work runs inside `spawn_blocking` to keep the
//! async runtime responsive.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::read_config;
use crate::types::{
    ExportPreviewResult, ExportSessionsResult, ImportIssue, ImportPreviewResult,
    ImportSessionPreview, ImportSessionsResult, SessionSectionsInfo,
};

use tracepilot_export::options::{ContentDetailOptions, ExportFormat, ExportOptions, OutputTarget, RedactionOptions};
use tracepilot_export::SectionId;

// ── Export Commands ────────────────────────────────────────────────────────

/// Export one or more sessions to the requested format and write to `output_path`.
#[tauri::command]
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

    let cfg = read_config(&state);
    let session_state_dir = cfg.session_state_dir();
    let export_format = parse_format(&format)?;
    let section_set = parse_sections(&sections);

    tokio::task::spawn_blocking(move || {
        let options = ExportOptions {
            format: export_format,
            sections: section_set,
            output: OutputTarget::File(PathBuf::from(&output_path)),
            content_detail: ContentDetailOptions {
                include_subagent_internals: include_subagent_internals.unwrap_or(true),
                include_tool_details: include_tool_details.unwrap_or(true),
                include_full_tool_results: include_full_tool_results.unwrap_or(false),
            },
            redaction: RedactionOptions {
                anonymize_paths: anonymize_paths.unwrap_or(false),
                strip_secrets: strip_secrets.unwrap_or(false),
                strip_pii: strip_pii.unwrap_or(false),
            },
        };

        // Resolve session directories
        let session_paths: Vec<PathBuf> = session_ids
            .iter()
            .map(|id| {
                tracepilot_core::session::discovery::resolve_session_path_in(
                    id,
                    &session_state_dir,
                )
            })
            .collect::<std::result::Result<Vec<_>, _>>()?;

        let path_refs: Vec<&Path> = session_paths.iter().map(|p| p.as_path()).collect();

        // Build archive and render
        let files = tracepilot_export::export_sessions_batch(&path_refs, &options)?;

        if files.is_empty() {
            return Err(BindingsError::Validation("Export produced no output".into()));
        }

        // Write to destination
        let out = PathBuf::from(&output_path);
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent)?;
        }

        // For multi-file exports (CSV, multi-session Markdown), write all files
        // alongside the primary path in the same directory.
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
    .await?
}

/// Generate a preview of the export output (for the live preview panel).
#[tauri::command]
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
    let cfg = read_config(&state);
    let session_state_dir = cfg.session_state_dir();
    let export_format = parse_format(&format)?;
    let section_set = parse_sections(&sections);

    tokio::task::spawn_blocking(move || {
        let options = ExportOptions {
            format: export_format,
            sections: section_set.clone(),
            output: OutputTarget::String,
            content_detail: ContentDetailOptions {
                include_subagent_internals: include_subagent_internals.unwrap_or(true),
                include_tool_details: include_tool_details.unwrap_or(true),
                include_full_tool_results: include_full_tool_results.unwrap_or(false),
            },
            redaction: RedactionOptions {
                anonymize_paths: anonymize_paths.unwrap_or(false),
                strip_secrets: strip_secrets.unwrap_or(false),
                strip_pii: strip_pii.unwrap_or(false),
            },
        };

        let session_path = tracepilot_core::session::discovery::resolve_session_path_in(
            &session_id,
            &session_state_dir,
        )?;

        let content = tracepilot_export::preview_export(
            &session_path,
            &options,
            max_bytes.or(Some(512 * 1024)), // Default 512KB preview limit
        )?;

        let estimated_size = content.len();
        let format_name = format.clone();

        Ok(ExportPreviewResult {
            content,
            format: format_name,
            estimated_size_bytes: estimated_size,
            section_count: section_set.len(),
        })
    })
    .await?
}

/// Get info about which sections have data for a given session.
#[tauri::command]
pub async fn get_session_sections(
    state: tauri::State<'_, SharedConfig>,
    session_id: String,
) -> CmdResult<SessionSectionsInfo> {
    let cfg = read_config(&state);
    let session_state_dir = cfg.session_state_dir();

    tokio::task::spawn_blocking(move || {
        let session_path = tracepilot_core::session::discovery::resolve_session_path_in(
            &session_id,
            &session_state_dir,
        )?;

        let events_path = session_path.join("events.jsonl");
        let db_path = session_path.join("session.db");
        let plan_path = session_path.join("plan.md");
        let checkpoints_path = session_path.join("checkpoints");

        let summary = tracepilot_core::summary::load_session_summary(&session_path).ok();

        let has_events = events_path.exists()
            && events_path.metadata().map(|m| m.len() > 0).unwrap_or(false);
        let has_todos = db_path.exists();
        let has_plan = plan_path.exists()
            && plan_path.metadata().map(|m| m.len() > 0).unwrap_or(false);
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
            has_health: false,
            has_incidents: false,
            has_rewind_snapshots: session_path.join("rewind-snapshots").exists(),
            has_custom_tables: false,
            event_count: summary.as_ref().and_then(|s| s.event_count),
            turn_count: summary.as_ref().and_then(|s| s.turn_count),
        })
    })
    .await?
}

// ── Import Commands ───────────────────────────────────────────────────────

/// Preview an import file — validate and show what would be imported.
#[tauri::command]
pub async fn preview_import(
    state: tauri::State<'_, SharedConfig>,
    file_path: String,
) -> CmdResult<ImportPreviewResult> {
    let cfg = read_config(&state);
    let session_state_dir = cfg.session_state_dir();

    tokio::task::spawn_blocking(move || {
        let path = PathBuf::from(&file_path);

        let preview = tracepilot_export::import::preview_import(&path, Some(&session_state_dir))?;

        let needs_migration = matches!(
            preview.migration_status,
            tracepilot_export::import::MigrationStatus::Available { .. }
        );

        let issues: Vec<ImportIssue> = preview
            .issues
            .into_iter()
            .map(|i| ImportIssue {
                severity: match i.severity {
                    tracepilot_export::import::IssueSeverity::Error => "error".into(),
                    tracepilot_export::import::IssueSeverity::Warning => "warning".into(),
                },
                message: i.message,
            })
            .collect();

        let sessions: Vec<ImportSessionPreview> = preview
            .sessions
            .into_iter()
            .map(|s| ImportSessionPreview {
                id: s.id,
                summary: s.summary,
                repository: s.repository,
                created_at: None, // summary doesn't carry timestamps
                section_count: s.available_sections.len(),
                already_exists: s.already_exists,
            })
            .collect();

        Ok(ImportPreviewResult {
            valid: preview.can_import,
            issues,
            sessions,
            schema_version: preview.schema_version.to_string(),
            needs_migration,
        })
    })
    .await?
}

/// Import sessions from a `.tpx.json` file.
#[tauri::command]
pub async fn import_sessions(
    state: tauri::State<'_, SharedConfig>,
    file_path: String,
    conflict_strategy: Option<String>,
    session_filter: Option<Vec<String>>,
    dry_run: Option<bool>,
) -> CmdResult<ImportSessionsResult> {
    let cfg = read_config(&state);
    let session_state_dir = cfg.session_state_dir();

    let strategy = match conflict_strategy.as_deref() {
        Some("replace") => tracepilot_export::import::ConflictStrategy::Replace,
        Some("duplicate") => tracepilot_export::import::ConflictStrategy::Duplicate,
        _ => tracepilot_export::import::ConflictStrategy::Skip,
    };

    tokio::task::spawn_blocking(move || {
        let path = PathBuf::from(&file_path);

        let options = tracepilot_export::import::ImportOptions {
            conflict_strategy: strategy,
            session_filter: session_filter.unwrap_or_default(),
            dry_run: dry_run.unwrap_or(false),
        };

        let result =
            tracepilot_export::import::import_sessions(&path, &session_state_dir, &options)?;

        Ok(ImportSessionsResult {
            imported_count: result.imported.len(),
            skipped_count: result.skipped.len(),
            warnings: result.warnings,
        })
    })
    .await?
}

// ── Helpers ───────────────────────────────────────────────────────────────

fn parse_format(format: &str) -> CmdResult<ExportFormat> {
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

fn parse_sections(sections: &[String]) -> HashSet<SectionId> {
    sections
        .iter()
        .filter_map(|s| match s.to_lowercase().as_str() {
            "conversation" => Some(SectionId::Conversation),
            "events" => Some(SectionId::Events),
            "todos" => Some(SectionId::Todos),
            "plan" => Some(SectionId::Plan),
            "checkpoints" => Some(SectionId::Checkpoints),
            "metrics" | "shutdownmetrics" => Some(SectionId::Metrics),
            "health" => Some(SectionId::Health),
            "incidents" => Some(SectionId::Incidents),
            "rewindsnapshots" | "rewind_snapshots" => Some(SectionId::RewindSnapshots),
            "customtables" | "custom_tables" => Some(SectionId::CustomTables),
            "parsediagnostics" | "parse_diagnostics" => Some(SectionId::ParseDiagnostics),
            _ => {
                tracing::warn!("Unknown section ID: {}", s);
                None
            }
        })
        .collect()
}
