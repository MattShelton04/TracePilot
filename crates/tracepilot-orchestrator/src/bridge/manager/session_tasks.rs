//! Owned steering requests and SDK session configuration/event-forwarding helpers.

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
use tracing::{debug, info, warn};

/// Client name reported to the CLI for sessions TracePilot creates or joins.
pub(super) const CLIENT_NAME: &str = "tracepilot";

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
    /// Send a message to an existing SDK session (steering).
    ///
    /// `payload.mode` selects the delivery mode: `"immediate"` interrupts the
    /// current turn, `"enqueue"` (the runtime default) queues behind it. Other
    /// values are ignored; use [`Self::set_session_mode`] for agent modes.
    pub fn send_message(
        &self,
        session_id: &str,
        payload: BridgeMessagePayload,
    ) -> impl std::future::Future<Output = Result<String, BridgeError>> + Send + use<> {
        let session = self.require_session(session_id).cloned();
        let scope = self
            .session_scopes
            .get(session_id)
            .cloned()
            .unwrap_or_else(|| self.connection_scope.clone());
        async move {
            scope
                .run("send_message", async move {
                    let session = session?;

                    let mut opts = MessageOptions::new(payload.prompt);
                    match payload.mode.as_deref() {
                        None => {}
                        Some("immediate") => opts = opts.with_mode(DeliveryMode::Immediate),
                        Some("enqueue") => opts = opts.with_mode(DeliveryMode::Enqueue),
                        Some(other) => {
                            debug!("Ignoring unsupported message delivery mode '{}'", other)
                        }
                    }

                    session.send(opts).await.map_err(BridgeError::sdk)
                })
                .await
        }
    }

    /// Abort the current turn in a session.
    pub fn abort_session(
        &self,
        session_id: &str,
    ) -> impl std::future::Future<Output = Result<(), BridgeError>> + Send + use<> {
        let session = self.require_session(session_id).cloned();
        let scope = self
            .session_scopes
            .get(session_id)
            .cloned()
            .unwrap_or_else(|| self.connection_scope.clone());
        async move {
            scope
                .run("abort_session", async move {
                    let session = session?;
                    session.abort().await.map_err(BridgeError::sdk)
                })
                .await
        }
    }

    /// Change the session mode (interactive / plan / autopilot).
    pub fn set_session_mode(
        &self,
        session_id: &str,
        mode: BridgeSessionMode,
    ) -> impl std::future::Future<Output = Result<(), BridgeError>> + Send + use<> {
        let session = self.require_session(session_id).cloned();
        let scope = self
            .session_scopes
            .get(session_id)
            .cloned()
            .unwrap_or_else(|| self.connection_scope.clone());
        let session_id = session_id.to_string();
        async move {
            scope
                .run("set_session_mode", async move {
                    let session = session?;
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
                })
                .await
        }
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
pub(super) fn sdk_session_config(
    config: &BridgeSessionConfig,
    auto_approve: bool,
) -> SessionConfig {
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
