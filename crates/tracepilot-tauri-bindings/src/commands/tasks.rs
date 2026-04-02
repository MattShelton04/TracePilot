//! Tauri IPC commands for the AI agent task system.
//!
//! Commands for task CRUD, orchestrator lifecycle, health monitoring,
//! and result ingestion.

use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::{get_or_init_task_db, read_config};
use crate::types::SharedTaskDb;
use tracepilot_orchestrator::task_db::types::*;

// ─── Task CRUD ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn task_create(
    state: tauri::State<'_, SharedTaskDb>,
    task_type: String,
    preset_id: String,
    input_params: serde_json::Value,
    priority: Option<String>,
    max_retries: Option<i32>,
) -> CmdResult<Task> {
    let db = get_or_init_task_db(&state)?;
    tokio::task::spawn_blocking(move || {
        let guard = db.lock().map_err(|_| BindingsError::Validation("mutex poisoned".into()))?;
        let db = guard.as_ref().ok_or_else(|| BindingsError::Validation("TaskDb not init".into()))?;
        let new_task = NewTask {
            task_type,
            preset_id,
            priority,
            input_params,
            max_retries,
        };
        tracepilot_orchestrator::task_db::operations::create_task(db.conn(), &new_task)
            .map_err(BindingsError::Orchestrator)
    })
    .await?
}

#[tauri::command]
pub async fn task_create_batch(
    state: tauri::State<'_, SharedTaskDb>,
    tasks: Vec<NewTask>,
    job_name: String,
    preset_id: Option<String>,
) -> CmdResult<Job> {
    let db = get_or_init_task_db(&state)?;
    tokio::task::spawn_blocking(move || {
        let guard = db.lock().map_err(|_| BindingsError::Validation("mutex poisoned".into()))?;
        let db = guard.as_ref().ok_or_else(|| BindingsError::Validation("TaskDb not init".into()))?;
        tracepilot_orchestrator::task_db::operations::create_task_batch(
            db.conn(),
            &tasks,
            &job_name,
            preset_id.as_deref(),
        )
        .map_err(BindingsError::Orchestrator)
    })
    .await?
}

#[tauri::command]
pub async fn task_get(
    state: tauri::State<'_, SharedTaskDb>,
    id: String,
) -> CmdResult<Task> {
    let db = get_or_init_task_db(&state)?;
    tokio::task::spawn_blocking(move || {
        let guard = db.lock().map_err(|_| BindingsError::Validation("mutex poisoned".into()))?;
        let db = guard.as_ref().ok_or_else(|| BindingsError::Validation("TaskDb not init".into()))?;
        tracepilot_orchestrator::task_db::operations::get_task(db.conn(), &id)
            .map_err(BindingsError::Orchestrator)
    })
    .await?
}

#[tauri::command]
pub async fn task_list(
    state: tauri::State<'_, SharedTaskDb>,
    filter: Option<TaskFilter>,
) -> CmdResult<Vec<Task>> {
    let db = get_or_init_task_db(&state)?;
    let f = filter.unwrap_or_default();
    tokio::task::spawn_blocking(move || {
        let guard = db.lock().map_err(|_| BindingsError::Validation("mutex poisoned".into()))?;
        let db = guard.as_ref().ok_or_else(|| BindingsError::Validation("TaskDb not init".into()))?;
        tracepilot_orchestrator::task_db::operations::list_tasks(db.conn(), &f)
            .map_err(BindingsError::Orchestrator)
    })
    .await?
}

#[tauri::command]
pub async fn task_cancel(
    state: tauri::State<'_, SharedTaskDb>,
    id: String,
) -> CmdResult<()> {
    let db = get_or_init_task_db(&state)?;
    tokio::task::spawn_blocking(move || {
        let guard = db.lock().map_err(|_| BindingsError::Validation("mutex poisoned".into()))?;
        let db = guard.as_ref().ok_or_else(|| BindingsError::Validation("TaskDb not init".into()))?;
        tracepilot_orchestrator::task_db::operations::cancel_task(db.conn(), &id)
            .map_err(BindingsError::Orchestrator)
    })
    .await?
}

#[tauri::command]
pub async fn task_retry(
    state: tauri::State<'_, SharedTaskDb>,
    id: String,
) -> CmdResult<()> {
    let db = get_or_init_task_db(&state)?;
    tokio::task::spawn_blocking(move || {
        let guard = db.lock().map_err(|_| BindingsError::Validation("mutex poisoned".into()))?;
        let db = guard.as_ref().ok_or_else(|| BindingsError::Validation("TaskDb not init".into()))?;
        tracepilot_orchestrator::task_db::operations::retry_task(db.conn(), &id)
            .map_err(BindingsError::Orchestrator)
    })
    .await?
}

