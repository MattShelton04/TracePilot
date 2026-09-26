//! Session-oriented Tauri-facing helpers on [`BridgeManager`]: create, resume,
//! detach, steering (send/abort/set-mode), and the SDK event forwarder that
//! feeds the bridge's broadcast channel.

use super::BridgeManager;
use super::sdk_client::SdkSession;
use crate::bridge::live_state::SessionRuntimeStatus;
use crate::bridge::{
    BridgeError, BridgeMessagePayload, BridgeSessionConfig, BridgeSessionInfo, BridgeSessionMode,
};

use github_copilot_sdk::rpc::ModeSetRequest;
use github_copilot_sdk::session_events::SessionMode;
use github_copilot_sdk::{
    DeliveryMode, MessageOptions, ResumeSessionConfig, SessionConfig, SessionId,
    SystemMessageConfig,
};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tracing::{debug, info, warn};

/// Client name reported to the CLI for sessions TracePilot creates or joins.
pub(super) const CLIENT_NAME: &str = "tracepilot";

/// Upper bound for the best-effort `session.detach`. The SDK's JSON-RPC layer
/// has no request timeout, so a request written after the peer died (a
/// terminal closed or Ctrl+C'd) can wait forever, and detach runs under the
/// manager's write lock.
pub(super) const DETACH_TIMEOUT: Duration = Duration::from_secs(2);

/// Resume `session_id` on `client` as a handler-less observer (F3): no
/// permission, elicitation, user-input, or exit-plan handlers, and `streaming`
/// left to the owning client (F5). Appends one `session.resume` event (F8).
pub(super) async fn resume_observer(
    client: &github_copilot_sdk::Client,
    session_id: &str,
    working_directory: Option<&str>,
    model: Option<&str>,
) -> Result<SdkSession, BridgeError> {
    let mut resume_config = ResumeSessionConfig::new(SessionId::new(session_id));
    resume_config.working_directory = working_directory.map(PathBuf::from);
    resume_config.model = model.map(String::from);
    resume_config.client_name = Some(CLIENT_NAME.to_string());

    client.resume_session(resume_config).await.map_err(|e| {
        let msg = e.to_string();
        if msg.contains("corrupted") {
            warn!(
                "Session {} has schema validation issues (CLI version mismatch): {}",
                session_id, msg
            );
        } else {
            warn!("Failed to resume session {}: {}", session_id, msg);
        }
        BridgeError::Sdk(msg)
    })
}

impl BridgeManager {
    /// Create a new Copilot session via the SDK.
    ///
    /// No permission handler is installed, so tool permission requests are
    /// denied by the runtime unless another connected client answers them.
    pub async fn create_session(
        &mut self,
        config: BridgeSessionConfig,
    ) -> Result<BridgeSessionInfo, BridgeError> {
        self.create_session_inner(config, false).await
    }

    /// Create a new Copilot session owned by TracePilot's launcher.
    ///
    /// When `auto_approve` is set the session approves every permission
    /// request (mirroring `copilot --allow-all-tools`). Otherwise permission
    /// requests are denied — there is no interactive handler yet (see the
    /// live attach plan, Phase 3).
    pub async fn create_launcher_session(
        &mut self,
        config: BridgeSessionConfig,
        auto_approve: bool,
    ) -> Result<BridgeSessionInfo, BridgeError> {
        self.create_session_inner(config, auto_approve).await
    }

    async fn create_session_inner(
        &mut self,
        config: BridgeSessionConfig,
        auto_approve: bool,
    ) -> Result<BridgeSessionInfo, BridgeError> {
        self.check_preference_enabled()?;
        let client = self.require_client()?;

        let session = client
            .create_session(sdk_session_config(&config, auto_approve))
            .await
            .map_err(BridgeError::sdk)?;

        Ok(self.track_created_session(Arc::new(session), config))
    }

