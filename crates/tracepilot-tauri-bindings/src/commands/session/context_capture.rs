use crate::config::{ConfigCoordinator, SharedConfig, TracePilotConfig};
use crate::error::{BindingsError, CmdResult};
use crate::events::CONTEXT_CAPTURE_PROGRESS;
use std::sync::Arc;
use tauri::Emitter;
use tracepilot_core::context_capture::{
    ContextCaptureSnapshot, ContextCaptureStorageStats, ContextCaptureSummary,
};
use tracepilot_orchestrator::context_capture::{
    BENCHMARK_CAPTURE_COLLECTION_ID, BenchmarkPreflight, CapturePreflight, ContextCaptureManager,
    StartBenchmarkCaptureRequest, StartCaptureRequest,
};

fn loaded_config(state: &SharedConfig) -> CmdResult<TracePilotConfig> {
    let config = state
        .read()
        .map_err(|_poisoned| BindingsError::Internal("Configuration lock is poisoned.".into()))?
        .clone()
        .ok_or_else(|| BindingsError::Validation("TracePilot is not configured.".into()))?;
    Ok(config)
}

fn capture_config(state: &SharedConfig) -> CmdResult<TracePilotConfig> {
    let config = loaded_config(state)?;
    if !config.features.exact_context_capture {
        return Err(BindingsError::Validation(
            "Exact context capture is experimental and must be enabled in Settings first.".into(),
        ));
    }
    Ok(config)
}

/// Capture resumes the session in its CLI, so only resumable sources can.
fn resolve_session(config: &TracePilotConfig, session_id: &str) -> CmdResult<std::path::PathBuf> {
    let validated = crate::validators::validate_session_id(session_id)?;
    let session = crate::helpers::resolve_session(config, &validated)?;
    crate::helpers::require_capability(&session, |caps| caps.can_resume, "Context capture")?;
    Ok(session.locator.primary_path)
}

#[tauri::command]
#[tracing::instrument(skip(state, coordinator), err, fields(%session_id))]
pub async fn context_capture_preflight(
    session_id: String,
    state: tauri::State<'_, SharedConfig>,
    coordinator: tauri::State<'_, ConfigCoordinator>,
) -> CmdResult<CapturePreflight> {
    let root_lease = coordinator.root_read().await;
    let config = capture_config(&state)?;
    let path = resolve_session(&config, &session_id)?;
    let tracepilot_home = config.tracepilot_home();
    let cli = config.general.cli_command;
    Ok(tokio::task::spawn_blocking(move || {
        let _root_lease = root_lease;
        tracepilot_orchestrator::context_capture::context_capture_preflight(
            &session_id,
            &path,
            &cli,
            &tracepilot_home,
        )
    })
    .await??)
}

#[tauri::command]
#[tracing::instrument(skip_all, err, fields(session_id = %request.session_id))]
pub async fn context_capture_start(
    request: StartCaptureRequest,
    state: tauri::State<'_, SharedConfig>,
    coordinator: tauri::State<'_, ConfigCoordinator>,
    manager: tauri::State<'_, ContextCaptureManager>,
    app: tauri::AppHandle,
) -> CmdResult<ContextCaptureSnapshot> {
    let root_lease = coordinator.root_read().await;
    let config = capture_config(&state)?;
    let session_path = resolve_session(&config, &request.session_id)?;
    let tracepilot_home = config.tracepilot_home();
    let cli_command = config.general.cli_command;
    let progress = Arc::new(move |payload| {
        if let Err(error) = app.emit(CONTEXT_CAPTURE_PROGRESS, payload) {
            tracing::warn!(error = %error, "Failed to emit context capture progress metadata");
        }
    });
    let _root_lease = root_lease;
    Ok(manager
        .start(
            request,
            session_path,
            cli_command,
            tracepilot_home,
            progress,
        )
        .await?)
}

#[tauri::command]
pub async fn context_capture_cancel(
    capture_id: Option<String>,
    manager: tauri::State<'_, ContextCaptureManager>,
) -> CmdResult<bool> {
    Ok(manager.cancel(capture_id.as_deref()).await)
}

#[tauri::command]
pub async fn context_capture_list(
    session_id: String,
    state: tauri::State<'_, SharedConfig>,
    coordinator: tauri::State<'_, ConfigCoordinator>,
) -> CmdResult<Vec<ContextCaptureSummary>> {
    let root_lease = coordinator.root_read().await;
    let config = capture_config(&state)?;
    let home = config.tracepilot_home();
    Ok(tokio::task::spawn_blocking(move || {
        let _root_lease = root_lease;
        tracepilot_orchestrator::context_capture::list_captures(&home, &session_id)
    })
    .await??)
}

#[tauri::command]
pub async fn context_capture_get(
    session_id: String,
    capture_id: String,
    state: tauri::State<'_, SharedConfig>,
    coordinator: tauri::State<'_, ConfigCoordinator>,
) -> CmdResult<ContextCaptureSnapshot> {
    let root_lease = coordinator.root_read().await;
    let config = capture_config(&state)?;
    let home = config.tracepilot_home();
    Ok(tokio::task::spawn_blocking(move || {
        let _root_lease = root_lease;
        tracepilot_orchestrator::context_capture::get_capture(&home, &session_id, &capture_id)
    })
    .await??)
}

