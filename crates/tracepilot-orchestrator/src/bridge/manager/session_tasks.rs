//! Session-oriented Tauri-facing helpers on [`BridgeManager`]: create, resume,
//! destroy, steering (send/abort/set-mode/set-model), and the SDK event
//! forwarder that feeds the bridge's broadcast channel.

use super::BridgeManager;
use crate::bridge::live_state::SessionRuntimeStatus;
use crate::bridge::registry::{
    DesiredSessionState, RegistryUpsert, RuntimeSessionState, SessionOrigin,
};
use crate::bridge::{
    BridgeError, BridgeEvent, BridgeMessagePayload, BridgeSessionConfig, BridgeSessionInfo,
    BridgeSessionMode, ConnectionMode,
};

use std::sync::Arc;
use std::sync::atomic::Ordering;
use tracing::{debug, info, warn};

impl BridgeManager {
    /// Create a new Copilot session via the SDK.
    pub async fn create_session(
        &mut self,
        config: BridgeSessionConfig,
    ) -> Result<BridgeSessionInfo, BridgeError> {
        self.create_session_with_origin(config, SessionOrigin::ManualLink)
            .await
    }

    /// Create a new Copilot session owned by TracePilot's launcher.
    pub async fn create_launcher_session(
        &mut self,
        config: BridgeSessionConfig,
    ) -> Result<BridgeSessionInfo, BridgeError> {
        self.create_session_with_origin(config, SessionOrigin::LauncherSdk)
            .await
    }

    async fn create_session_with_origin(
        &mut self,
        config: BridgeSessionConfig,
        origin: SessionOrigin,
    ) -> Result<BridgeSessionInfo, BridgeError> {
        self.check_preference_enabled()?;
        let client = self.require_client()?;

        let mut session_config = copilot_sdk::SessionConfig {
            model: config.model.clone(),
            working_directory: config.working_directory.clone(),
            reasoning_effort: config.reasoning_effort.clone(),
            agent: config.agent.clone(),
            client_name: Some("tracepilot".to_string()),
            ..copilot_sdk::SessionConfig::default()
        };

        if let Some(msg) = &config.system_message {
            session_config.system_message = Some(copilot_sdk::SystemMessageConfig {
                content: Some(msg.clone()),
                mode: Some(copilot_sdk::SystemMessageMode::Append),
            });
        }

        let session = client
            .create_session(session_config)
            .await
            .map_err(|e| BridgeError::Sdk(e.to_string()))?;

        Ok(self.track_created_session(session, config, origin))
    }