    /// Resume an existing session by ID and start forwarding its events.
    ///
    /// Against a `--ui-server` (TCP mode) this joins the live session hosted by
    /// the user's terminal. No permission, elicitation, or user-input handlers
    /// are installed, so prompts stay with the terminal and TracePilot acts as
    /// an observer that can optionally steer. `streaming` is left unset: the
    /// owning client already chose it, and deltas are broadcast to every
    /// attached client.
    ///
    /// Every successful resume appends one `session.resume` event to the
    /// session's `events.jsonl`, so tracked sessions return the cached handle
    /// instead of resuming again.
    pub async fn resume_session(
        &mut self,
        session_id: &str,
        working_directory: Option<&str>,
        model: Option<&str>,
    ) -> Result<BridgeSessionInfo, BridgeError> {
        // Already tracked — no-op. This branch runs *before* the preference
        // check so sessions resumed prior to the user toggling the pref off
        // remain steerable (documented on `BridgeError::DisabledByPreference`).
        if self.sessions.contains_key(session_id) {
            debug!("Session {} already resumed — returning cached", session_id);
            self.mark_live_session_status(session_id, SessionRuntimeStatus::Running, None);
            return Ok(BridgeSessionInfo {
                session_id: session_id.to_string(),
                model: model.map(String::from),
                working_directory: working_directory.map(String::from),
                mode: None,
                is_active: true,
                resume_error: None,
                is_remote: self.session_endpoints.contains_key(session_id),
            });
        }

        self.check_preference_enabled()?;
        info!(
            "Resuming session {} via SDK (cwd: {:?}, model: {:?})",
            session_id, working_directory, model
        );
        let client = self.require_client()?;

        let session = resume_observer(client, session_id, working_directory, model).await?;

        let sid = session.id().to_string();
        let session = Arc::new(session);
        info!("Session {} resumed successfully", sid);
        self.spawn_event_forwarder(&sid, &session);
        self.mark_live_session_status(&sid, SessionRuntimeStatus::Running, None);
        self.sessions.insert(sid.clone(), session);

        // In TCP (--ui-server) mode, also set this as the foreground session so the
        // CLI's TUI knows about it. This is a best-effort operation — ignore errors.
        if self.connection_mode == Some(crate::bridge::ConnectionMode::Tcp)
            && let Some(client) = &self.client
        {
            match client
                .set_foreground_session_id(&SessionId::new(&sid))
                .await
            {
                Ok(()) => info!("Set foreground session to {} (--ui-server)", sid),
                Err(e) => debug!("set_foreground_session best-effort failed: {}", e),
            }
        }

        Ok(BridgeSessionInfo {
            session_id: sid,
            model: None,
            working_directory: None,
            mode: None,
            is_active: true,
            resume_error: None,
            is_remote: false,
        })
    }

    /// Send a message to an existing SDK session (steering).
    ///
    /// `payload.mode` selects the delivery mode: `"immediate"` interrupts the
    /// current turn, `"enqueue"` (the runtime default) queues behind it. Other
    /// values are ignored; use [`Self::set_session_mode`] for agent modes.
    pub async fn send_message(
        &self,
        session_id: &str,
        payload: BridgeMessagePayload,
    ) -> Result<String, BridgeError> {
        let session = self.require_session(session_id)?;

        let mut opts = MessageOptions::new(payload.prompt);
        match payload.mode.as_deref() {
            None => {}
            Some("immediate") => opts = opts.with_mode(DeliveryMode::Immediate),
            Some("enqueue") => opts = opts.with_mode(DeliveryMode::Enqueue),
            Some(other) => debug!("Ignoring unsupported message delivery mode '{}'", other),
        }

        session.send(opts).await.map_err(BridgeError::sdk)
    }

    /// Abort the current turn in a session.
    pub async fn abort_session(&self, session_id: &str) -> Result<(), BridgeError> {
        let session = self.require_session(session_id)?;
        session.abort().await.map_err(BridgeError::sdk)
    }

    /// Detach a session from the bridge, keeping it alive on the CLI side.
    ///
    /// Teardown order (per DEEP-01 rubber-duck invariants):
    ///   1. Take the SDK session out of the map and `abort()` + `await` the
    ///      forwarder task — only then is it guaranteed no further
    ///      `apply_event` calls can fire.
    ///   2. Best-effort `Session::disconnect()` (`session.detach`), which
    ///      releases this client's attachment without touching the session's
    ///      on-disk history.
    ///   3. `live_state.remove(...)` clears the per-session slot. Because the
    ///      forwarder is provably dead, no late event can resurrect it via
    ///      `apply_event`'s create-on-first-touch branch.
    ///
    /// There is no terminal broadcast on the unlink path: the session was not
    /// shut down and can be re-linked later.
    pub async fn unlink_session(&mut self, session_id: &str) {
        match self.detach_tracked(session_id).await {
            Some(result) => {
                if let Err(e) = result {
                    debug!("Best-effort detach of {} failed: {}", session_id, e);
                }
                info!("Unlinked session {} (kept alive in CLI)", session_id);
            }
            None => debug!("unlink_session: {} not in local session map", session_id),
        }
        // Defensive: also clears a stray slot left by an earlier partial teardown.
        self.live_state.remove(session_id);
    }

