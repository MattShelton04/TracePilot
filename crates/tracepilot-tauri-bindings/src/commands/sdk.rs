//! Copilot SDK bridge Tauri commands (feature-gated).
//!
//! These commands expose the BridgeManager to the frontend for:
//!   - Connecting/disconnecting the SDK bridge
//!   - Creating and managing SDK sessions
//!   - Sending messages (steering)
//!   - Querying quota, auth status, and models

use crate::error::CmdResult;
use tracepilot_orchestrator::bridge::manager::{BridgeMetricsSnapshot, SharedBridgeManager};
use tracepilot_orchestrator::bridge::{
    BridgeAuthStatus, BridgeConnectConfig, BridgeMessagePayload, BridgeModelInfo, BridgeQuota,
    BridgeSessionConfig, BridgeSessionInfo, BridgeSessionMode, BridgeStatus, DetectedUiServer,
};

// ─── Connection Lifecycle ─────────────────────────────────────────

#[tauri::command]
#[tracing::instrument(skip(bridge, config), err)]
pub async fn sdk_connect(
    bridge: tauri::State<'_, SharedBridgeManager>,
    config: BridgeConnectConfig,
) -> CmdResult<BridgeStatus> {
    let mut mgr = bridge.write().await;
    mgr.connect(config).await?;
    Ok(mgr.status())
}

#[tauri::command]
#[tracing::instrument(skip(bridge), err)]
pub async fn sdk_disconnect(
    bridge: tauri::State<'_, SharedBridgeManager>,
) -> CmdResult<BridgeStatus> {
    let mut mgr = bridge.write().await;
    mgr.disconnect().await?;
    Ok(mgr.status())
}

#[tauri::command]
pub async fn sdk_status(bridge: tauri::State<'_, SharedBridgeManager>) -> CmdResult<BridgeStatus> {
    let mgr = bridge.read().await;
    Ok(mgr.status())
}

#[tauri::command]
#[tracing::instrument(skip(bridge), level = "debug", err)]
pub async fn sdk_cli_status(
    bridge: tauri::State<'_, SharedBridgeManager>,
) -> CmdResult<BridgeStatus> {
    let mgr = bridge.read().await;
    mgr.get_cli_status().await.map_err(Into::into)
}

// ─── Session Management ───────────────────────────────────────────

#[tauri::command]
#[tracing::instrument(skip(bridge, config), err)]
pub async fn sdk_create_session(
    bridge: tauri::State<'_, SharedBridgeManager>,
    config: BridgeSessionConfig,
) -> CmdResult<BridgeSessionInfo> {
    let mut mgr = bridge.write().await;
    mgr.create_session(config).await.map_err(Into::into)
}

#[tauri::command]
#[tracing::instrument(skip(bridge, working_directory), err, fields(%session_id, model = model.as_deref().unwrap_or("")))]
pub async fn sdk_resume_session(
    bridge: tauri::State<'_, SharedBridgeManager>,
    session_id: String,
    working_directory: Option<String>,
    model: Option<String>,
) -> CmdResult<BridgeSessionInfo> {
    let mut mgr = bridge.write().await;
    mgr.resume_session(&session_id, working_directory.as_deref(), model.as_deref())
        .await
        .map_err(Into::into)
}

#[tauri::command]
#[tracing::instrument(skip(bridge, payload), err, fields(%session_id))]
pub async fn sdk_send_message(
    bridge: tauri::State<'_, SharedBridgeManager>,
    session_id: String,
    payload: BridgeMessagePayload,
) -> CmdResult<String> {
    let mgr = bridge.read().await;
    mgr.send_message(&session_id, payload)
        .await
        .map_err(Into::into)
}

#[tauri::command]
#[tracing::instrument(skip(bridge), err, fields(%session_id))]
pub async fn sdk_abort_session(
    bridge: tauri::State<'_, SharedBridgeManager>,
    session_id: String,
) -> CmdResult<()> {
    let mgr = bridge.read().await;
    mgr.abort_session(&session_id).await.map_err(Into::into)
}

#[tauri::command]
#[tracing::instrument(skip(bridge), err, fields(%session_id))]
pub async fn sdk_destroy_session(
    bridge: tauri::State<'_, SharedBridgeManager>,
    session_id: String,
) -> CmdResult<()> {
    let mut mgr = bridge.write().await;
    mgr.destroy_session(&session_id).await.map_err(Into::into)
}

