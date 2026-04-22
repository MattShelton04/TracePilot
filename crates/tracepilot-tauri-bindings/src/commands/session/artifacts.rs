//! Session artifact commands: todos, checkpoints, plan.

use crate::config::SharedConfig;
use crate::error::CmdResult;
use crate::helpers::{MAX_CHECKPOINT_CONTENT_BYTES, with_session_path};
use crate::types::TodosResponse;

#[tauri::command]
#[tracing::instrument(skip_all, level = "debug", err, fields(session_id = %session_id))]
pub async fn get_session_todos(
    state: tauri::State<'_, SharedConfig>,
    session_id: String,
) -> CmdResult<TodosResponse> {
    let sid = crate::validators::validate_session_id(&session_id)?;
    with_session_path(&state, sid, |path| {
        let db_path = path.join("session.db");
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
    with_session_path(&state, sid, |path| {
        let mut checkpoints = tracepilot_core::parsing::checkpoints::parse_checkpoints(&path)?
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
    with_session_path(&state, sid, |path| {
        let plan_path = path.join("plan.md");
        if !plan_path.exists() {
            return Ok(None);
        }

        let mut content = std::fs::read_to_string(&plan_path)?;
        tracepilot_core::utils::truncate_string_utf8(&mut content, MAX_CHECKPOINT_CONTENT_BYTES);

        Ok(Some(serde_json::json!({ "content": content })))
    })
    .await
}