    /// Stop tracking a session and release the SDK attachment.
    ///
    /// With the official SDK this detaches (`Session::disconnect()`); it never
    /// writes `session.shutdown` into the session's history (ADR-0015). The
    /// difference from [`Self::unlink_session`] is the deterministic terminal
    /// frame (DEEP-05): after detaching, one synthetic `Shutdown` live-state
    /// snapshot is broadcast so subscribers see the session leave, then the
    /// slot is removed. The session is untracked even when the detach RPC
    /// fails; that error is still returned to the caller.
    pub async fn destroy_session(&mut self, session_id: &str) -> Result<(), BridgeError> {
        match self.detach_tracked(session_id).await {
            Some(result) => {
                self.mark_existing_session_status(session_id, SessionRuntimeStatus::Shutdown, None);
                self.live_state.remove(session_id);
                result?;
                info!("Detached session {}", session_id);
            }
            None => {
                debug!(
                    "destroy_session: {} not in local session map, skipping",
                    session_id
                );
                // Defensive cleanup if a stray live-state slot exists.
                self.live_state.remove(session_id);
            }
        }
        Ok(())
    }

    /// Remove a tracked session, stop its forwarder, and detach it from the
    /// CLI. Returns `None` when the session was not tracked.
    pub(super) async fn detach_tracked(
        &mut self,
        session_id: &str,
    ) -> Option<Result<(), BridgeError>> {
        let session = self.sessions.remove(session_id)?;
        if let Some(handle) = self.event_tasks.remove(session_id) {
            handle.abort();
            if let Err(e) = handle.await
                && !e.is_cancelled()
            {
                warn!(
                    "event forwarder for {} failed to join cleanly: {}",
                    session_id, e
                );
            }
        }
        let result = match tokio::time::timeout(DETACH_TIMEOUT, session.disconnect()).await {
            Ok(result) => result.map_err(BridgeError::sdk),
            Err(_) => Err(BridgeError::Timeout(format!(
                "detaching session {session_id}"
            ))),
        };
        self.release_endpoint_for(session_id).await;
        Some(result)
    }

    /// Change the session mode (interactive / plan / autopilot).
    pub async fn set_session_mode(
        &self,
        session_id: &str,
        mode: BridgeSessionMode,
    ) -> Result<(), BridgeError> {
        let session = self.require_session(session_id)?;
        let request = ModeSetRequest {
            mode: match mode {
                BridgeSessionMode::Interactive => SessionMode::Interactive,
                BridgeSessionMode::Plan => SessionMode::Plan,
                BridgeSessionMode::Autopilot => SessionMode::Autopilot,
            },
            ..ModeSetRequest::default()
        };
        let result = session
            .rpc()
            .mode()
            .set(request)
            .await
            .map_err(BridgeError::sdk)?;
        info!(
            "session.mode.set for {}: status={}, applied={:?}",
            session_id, result.status, result.mode_applied
        );
        Ok(())
    }

    /// Spawn the per-session forwarder task (see [`super::forwarder`]).
    pub(super) fn spawn_event_forwarder(&mut self, session_id: &str, session: &Arc<SdkSession>) {
        let channels = super::forwarder::ForwarderChannels {
            event_tx: self.event_tx.clone(),
            state_tx: self.state_tx.clone(),
            live_state: Arc::clone(&self.live_state),
            metrics: Arc::clone(&self.metrics),
        };
        let handle = tokio::spawn(tracing::Instrument::instrument(
            super::forwarder::run(session_id.to_string(), session.subscribe(), channels),
            tracing::info_span!("sdk_event_forwarder", session_id = %session_id),
        ));
        self.event_tasks.insert(session_id.to_string(), handle);
    }

    pub(super) fn track_created_session(
        &mut self,
        session: Arc<SdkSession>,
        config: BridgeSessionConfig,
    ) -> BridgeSessionInfo {
        let session_id = session.id().to_string();

        self.spawn_event_forwarder(&session_id, &session);
        self.mark_live_session_status(&session_id, SessionRuntimeStatus::Running, None);

        self.sessions.insert(session_id.clone(), session);

        BridgeSessionInfo {
            session_id,
            model: config.model,
            working_directory: config.working_directory,
            mode: Some(BridgeSessionMode::Interactive),
            is_active: true,
            resume_error: None,
            is_remote: false,
        }
    }
}

/// Translate a bridge create request into an SDK session config.
fn sdk_session_config(config: &BridgeSessionConfig, auto_approve: bool) -> SessionConfig {
    let mut session_config = SessionConfig::default();
    session_config.model = config.model.clone();
    session_config.working_directory = config.working_directory.as_ref().map(PathBuf::from);
    session_config.reasoning_effort = config.reasoning_effort.clone();
    session_config.agent = config.agent.clone();
    session_config.client_name = Some(CLIENT_NAME.to_string());
    if let Some(msg) = &config.system_message {
        session_config.system_message = Some(
            SystemMessageConfig::new()
                .with_mode("append")
                .with_content(msg.clone()),
        );
    }
    if auto_approve {
        session_config = session_config.approve_all_permissions();
    }
    session_config
}
