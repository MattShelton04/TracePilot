use crate::config::{SharedConfig, TracePilotConfig};
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
        .map_err(|_| BindingsError::Internal("Configuration lock is poisoned.".into()))?
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

fn resolve_session(config: &TracePilotConfig, session_id: &str) -> CmdResult<std::path::PathBuf> {
    let validated = uuid::Uuid::parse_str(session_id)?.to_string();
    Ok(
        tracepilot_core::session::discovery::resolve_session_path_direct(
            &validated,
            &config.session_state_dir(),
        )?,
    )
}

#[tauri::command]
#[tracing::instrument(skip(state), err, fields(%session_id))]
pub async fn context_capture_preflight(
    session_id: String,
    state: tauri::State<'_, SharedConfig>,
) -> CmdResult<CapturePreflight> {
    let config = capture_config(&state)?;
    let path = resolve_session(&config, &session_id)?;
    let tracepilot_home = config.tracepilot_home();
    let cli = config.general.cli_command;
    Ok(tokio::task::spawn_blocking(move || {
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
    manager: tauri::State<'_, ContextCaptureManager>,
    app: tauri::AppHandle,
) -> CmdResult<ContextCaptureSnapshot> {
    let config = capture_config(&state)?;
    let session_path = resolve_session(&config, &request.session_id)?;
    let tracepilot_home = config.tracepilot_home();
    let cli_command = config.general.cli_command;
    let progress = Arc::new(move |payload| {
        if let Err(error) = app.emit(CONTEXT_CAPTURE_PROGRESS, payload) {
            tracing::warn!(error = %error, "Failed to emit context capture progress metadata");
        }
    });
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
) -> CmdResult<Vec<ContextCaptureSummary>> {
    let config = capture_config(&state)?;
    let home = config.tracepilot_home();
    Ok(tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::context_capture::list_captures(&home, &session_id)
    })
    .await??)
}

#[tauri::command]
pub async fn context_capture_get(
    session_id: String,
    capture_id: String,
    state: tauri::State<'_, SharedConfig>,
) -> CmdResult<ContextCaptureSnapshot> {
    let config = capture_config(&state)?;
    let home = config.tracepilot_home();
    Ok(tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::context_capture::get_capture(&home, &session_id, &capture_id)
    })
    .await??)
}

#[tauri::command]
pub async fn context_capture_delete(
    session_id: String,
    capture_id: String,
    state: tauri::State<'_, SharedConfig>,
) -> CmdResult<()> {
    let config = capture_config(&state)?;
    let home = config.tracepilot_home();
    Ok(tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::context_capture::delete_capture(&home, &session_id, &capture_id)
    })
    .await??)
}

#[tauri::command]
pub async fn context_capture_delete_all(state: tauri::State<'_, SharedConfig>) -> CmdResult<u64> {
    let config = loaded_config(&state)?;
    let home = config.tracepilot_home();
    Ok(tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::context_capture::delete_all_captures(&home)
    })
    .await??)
}

#[tauri::command]
pub async fn context_capture_storage_stats(
    state: tauri::State<'_, SharedConfig>,
) -> CmdResult<ContextCaptureStorageStats> {
    let config = loaded_config(&state)?;
    let home = config.tracepilot_home();
    Ok(tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::context_capture::storage_stats(&home)
    })
    .await??)
}

#[tauri::command]
pub async fn context_benchmark_preflight(
    state: tauri::State<'_, SharedConfig>,
) -> CmdResult<BenchmarkPreflight> {
    let config = capture_config(&state)?;
    let home = config.tracepilot_home();
    let cli = config.general.cli_command;
    Ok(tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::context_capture::benchmark_preflight(&cli, &home)
    })
    .await??)
}

#[tauri::command]
#[tracing::instrument(skip_all, err, fields(profile = ?request.profile))]
pub async fn context_benchmark_start(
    request: StartBenchmarkCaptureRequest,
    state: tauri::State<'_, SharedConfig>,
    manager: tauri::State<'_, ContextCaptureManager>,
    app: tauri::AppHandle,
) -> CmdResult<ContextCaptureSnapshot> {
    let config = capture_config(&state)?;
    let tracepilot_home = config.tracepilot_home();
    let copilot_home = config.copilot_home();
    let cli_command = config.general.cli_command;
    let progress = Arc::new(move |payload| {
        if let Err(error) = app.emit(CONTEXT_CAPTURE_PROGRESS, payload) {
            tracing::warn!(error = %error, "Failed to emit context benchmark progress metadata");
        }
    });
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
) -> CmdResult<Vec<ContextCaptureSummary>> {
    let config = capture_config(&state)?;
    let home = config.tracepilot_home();
    Ok(tokio::task::spawn_blocking(move || {
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
) -> CmdResult<ContextCaptureSnapshot> {
    let config = capture_config(&state)?;
    let home = config.tracepilot_home();
    Ok(tokio::task::spawn_blocking(move || {
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
) -> CmdResult<()> {
    let config = capture_config(&state)?;
    let home = config.tracepilot_home();
    Ok(tokio::task::spawn_blocking(move || {
        tracepilot_orchestrator::context_capture::delete_capture(
            &home,
            BENCHMARK_CAPTURE_COLLECTION_ID,
            &capture_id,
        )
    })
    .await??)
}