#[tauri::command]
pub async fn task_delete(
    state: tauri::State<'_, SharedTaskDb>,
    id: String,
) -> CmdResult<()> {
    let db = get_or_init_task_db(&state)?;
    tokio::task::spawn_blocking(move || {
        let guard = db.lock().map_err(|_| BindingsError::Validation("mutex poisoned".into()))?;
        let db = guard.as_ref().ok_or_else(|| BindingsError::Validation("TaskDb not init".into()))?;
        tracepilot_orchestrator::task_db::operations::delete_task(db.conn(), &id)
            .map_err(BindingsError::Orchestrator)
    })
    .await?
}

#[tauri::command]
pub async fn task_stats(
    state: tauri::State<'_, SharedTaskDb>,
) -> CmdResult<TaskStats> {
    let db = get_or_init_task_db(&state)?;
    tokio::task::spawn_blocking(move || {
        let guard = db.lock().map_err(|_| BindingsError::Validation("mutex poisoned".into()))?;
        let db = guard.as_ref().ok_or_else(|| BindingsError::Validation("TaskDb not init".into()))?;
        tracepilot_orchestrator::task_db::operations::get_task_stats(db.conn())
            .map_err(BindingsError::Orchestrator)
    })
    .await?
}

// ─── Jobs ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn task_list_jobs(
    state: tauri::State<'_, SharedTaskDb>,
    limit: Option<i64>,
) -> CmdResult<Vec<Job>> {
    let db = get_or_init_task_db(&state)?;
    tokio::task::spawn_blocking(move || {
        let guard = db.lock().map_err(|_| BindingsError::Validation("mutex poisoned".into()))?;
        let db = guard.as_ref().ok_or_else(|| BindingsError::Validation("TaskDb not init".into()))?;
        tracepilot_orchestrator::task_db::operations::list_jobs(db.conn(), limit)
            .map_err(BindingsError::Orchestrator)
    })
    .await?
}

#[tauri::command]
pub async fn task_cancel_job(
    state: tauri::State<'_, SharedTaskDb>,
    job_id: String,
) -> CmdResult<()> {
    let db = get_or_init_task_db(&state)?;
    tokio::task::spawn_blocking(move || {
        let guard = db.lock().map_err(|_| BindingsError::Validation("mutex poisoned".into()))?;
        let db = guard.as_ref().ok_or_else(|| BindingsError::Validation("TaskDb not init".into()))?;
        tracepilot_orchestrator::task_db::operations::cancel_job(db.conn(), &job_id)
            .map_err(BindingsError::Orchestrator)
    })
    .await?
}

// ─── Presets ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn task_list_presets(
    config: tauri::State<'_, SharedConfig>,
) -> CmdResult<Vec<tracepilot_orchestrator::presets::types::TaskPreset>> {
    let cfg = read_config(&config);
    let presets_dir = cfg.presets_dir();
    tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::presets::io::list_presets(&presets_dir)
            .map_err(BindingsError::Orchestrator)
    })
    .await?
}

#[tauri::command]
pub async fn task_get_preset(
    config: tauri::State<'_, SharedConfig>,
    id: String,
) -> CmdResult<tracepilot_orchestrator::presets::types::TaskPreset> {
    let cfg = read_config(&config);
    let presets_dir = cfg.presets_dir();
    tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::presets::io::get_preset(&presets_dir, &id)
            .map_err(BindingsError::Orchestrator)
    })
    .await?
}

#[tauri::command]
pub async fn task_save_preset(
    config: tauri::State<'_, SharedConfig>,
    preset: tracepilot_orchestrator::presets::types::TaskPreset,
) -> CmdResult<()> {
    let cfg = read_config(&config);
    let presets_dir = cfg.presets_dir();
    tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::presets::io::save_preset(&presets_dir, &preset)
            .map_err(BindingsError::Orchestrator)
    })
    .await?
}

#[tauri::command]
pub async fn task_delete_preset(
    config: tauri::State<'_, SharedConfig>,
    id: String,
) -> CmdResult<()> {
    let cfg = read_config(&config);
    let presets_dir = cfg.presets_dir();
    tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::presets::io::delete_preset(&presets_dir, &id)
            .map_err(BindingsError::Orchestrator)
    })
    .await?
}

// ─── Orchestrator Lifecycle ─────────────────────────────────────────

#[tauri::command]
pub async fn task_orchestrator_health(
    config: tauri::State<'_, SharedConfig>,
) -> CmdResult<tracepilot_orchestrator::task_recovery::HealthCheckResult> {
    let cfg = read_config(&config);
    let jobs_dir = cfg.jobs_dir();
    tokio::task::spawn_blocking(move || {
        let result =
            tracepilot_orchestrator::task_recovery::check_orchestrator_health(&jobs_dir, None, None);
        Ok(result)
    })
    .await?
}

// ─── Attribution ────────────────────────────────────────────────────

#[tauri::command]
pub async fn task_attribution(
    session_path: String,
) -> CmdResult<tracepilot_orchestrator::task_attribution::AttributionSnapshot> {
    let path = std::path::PathBuf::from(session_path);
    tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::task_attribution::build_attribution_from_session(&path)
            .map_err(BindingsError::Orchestrator)
    })
    .await?
}
