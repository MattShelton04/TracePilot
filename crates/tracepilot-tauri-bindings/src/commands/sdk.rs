//! Copilot SDK bridge Tauri commands (feature-gated).
//!
//! These commands expose the BridgeManager to the frontend for:
//!   - Connecting/disconnecting the SDK bridge
//!   - Creating and managing SDK sessions
//!   - Sending messages (steering)
//!   - Querying quota, auth status, and models

use crate::config::SharedConfig;
use crate::error::CmdResult;
use crate::helpers::read_config;
use tracepilot_orchestrator::bridge::manager::{BridgeMetricsSnapshot, SharedBridgeManager};
use tracepilot_orchestrator::bridge::{
    BridgeAuthStatus, BridgeConnectConfig, BridgeError, BridgeHydrationSnapshot,
    BridgeMessagePayload, BridgeModelInfo, BridgeQuota, BridgeSessionConfig, BridgeSessionInfo,
    BridgeSessionMode, BridgeStatus, DetectedUiServer, LiveHostState, LiveSessionHost,
    SessionLiveState, locate_sessions,
};

/// Upper bound on one `sdk_live_hosts` request (a session list page).
const MAX_LIVE_HOST_QUERY: usize = 500;

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
pub async fn sdk_hydrate(
    bridge: tauri::State<'_, SharedBridgeManager>,
) -> CmdResult<BridgeHydrationSnapshot> {
    let mgr = bridge.read().await;
    Ok(mgr.hydrate())
}

#[tauri::command]
pub async fn sdk_get_session_state(
    bridge: tauri::State<'_, SharedBridgeManager>,
    session_id: String,
) -> CmdResult<Option<SessionLiveState>> {
    let mgr = bridge.read().await;
    Ok(mgr.get_session_state(&session_id))
}

#[tauri::command]
pub async fn sdk_list_session_states(
    bridge: tauri::State<'_, SharedBridgeManager>,
) -> CmdResult<Vec<SessionLiveState>> {
    let mgr = bridge.read().await;
    Ok(mgr.list_session_states())
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
    config: tauri::State<'_, SharedConfig>,
    session_id: String,
    working_directory: Option<String>,
    model: Option<String>,
) -> CmdResult<BridgeSessionInfo> {
    // A session held by another CLI process must be joined where it runs:
    // resuming it through TracePilot's own connection would load an isolated
    // copy and fork its history (F9). Route attachable sessions to live
    // attach and refuse the rest.
    let already_tracked = bridge.read().await.is_tracked(&session_id);
    if !already_tracked {
        // A failed probe refuses: resuming a session a terminal still holds
        // would fork it (F9).
        let host = locate_one(&config, &session_id).await?;
        match host.state {
            LiveHostState::Attachable => {
                let address = host.address.unwrap_or_default();
                let mut mgr = bridge.write().await;
                return mgr
                    .attach_session(&session_id, &address)
                    .await
                    .map_err(Into::into);
            }
            LiveHostState::Running => {
                return Err(BridgeError::NotAttachable(not_attachable_message(&session_id)).into());
            }
            LiveHostState::Idle => {}
        }
    }
    let mut mgr = bridge.write().await;
    mgr.resume_session(&session_id, working_directory.as_deref(), model.as_deref())
        .await
        .map_err(Into::into)
}

// ─── Live attach (ADR-0016) ───────────────────────────────────────

/// Hosting state of each requested session: attachable (served by a
/// `--ui-server` terminal), running (plain terminal), or idle. Also drops any
/// attachment whose terminal has gone away, so polling this keeps the live
/// view honest. When hosting state cannot be read, this fails and leaves
/// every attachment alone; the next poll tries again.
#[tauri::command]
#[tracing::instrument(skip_all, level = "debug", err, fields(count = session_ids.len()))]
pub async fn sdk_live_hosts(
    bridge: tauri::State<'_, SharedBridgeManager>,
    config: tauri::State<'_, SharedConfig>,
    session_ids: Vec<String>,
) -> CmdResult<Vec<LiveSessionHost>> {
    let requested: Vec<String> = session_ids.into_iter().take(MAX_LIVE_HOST_QUERY).collect();
    let attached = bridge.read().await.attached_session_ids();
    let mut query = requested.clone();
    for id in attached {
        if !query.contains(&id) {
            query.push(id);
        }
    }
    let session_state_dir = read_config(&config).session_state_dir();
    let mut hosts = locate_sessions(&session_state_dir, &query)
        .await
        .map_err(BridgeError::from)?;

    let mut mgr = bridge.write().await;
    mgr.reconcile_attachments(&hosts).await;
    mgr.mark_attached(&mut hosts);
    hosts.retain(|h| requested.contains(&h.session_id));
    Ok(hosts)
}

/// Attach to a session running in a `copilot --ui-server` terminal and start
/// streaming its live events. Detach with `sdk_unlink_session`.
#[tauri::command]
#[tracing::instrument(skip(bridge, config), err, fields(%session_id))]
pub async fn sdk_attach_session(
    bridge: tauri::State<'_, SharedBridgeManager>,
    config: tauri::State<'_, SharedConfig>,
    session_id: String,
) -> CmdResult<BridgeSessionInfo> {
    let host = locate_one(&config, &session_id).await?;
    let Some(address) = host
        .address
        .filter(|_| host.state == LiveHostState::Attachable)
    else {
        let message = match host.state {
            LiveHostState::Running => not_attachable_message(&session_id),
            _ => "This session is not running in a terminal TracePilot can attach to.".to_string(),
        };
        return Err(BridgeError::NotAttachable(message).into());
    };
    let mut mgr = bridge.write().await;
    mgr.attach_session(&session_id, &address)
        .await
        .map_err(Into::into)
}

async fn locate_one(
    config: &SharedConfig,
    session_id: &str,
) -> Result<LiveSessionHost, BridgeError> {
    let session_state_dir = read_config(config).session_state_dir();
    let host = locate_sessions(&session_state_dir, &[session_id.to_string()])
        .await?
        .pop()
        .unwrap_or(LiveSessionHost {
            session_id: session_id.to_string(),
            state: LiveHostState::Idle,
            pid: None,
            address: None,
            attached: false,
        });
    Ok(host)
}

fn not_attachable_message(session_id: &str) -> String {
    format!(
        "This session is open in a terminal that was started without --ui-server, so \
         TracePilot can't join it. Exit it and run `copilot --resume {session_id} --ui-server` \
         to watch it live."
    )
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
    mgr.unlink_session(&session_id).await;
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

#[tauri::command]
#[tracing::instrument(err, fields(pid))]
pub async fn sdk_stop_ui_server(pid: u32) -> CmdResult<()> {
    tracepilot_orchestrator::bridge::manager::stop_ui_server(pid)
        .await
        .map_err(Into::into)
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
