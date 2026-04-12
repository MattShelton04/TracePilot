//! Copilot SDK bridge Tauri commands (feature-gated).
//!
//! These commands expose the BridgeManager to the frontend for:
//!   - Connecting/disconnecting the SDK bridge
//!   - Creating and managing SDK sessions
//!   - Sending messages (steering)
//!   - Querying quota, auth status, and models

use crate::error::CmdResult;
use tracepilot_orchestrator::bridge::{
    BridgeAuthStatus, BridgeConnectConfig, BridgeMessagePayload, BridgeModelInfo, BridgeQuota,
    BridgeSessionConfig, BridgeSessionInfo, BridgeSessionMode, BridgeStatus,
    DetectedUiServer,
};
use tracepilot_orchestrator::bridge::manager::SharedBridgeManager;

// ─── Connection Lifecycle ─────────────────────────────────────────

#[tauri::command]
pub async fn sdk_connect(
    bridge: tauri::State<'_, SharedBridgeManager>,
    config: BridgeConnectConfig,
) -> CmdResult<BridgeStatus> {
    let mut mgr = bridge.write().await;
    mgr.connect(config).await?;
    Ok(mgr.status())
}

#[tauri::command]
pub async fn sdk_disconnect(
    bridge: tauri::State<'_, SharedBridgeManager>,
) -> CmdResult<BridgeStatus> {
    let mut mgr = bridge.write().await;
    mgr.disconnect().await?;
    Ok(mgr.status())
}

#[tauri::command]
pub async fn sdk_status(
    bridge: tauri::State<'_, SharedBridgeManager>,
) -> CmdResult<BridgeStatus> {
    let mgr = bridge.read().await;
    Ok(mgr.status())
}

#[tauri::command]
pub async fn sdk_cli_status(
    bridge: tauri::State<'_, SharedBridgeManager>,
) -> CmdResult<BridgeStatus> {
    let mgr = bridge.read().await;
    mgr.get_cli_status().await.map_err(Into::into)
}

// ─── Session Management ───────────────────────────────────────────

#[tauri::command]
pub async fn sdk_create_session(
    bridge: tauri::State<'_, SharedBridgeManager>,
    config: BridgeSessionConfig,
) -> CmdResult<BridgeSessionInfo> {
    let mut mgr = bridge.write().await;
    mgr.create_session(config).await.map_err(Into::into)
}

#[tauri::command]
pub async fn sdk_resume_session(
    bridge: tauri::State<'_, SharedBridgeManager>,
    session_id: String,
) -> CmdResult<BridgeSessionInfo> {
    let mut mgr = bridge.write().await;
    mgr.resume_session(&session_id).await.map_err(Into::into)
}

#[tauri::command]
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
pub async fn sdk_abort_session(
    bridge: tauri::State<'_, SharedBridgeManager>,
    session_id: String,
) -> CmdResult<()> {
    let mgr = bridge.read().await;
    mgr.abort_session(&session_id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn sdk_destroy_session(
    bridge: tauri::State<'_, SharedBridgeManager>,
    session_id: String,
) -> CmdResult<()> {
    let mut mgr = bridge.write().await;
    mgr.destroy_session(&session_id).await.map_err(Into::into)
}

#[tauri::command]
pub async fn sdk_unlink_session(
    bridge: tauri::State<'_, SharedBridgeManager>,
    session_id: String,
) -> CmdResult<()> {
    let mut mgr = bridge.write().await;
    mgr.unlink_session(&session_id);
    Ok(())
}

#[tauri::command]
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
pub async fn sdk_detect_ui_server() -> CmdResult<Vec<DetectedUiServer>> {
    let servers = tracepilot_orchestrator::bridge::detect_ui_servers().await;
    Ok(servers)
}