#[tauri::command]
pub async fn context_capture_delete(
    session_id: String,
    capture_id: String,
    state: tauri::State<'_, SharedConfig>,
    coordinator: tauri::State<'_, ConfigCoordinator>,
) -> CmdResult<()> {
    let root_lease = coordinator.root_read().await;
    let config = capture_config(&state)?;
    let home = config.tracepilot_home();
    Ok(tokio::task::spawn_blocking(move || {
        let _root_lease = root_lease;
        tracepilot_orchestrator::context_capture::delete_capture(&home, &session_id, &capture_id)
    })
    .await??)
}

#[tauri::command]
pub async fn context_capture_delete_all(
    state: tauri::State<'_, SharedConfig>,
    coordinator: tauri::State<'_, ConfigCoordinator>,
) -> CmdResult<u64> {
    let root_lease = coordinator.root_read().await;
    let config = loaded_config(&state)?;
    let home = config.tracepilot_home();
    Ok(tokio::task::spawn_blocking(move || {
        let _root_lease = root_lease;
        tracepilot_orchestrator::context_capture::delete_all_captures(&home)
    })
    .await??)
}

#[tauri::command]
pub async fn context_capture_storage_stats(
    state: tauri::State<'_, SharedConfig>,
    coordinator: tauri::State<'_, ConfigCoordinator>,
) -> CmdResult<ContextCaptureStorageStats> {
    let root_lease = coordinator.root_read().await;
    let config = loaded_config(&state)?;
    let home = config.tracepilot_home();
    Ok(tokio::task::spawn_blocking(move || {
        let _root_lease = root_lease;
        tracepilot_orchestrator::context_capture::storage_stats(&home)
    })
    .await??)
}

#[tauri::command]
pub async fn context_benchmark_preflight(
    state: tauri::State<'_, SharedConfig>,
    coordinator: tauri::State<'_, ConfigCoordinator>,
) -> CmdResult<BenchmarkPreflight> {
    let root_lease = coordinator.root_read().await;
    let config = capture_config(&state)?;
    let home = config.tracepilot_home();
    let cli = config.general.cli_command;
    Ok(tokio::task::spawn_blocking(move || {
        let _root_lease = root_lease;
        tracepilot_orchestrator::context_capture::benchmark_preflight(&cli, &home)
    })
    .await??)
}

#[tauri::command]
#[tracing::instrument(skip_all, err, fields(profile = ?request.profile))]
pub async fn context_benchmark_start(
    request: StartBenchmarkCaptureRequest,
    state: tauri::State<'_, SharedConfig>,
    coordinator: tauri::State<'_, ConfigCoordinator>,
    manager: tauri::State<'_, ContextCaptureManager>,
    app: tauri::AppHandle,
) -> CmdResult<ContextCaptureSnapshot> {
    let root_lease = coordinator.root_read().await;
    let config = capture_config(&state)?;
    let tracepilot_home = config.tracepilot_home();
    let copilot_home = config.copilot_home();
    let cli_command = config.general.cli_command;
    let progress = Arc::new(move |payload| {
        if let Err(error) = app.emit(CONTEXT_CAPTURE_PROGRESS, payload) {
            tracing::warn!(error = %error, "Failed to emit context benchmark progress metadata");
        }
    });
    let _root_lease = root_lease;
    Ok(manager
        .start_benchmark(
            request,
            cli_command,
            copilot_home,
            tracepilot_home,
            progress,
        )
        .await?)
}

#[tauri::command]
pub async fn context_benchmark_list(
    state: tauri::State<'_, SharedConfig>,
    coordinator: tauri::State<'_, ConfigCoordinator>,
) -> CmdResult<Vec<ContextCaptureSummary>> {
    let root_lease = coordinator.root_read().await;
    let config = capture_config(&state)?;
    let home = config.tracepilot_home();
    Ok(tokio::task::spawn_blocking(move || {
        let _root_lease = root_lease;
        tracepilot_orchestrator::context_capture::list_captures(
            &home,
            BENCHMARK_CAPTURE_COLLECTION_ID,
        )
    })
    .await??)
}

#[tauri::command]
pub async fn context_benchmark_get(
    capture_id: String,
    state: tauri::State<'_, SharedConfig>,
    coordinator: tauri::State<'_, ConfigCoordinator>,
) -> CmdResult<ContextCaptureSnapshot> {
    let root_lease = coordinator.root_read().await;
    let config = capture_config(&state)?;
    let home = config.tracepilot_home();
    Ok(tokio::task::spawn_blocking(move || {
        let _root_lease = root_lease;
        tracepilot_orchestrator::context_capture::get_capture(
            &home,
            BENCHMARK_CAPTURE_COLLECTION_ID,
            &capture_id,
        )
    })
    .await??)
}

#[tauri::command]
pub async fn context_benchmark_delete(
    capture_id: String,
    state: tauri::State<'_, SharedConfig>,
    coordinator: tauri::State<'_, ConfigCoordinator>,
) -> CmdResult<()> {
    let root_lease = coordinator.root_read().await;
    let config = capture_config(&state)?;
    let home = config.tracepilot_home();
    Ok(tokio::task::spawn_blocking(move || {
        let _root_lease = root_lease;
        tracepilot_orchestrator::context_capture::delete_capture(
            &home,
            BENCHMARK_CAPTURE_COLLECTION_ID,
            &capture_id,
        )
    })
    .await??)
}
