//! Session artifact commands: todos, checkpoints, plan, background tasks,
//! file history.

use tracepilot_core::provider::{
    FileCheckpoint, FileVersionContent, PlanArtifact, SessionSource, is_safe_backup_name,
};

use super::artifact_cache::session_artifacts;
use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::{MAX_CHECKPOINT_CONTENT_BYTES, with_session_locator};
use crate::types::TodosResponse;

/// The most of one backed-up file version shown at once.
const MAX_FILE_VERSION_BYTES: usize = 1024 * 1024;

// A source without an artifact has nothing to show, so these read-only
// commands return it empty rather than refusing. Todos and checkpoints read
// Copilot's layout directly; the plan, background tasks and file history of
// other sources route through the provider.

#[tauri::command]
#[tracing::instrument(skip_all, level = "debug", err, fields(session_id = %session_id))]
pub async fn get_session_todos(
    state: tauri::State<'_, SharedConfig>,
    session_id: String,
) -> CmdResult<TodosResponse> {
    let sid = crate::validators::validate_session_id(&session_id)?;
    with_session_locator(&state, sid, |session| {
        if !session.provider.capabilities().has_todos {
            return Ok(TodosResponse {
                todos: Vec::new(),
                deps: Vec::new(),
            });
        }
        let db_path = session.locator.primary_path.join("session.db");
        let todos = tracepilot_core::parsing::session_db::read_todos(&db_path)?;
        let deps = tracepilot_core::parsing::session_db::read_todo_deps(&db_path)?;
        Ok(TodosResponse { todos, deps })
    })
    .await
}

#[tauri::command]
#[tracing::instrument(skip_all, level = "debug", err, fields(session_id = %session_id))]
pub async fn get_session_checkpoints(
    state: tauri::State<'_, SharedConfig>,
    session_id: String,
) -> CmdResult<Vec<tracepilot_core::parsing::checkpoints::CheckpointEntry>> {
    let sid = crate::validators::validate_session_id(&session_id)?;
    with_session_locator(&state, sid, |session| {
        if !session.provider.capabilities().has_checkpoints {
            return Ok(Vec::new());
        }
        let path = &session.locator.primary_path;
        let mut checkpoints = tracepilot_core::parsing::checkpoints::parse_checkpoints(path)?
            .map(|index| index.checkpoints)
            .unwrap_or_default();

        for checkpoint in &mut checkpoints {
            if let Some(content) = checkpoint.content.as_mut() {
                tracepilot_core::utils::truncate_string_utf8(content, MAX_CHECKPOINT_CONTENT_BYTES);
            }
        }

        Ok(checkpoints)
    })
    .await
}

#[tauri::command]
#[tracing::instrument(skip_all, level = "debug", err, fields(session_id = %session_id))]
pub async fn get_session_plan(
    state: tauri::State<'_, SharedConfig>,
    session_id: String,
) -> CmdResult<Option<serde_json::Value>> {
    let sid = crate::validators::validate_session_id(&session_id)?;
    with_session_locator(&state, sid, |session| {
        if !session.provider.capabilities().has_plan {
            return Ok(None);
        }
        let plan = if session.locator.source == SessionSource::Copilot {
            Some(PlanArtifact::File(
                session.locator.primary_path.join("plan.md"),
            ))
        } else {
            session_artifacts(&session)?.plan.clone()
        };
        let Some(mut content) = plan.map(|plan| plan.read()).transpose()?.flatten() else {
            return Ok(None);
        };
        tracepilot_core::utils::truncate_string_utf8(&mut content, MAX_CHECKPOINT_CONTENT_BYTES);

        Ok(Some(serde_json::json!({ "content": content })))
    })
    .await
}

/// Subagents and shells the session ran in the background. Empty for a
/// source that does not record them.
#[tauri::command]
#[specta::specta]
#[tracing::instrument(skip_all, level = "debug", err)]
pub async fn get_session_background_tasks(
    state: tauri::State<'_, SharedConfig>,
    session_id: String,
) -> CmdResult<Vec<tracepilot_core::provider::BackgroundTask>> {
    let sid = crate::validators::validate_session_id(&session_id)?;
    with_session_locator(&state, sid, |session| {
        if !session.provider.capabilities().has_background_tasks {
            return Ok(Vec::new());
        }
        Ok(session_artifacts(&session)?.background_tasks.clone())
    })
    .await
}

/// The points the session's changed files can be seen at, oldest first.
/// Empty for a source that keeps no file history. Backups are not read.
#[tauri::command]
#[specta::specta]
#[tracing::instrument(skip_all, level = "debug", err)]
pub async fn get_session_file_history(
    state: tauri::State<'_, SharedConfig>,
    session_id: String,
) -> CmdResult<Vec<FileCheckpoint>> {
    let sid = crate::validators::validate_session_id(&session_id)?;
    with_session_locator(&state, sid, |session| {
        if !session.provider.capabilities().has_file_history {
            return Ok(Vec::new());
        }
        Ok(session_artifacts(&session)?
            .file_history
            .as_ref()
            .map(|history| history.checkpoints.clone())
            .unwrap_or_default())
    })
    .await
}

/// One backed-up file version, read on request. Only a backup the
/// session's own file history names is read, from inside its backup
/// directory. Read-only: nothing is ever restored.
#[tauri::command]
#[specta::specta]
#[tracing::instrument(skip_all, level = "debug", err)]
pub async fn get_session_file_version(
    state: tauri::State<'_, SharedConfig>,
    session_id: String,
    backup: String,
) -> CmdResult<FileVersionContent> {
    let sid = crate::validators::validate_session_id(&session_id)?;
    if !is_safe_backup_name(&backup) {
        return Err(BindingsError::Validation(
            "Invalid file version name".into(),
        ));
    }
    with_session_locator(&state, sid, move |session| {
        crate::helpers::require_capability(
            &session,
            |caps| caps.has_file_history,
            "Reading file history",
        )?;
        session
            .provider
            .file_history(&session.locator)?
            .map(|history| history.read_version(&backup, MAX_FILE_VERSION_BYTES))
            .transpose()?
            .flatten()
            .ok_or_else(|| BindingsError::Validation("This file version is not available".into()))
    })
    .await
}