    /// Resume an existing session by ID (for `--ui-server` mode steering).
    /// Attaches to the session, starts event forwarding, and caches the handle
    /// so subsequent steering calls (send_message, abort, etc.) work.
    ///
    /// **Important**: The SDK subprocess loads the session from disk and validates
    /// `events.jsonl` with its own schema. If the CLI version that wrote the
    /// session differs from the current CLI version, schema validation may fail
    /// ("Session file is corrupted at line N") even though the JSON is valid.
    /// This is NOT actual file corruption — it's a schema version mismatch.
    /// TracePilot's own parsers handle these differences gracefully.
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
            self.persist_session_link(
                session_id,
                SessionOrigin::ManualLink,
                working_directory.map(String::from),
                model.map(String::from),
                None,
                None,
                RuntimeSessionState::Running,
                None,
            );
            self.mark_live_session_status(session_id, SessionRuntimeStatus::Running, None);
            return Ok(BridgeSessionInfo {
                session_id: session_id.to_string(),
                model: model.map(String::from),
                working_directory: working_directory.map(String::from),
                mode: None,
                is_active: true,
                resume_error: None,
                is_remote: false,
            });
        }

        self.check_preference_enabled()?;
        info!(
            "Resuming session {} via SDK (cwd: {:?}, model: {:?})",
            session_id, working_directory, model
        );
        let client = self.require_client()?;

        let mut resume_config = copilot_sdk::ResumeSessionConfig::default();
        if let Some(cwd) = working_directory {
            resume_config.working_directory = Some(cwd.to_string());
        }
        if let Some(m) = model {
            resume_config.model = Some(m.to_string());
        }

        let session = client
            .resume_session(session_id, resume_config)
            .await
            .map_err(|e| {
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
            })?;

        let sid = session.session_id().to_string();
        info!(
            "Session {} resumed successfully (returned ID: {})",
            session_id, sid
        );
        self.spawn_event_forwarder(&sid, &session);
        self.mark_live_session_status(&sid, SessionRuntimeStatus::Running, None);
        self.sessions.insert(sid.clone(), session);
        self.persist_session_link(
            &sid,
            SessionOrigin::ManualLink,
            working_directory.map(String::from),
            model.map(String::from),
            None,
            None,
            RuntimeSessionState::Running,
            None,
        );

        // In TCP (--ui-server) mode, also set this as the foreground session so the
        // CLI's TUI knows about it. This is a best-effort operation — ignore errors.
        if self.connection_mode == Some(crate::bridge::ConnectionMode::Tcp)
            && let Some(client) = &self.client
        {
            match client.set_foreground_session_id(&sid).await {
                Ok(_) => info!("Set foreground session to {} (--ui-server)", sid),
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
    pub async fn send_message(
        &self,
        session_id: &str,
        payload: BridgeMessagePayload,
    ) -> Result<String, BridgeError> {
        let session = self.require_session(session_id)?;

        let opts = copilot_sdk::MessageOptions {
            prompt: payload.prompt,
            // Always send empty array (not None/null) to match CLI's schema expectations.
            // The CLI writes `"attachments": []` — if we omit it, the subprocess writes
            // `"attachments": null` which fails Zod validation on subsequent resume.
            attachments: Some(vec![]),
            mode: payload.mode,
        };

        session
            .send(opts)
            .await
            .map_err(|e| BridgeError::Sdk(e.to_string()))
    }

    /// Abort the current turn in a session.
    pub async fn abort_session(&self, session_id: &str) -> Result<(), BridgeError> {
        let session = self.require_session(session_id)?;
        session
            .abort()
            .await
            .map_err(|e| BridgeError::Sdk(e.to_string()))
    }

    /// Unlink a session from the bridge WITHOUT destroying it on the SDK side.
    /// The session stays alive in the subprocess — no `session.shutdown` event is written.
    /// This allows safe re-linking without triggering Zod re-validation.
    pub fn unlink_session(&mut self, session_id: &str) {
        if self.sessions.remove(session_id).is_some() {
            if let Some(task) = self.event_tasks.remove(session_id) {
                task.abort();
            }
            info!("Unlinked session {} (kept alive in subprocess)", session_id);
        } else {
            debug!("unlink_session: {} not in local session map", session_id);
        }
        self.mark_session_desired(
            session_id,
            DesiredSessionState::Unlinked,
            RuntimeSessionState::Unknown,
        );
        self.mark_live_session_status(session_id, SessionRuntimeStatus::Unknown, None);
    }

    /// Destroy a resumed session, releasing its resources.
    /// Removes it from the local session map and cancels the event forwarder.
    /// This writes a `session.shutdown` event to events.jsonl.
    pub async fn destroy_session(&mut self, session_id: &str) -> Result<(), BridgeError> {
        if let Some(session) = self.sessions.remove(session_id) {
            // Cancel the event forwarder task
            if let Some(task) = self.event_tasks.remove(session_id) {
                task.abort();
            }
            session
                .destroy()
                .await
                .map_err(|e| BridgeError::Sdk(e.to_string()))?;
            info!("Destroyed session {}", session_id);
        } else {
            // Not locally resumed — nothing to destroy
            debug!(
                "destroy_session: {} not in local session map, skipping",
                session_id
            );
        }
        self.mark_session_desired(
            session_id,
            DesiredSessionState::Destroyed,
            RuntimeSessionState::Shutdown,
        );
        self.mark_live_session_status(session_id, SessionRuntimeStatus::Shutdown, None);
        Ok(())
    }

    /// Change the session mode (interactive / plan / autopilot).
    pub async fn set_session_mode(
        &self,
        session_id: &str,
        mode: BridgeSessionMode,
    ) -> Result<(), BridgeError> {
        let session = self.require_session(session_id)?;
        let sdk_mode = match mode {
            BridgeSessionMode::Interactive => copilot_sdk::SessionMode::Interactive,
            BridgeSessionMode::Plan => copilot_sdk::SessionMode::Plan,
            BridgeSessionMode::Autopilot => copilot_sdk::SessionMode::Autopilot,
        };
        session
            .set_mode(sdk_mode)
            .await
            .map_err(|e| BridgeError::Sdk(e.to_string()))
    }

    /// Spawn a tokio task that reads SDK events and forwards them as BridgeEvents.
    pub(super) fn spawn_event_forwarder(
        &mut self,
        session_id: &str,
        session: &Arc<copilot_sdk::Session>,
    ) {
        let tx = self.event_tx.clone();
        let state_tx = self.state_tx.clone();
        let live_state = Arc::clone(&self.live_state);
        let metrics = Arc::clone(&self.metrics);
        let registry = self.registry.clone();
        let sid = session_id.to_string();
        let mut events = session.subscribe();

        let handle = tokio::spawn(tracing::Instrument::instrument(
            async move {
                loop {
                    match events.recv().await {
                        Ok(event) => {
                            let bridge_event = BridgeEvent {
                                session_id: sid.clone(),
                                event_type: event.event_type.clone(),
                                timestamp: event.timestamp.clone(),
                                id: Some(event.id.clone()),
                                parent_id: event.parent_id.clone(),
                                ephemeral: event.ephemeral.unwrap_or(false),
                                data: serde_json::to_value(&event.data)
                                    .unwrap_or(serde_json::Value::Null),
                            };
                            let state = live_state.apply_event(&bridge_event);
                            if state_tx.send(state).is_err() {
                                debug!("No SDK session-state receivers for {}", sid);
                            }
                            if tx.send(bridge_event).is_ok() {
                                metrics.events_forwarded.fetch_add(1, Ordering::Relaxed);
                            } else {
                                debug!("No bridge event receivers for {}", sid);
                            }
                            if let Some(registry) = &registry {
                                match registry.lock() {
                                    Ok(guard) => {
                                        if let Err(err) = guard.mark_event(
                                            &sid,
                                            Some(event.id.as_str()),
                                            event.event_type.as_str(),
                                        ) {
                                            warn!(error = %err, session_id = %sid, "Failed to update SDK registry event marker");
                                        }
                                    }
                                    Err(_) => warn!("SDK registry mutex poisoned"),
                                }
                            }
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                            debug!("SDK event channel closed for session {}", sid);
                            break;
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                            warn!("Bridge event receiver lagged by {} for session {}", n, sid);
                            metrics
                                .events_dropped_due_to_lag
                                .fetch_add(n, Ordering::Relaxed);
                            metrics.lag_occurrences.fetch_add(1, Ordering::Relaxed);
                        }
                    }
                }
            },
            tracing::info_span!("sdk_event_forwarder", session_id = %session_id),
        ));

        self.event_tasks.insert(session_id.to_string(), handle);
    }

    fn persist_session_link(
        &self,
        session_id: &str,
        origin: SessionOrigin,
        working_directory: Option<String>,
        model: Option<String>,
        reasoning_effort: Option<String>,
        agent: Option<String>,
        runtime_state: RuntimeSessionState,
        last_error: Option<String>,
    ) {
        let connection_mode = self
            .connection_mode
            .map(ConnectionMode::as_str)
            .map(String::from);
        let record = RegistryUpsert {
            session_id: session_id.to_string(),
            origin,
            connection_mode,
            cli_url: self.cli_url.clone(),
            working_directory,
            model,
            reasoning_effort,
            agent,
            desired_state: DesiredSessionState::Tracked,
            runtime_state,
            last_error,
        };
        if let Err(err) = self.with_registry(|registry| registry.upsert(record)) {
            warn!(error = %err, session_id, "Failed to persist SDK session registry link");
        }
    }

    pub(super) fn track_created_session(
        &mut self,
        session: Arc<copilot_sdk::Session>,
        config: BridgeSessionConfig,
        origin: SessionOrigin,
    ) -> BridgeSessionInfo {
        let session_id = session.session_id().to_string();

        self.spawn_event_forwarder(&session_id, &session);
        self.mark_live_session_status(&session_id, SessionRuntimeStatus::Running, None);

        self.sessions.insert(session_id.clone(), session);
        self.persist_session_link(
            &session_id,
            origin,
            config.working_directory.clone(),
            config.model.clone(),
            config.reasoning_effort.clone(),
            config.agent.clone(),
            RuntimeSessionState::Running,
            None,
        );

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

    fn mark_session_desired(
        &self,
        session_id: &str,
        desired_state: DesiredSessionState,
        runtime_state: RuntimeSessionState,
    ) {
        if let Err(err) = self.with_registry(|registry| {
            registry.mark_desired(session_id, desired_state, runtime_state)
        }) {
            warn!(error = %err, session_id, "Failed to persist SDK session desired state");
        }
    }

    pub(super) async fn auto_resume_recoverable_sessions(&mut self) {
        let decisions = match self.with_registry(|registry| registry.recovery_decisions()) {
            Ok(Some(decisions)) => decisions,
            Ok(None) => return,
            Err(err) => {
                warn!(error = %err, "Failed to read SDK registry recovery decisions");
                return;
            }
        };

        for decision in decisions.into_iter().filter(|d| d.should_auto_resume) {
            if self.sessions.contains_key(&decision.session_id) {
                continue;
            }
            let record = decision.record;
            match self
                .resume_session(
                    &record.session_id,
                    record.working_directory.as_deref(),
                    record.model.as_deref(),
                )
                .await
            {
                Ok(_) => {
                    self.persist_session_link(
                        &record.session_id,
                        record.origin,
                        record.working_directory,
                        record.model,
                        record.reasoning_effort,
                        record.agent,
                        RuntimeSessionState::Running,
                        None,
                    );
                    info!(session_id = %record.session_id, "Auto-resumed SDK session");
                }
                Err(err) => {
                    let msg = err.to_string();
                    warn!(session_id = %record.session_id, error = %msg, "SDK auto-resume failed");
                    self.persist_session_link(
                        &record.session_id,
                        record.origin,
                        record.working_directory,
                        record.model,
                        record.reasoning_effort,
                        record.agent,
                        RuntimeSessionState::Error,
                        Some(msg),
                    );
                }
            }
        }
    }
}