#[tauri::command]
#[tracing::instrument(skip(bridge), level = "debug", err, fields(%session_id))]
pub async fn sdk_unlink_session(
    bridge: tauri::State<'_, SharedBridgeManager>,
    session_id: String,
) -> CmdResult<()> {
    let mut mgr = bridge.write().await;
    mgr.unlink_session(&session_id);
    Ok(())
}

#[tauri::command]
#[tracing::instrument(skip(bridge, mode), err, fields(%session_id))]
pub async fn sdk_set_session_mode(
    bridge: tauri::State<'_, SharedBridgeManager>,
    session_id: String,
    mode: BridgeSessionMode,
) -> CmdResult<()> {
    let mgr = bridge.read().await;
    mgr.set_session_mode(&session_id, mode)
        .await
        .map_err(Into::into)
}

#[tauri::command]
#[tracing::instrument(skip(bridge), err, fields(%session_id, %model))]
pub async fn sdk_set_session_model(
    bridge: tauri::State<'_, SharedBridgeManager>,
    session_id: String,
    model: String,
    reasoning_effort: Option<String>,
) -> CmdResult<()> {
    let mgr = bridge.read().await;
    mgr.set_session_model(&session_id, &model, reasoning_effort)
        .await
        .map_err(Into::into)
}

// ─── Query Operations ─────────────────────────────────────────────

#[tauri::command]
pub async fn sdk_list_sessions(
    bridge: tauri::State<'_, SharedBridgeManager>,
) -> CmdResult<Vec<BridgeSessionInfo>> {
    let mgr = bridge.read().await;
    mgr.list_sessions().await.map_err(Into::into)
}

#[tauri::command]
pub async fn sdk_get_quota(
    bridge: tauri::State<'_, SharedBridgeManager>,
) -> CmdResult<BridgeQuota> {
    let mgr = bridge.read().await;
    mgr.get_quota().await.map_err(Into::into)
}

#[tauri::command]
pub async fn sdk_get_auth_status(
    bridge: tauri::State<'_, SharedBridgeManager>,
) -> CmdResult<BridgeAuthStatus> {
    let mgr = bridge.read().await;
    mgr.get_auth_status().await.map_err(Into::into)
}

#[tauri::command]
pub async fn sdk_list_models(
    bridge: tauri::State<'_, SharedBridgeManager>,
) -> CmdResult<Vec<BridgeModelInfo>> {
    let mgr = bridge.read().await;
    mgr.list_models().await.map_err(Into::into)
}

// ─── Foreground Session (--ui-server mode) ────────────────────────

#[tauri::command]
pub async fn sdk_get_foreground_session(
    bridge: tauri::State<'_, SharedBridgeManager>,
) -> CmdResult<Option<String>> {
    let mgr = bridge.read().await;
    mgr.get_foreground_session().await.map_err(Into::into)
}

#[tauri::command]
#[tracing::instrument(skip(bridge), level = "debug", err, fields(%session_id))]
pub async fn sdk_set_foreground_session(
    bridge: tauri::State<'_, SharedBridgeManager>,
    session_id: String,
) -> CmdResult<()> {
    let mgr = bridge.read().await;
    mgr.set_foreground_session(&session_id)
        .await
        .map_err(Into::into)
}

// ─── UI Server Detection ──────────────────────────────────────────

#[tauri::command]
#[tracing::instrument(err)]
pub async fn sdk_detect_ui_server() -> CmdResult<Vec<DetectedUiServer>> {
    let servers = tracepilot_orchestrator::bridge::detect_ui_servers().await;
    Ok(servers)
}

#[tauri::command]
#[tracing::instrument(skip(working_dir), err, fields(has_working_dir = working_dir.is_some()))]
pub async fn sdk_launch_ui_server(working_dir: Option<String>) -> CmdResult<u32> {
    let pid = tracepilot_orchestrator::bridge::manager::launch_ui_server(working_dir.as_deref())?;
    Ok(pid)
}

// ─── Observability ────────────────────────────────────────────────

/// Point-in-time counters for the bridge broadcast channels.
///
/// Cheap (atomic loads only, no lock on the manager). Exposed for debug
/// panels + ad-hoc troubleshooting of `RecvError::Lagged` events.
/// See Phase 1A.6 in `docs/tech-debt-plan-revised-2026-04.md`.
#[tauri::command]
#[specta::specta]
pub async fn sdk_bridge_metrics(
    bridge: tauri::State<'_, SharedBridgeManager>,
) -> CmdResult<BridgeMetricsSnapshot> {
    let mgr = bridge.read().await;
    Ok(mgr.metrics_snapshot())
}
