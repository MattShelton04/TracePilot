//! Tauri commands for importing sessions from `.tpx.json` archives.

use std::path::PathBuf;

use crate::blocking_cmd;
use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::read_config;
use crate::types::{ImportIssue, ImportPreviewResult, ImportSessionPreview, ImportSessionsResult};

/// Preview an import file — validate and show what would be imported.
#[tauri::command]
#[tracing::instrument(skip_all, level = "debug", err)]
pub async fn preview_import(
    state: tauri::State<'_, SharedConfig>,
    file_path: String,
) -> CmdResult<ImportPreviewResult> {
    let cfg = read_config(&state);
    let session_state_dir = cfg.session_state_dir();

    blocking_cmd!({
        let path = PathBuf::from(&file_path);

        let preview = tracepilot_export::import::preview_import(&path, Some(&session_state_dir))?;

        let needs_migration = matches!(
            preview.migration_status,
            tracepilot_export::import::MigrationStatus::Available { .. }
        );

        let issues: Vec<ImportIssue> = preview.issues.into_iter().map(Into::into).collect();

        let sessions: Vec<ImportSessionPreview> = preview
            .sessions
            .into_iter()
            .map(|s| ImportSessionPreview {
                id: s.id,
                summary: s.summary,
                repository: s.repository,
                created_at: None,
                section_count: s.available_sections.len(),
                already_exists: s.already_exists,
            })
            .collect();

        Ok::<_, BindingsError>(ImportPreviewResult {
            valid: preview.can_import,
            issues,
            sessions,
            schema_version: preview.schema_version.to_string(),
            needs_migration,
        })
    })
}

/// Import sessions from a `.tpx.json` file.
#[tauri::command]
#[tracing::instrument(skip_all, err, fields(conflict = conflict_strategy.as_deref().unwrap_or("skip"), dry_run = dry_run.unwrap_or(false)))]
pub async fn import_sessions(
    state: tauri::State<'_, SharedConfig>,
    file_path: String,
    conflict_strategy: Option<String>,
    session_filter: Option<Vec<String>>,
    dry_run: Option<bool>,
) -> CmdResult<ImportSessionsResult> {
    if let Some(ref ids) = session_filter {
        crate::validators::validate_session_id_list(ids)?;
    }

    let cfg = read_config(&state);
    let session_state_dir = cfg.session_state_dir();

    let strategy = match conflict_strategy.as_deref() {
        Some("replace") => tracepilot_export::import::ConflictStrategy::Replace,
        Some("duplicate") => tracepilot_export::import::ConflictStrategy::Duplicate,
        _ => tracepilot_export::import::ConflictStrategy::Skip,
    };

    blocking_cmd!({
        let path = PathBuf::from(&file_path);

        let options = tracepilot_export::import::ImportOptions {
            conflict_strategy: strategy,
            session_filter: session_filter.unwrap_or_default(),
            dry_run: dry_run.unwrap_or(false),
        };

        let result =
            tracepilot_export::import::import_sessions(&path, &session_state_dir, &options)?;

        Ok::<_, BindingsError>(ImportSessionsResult {
            imported_count: result.imported.len(),
            skipped_count: result.skipped.len(),
            warnings: result.warnings,
        })
    })
}
