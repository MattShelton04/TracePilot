//! Session annotation commands: stars, archive flags, tags and notes.
//!
//! Annotations live in TracePilot's own `annotations.db`; the agent's
//! session files are never read or written here.

use crate::blocking_cmd;
use crate::config::{ConfigCoordinator, SharedConfig};
use crate::error::{BindingsError, CmdResult};
use crate::helpers::{emit_best_effort, read_config};
use crate::validators::validate_session_id;
use tracepilot_core::annotations::{
    AnnotationStore, SessionAnnotation, SessionAnnotationPatch, list_annotations_if_exists,
};

/// Every annotated session. Sessions with no annotation are omitted.
#[tauri::command]
#[specta::specta]
#[tracing::instrument(skip_all, level = "debug", err)]
pub async fn list_session_annotations(
    state: tauri::State<'_, SharedConfig>,
    coordinator: tauri::State<'_, ConfigCoordinator>,
) -> CmdResult<Vec<SessionAnnotation>> {
    let root_lease = coordinator.root_read().await;
    let path = read_config(&state).annotations_db_path();
    blocking_cmd!({
        let _root_lease = root_lease;
        list_annotations_if_exists(&path)
    })
}

/// Apply a partial update to one session's annotation and return the result.
#[tauri::command]
#[specta::specta]
#[tracing::instrument(skip(state, coordinator, app, patch), err)]
pub async fn update_session_annotation(
    state: tauri::State<'_, SharedConfig>,
    coordinator: tauri::State<'_, ConfigCoordinator>,
    app: tauri::AppHandle,
    session_id: String,
    patch: SessionAnnotationPatch,
) -> CmdResult<SessionAnnotation> {
    validate_session_id(&session_id)?;
    let patch = patch
        .normalized()
        .map_err(|e| BindingsError::Validation(e.to_string()))?;
    let root_lease = coordinator.root_read().await;
    let path = read_config(&state).annotations_db_path();
    let updated: CmdResult<SessionAnnotation> = blocking_cmd!({
        let _root_lease = root_lease;
        AnnotationStore::open_or_create(&path)?.update(&session_id, &patch)
    });
    let updated = updated?;
    emit_best_effort(
        &app,
        crate::events::SESSION_ANNOTATION_CHANGED,
        updated.clone(),
    );
    Ok(updated)
}
