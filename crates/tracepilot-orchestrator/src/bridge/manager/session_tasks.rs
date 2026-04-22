//! Session-oriented Tauri-facing helpers on [`BridgeManager`]: create, resume,
//! destroy, steering (send/abort/set-mode/set-model), and the SDK event
//! forwarder that feeds the bridge's broadcast channel.

use super::BridgeManager;
use crate::bridge::{
    BridgeError, BridgeMessagePayload, BridgeSessionConfig, BridgeSessionInfo, BridgeSessionMode,
};

#[cfg(feature = "copilot-sdk")]
use crate::bridge::BridgeEvent;
#[cfg(feature = "copilot-sdk")]
use std::sync::Arc;
#[cfg(feature = "copilot-sdk")]
use std::sync::atomic::Ordering;
#[cfg(feature = "copilot-sdk")]
use tracing::{debug, info, warn};

impl BridgeManager {
    /// Create a new Copilot session via the SDK.
    #[cfg(feature = "copilot-sdk")]
    pub async fn create_session(
        &mut self,
        config: BridgeSessionConfig,
    ) -> Result<BridgeSessionInfo, BridgeError> {
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

        let session_id = session.session_id().to_string();

        // Spawn event forwarding task
        self.spawn_event_forwarder(&session_id, &session);

        self.sessions.insert(session_id.clone(), session);

        Ok(BridgeSessionInfo {
            session_id,
            model: config.model,
            working_directory: config.working_directory,
            mode: Some(BridgeSessionMode::Interactive),
            is_active: true,
            resume_error: None,
            is_remote: false,
        })
    }

    #[cfg(not(feature = "copilot-sdk"))]
    pub async fn create_session(
        &mut self,
        _config: BridgeSessionConfig,
    ) -> Result<BridgeSessionInfo, BridgeError> {
        Err(BridgeError::NotAvailable)
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
    #[cfg(feature = "copilot-sdk")]
    pub async fn resume_session(
        &mut self,
        session_id: &str,
        working_directory: Option<&str>,
        model: Option<&str>,
    ) -> Result<BridgeSessionInfo, BridgeError> {
        // Already tracked — no-op.
        if self.sessions.contains_key(session_id) {
            debug!("Session {} already resumed — returning cached", session_id);
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
        self.sessions.insert(sid.clone(), session);

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

    #[cfg(not(feature = "copilot-sdk"))]
    pub async fn resume_session(
        &mut self,
        _session_id: &str,
        _working_directory: Option<&str>,
        _model: Option<&str>,
    ) -> Result<BridgeSessionInfo, BridgeError> {
        Err(BridgeError::NotAvailable)
    }

    /// Send a message to an existing SDK session (steering).
    #[cfg(feature = "copilot-sdk")]
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

    #[cfg(not(feature = "copilot-sdk"))]
    pub async fn send_message(
        &self,
        _session_id: &str,
        _payload: BridgeMessagePayload,
    ) -> Result<String, BridgeError> {
        Err(BridgeError::NotAvailable)
    }

    /// Abort the current turn in a session.
    #[cfg(feature = "copilot-sdk")]
    pub async fn abort_session(&self, session_id: &str) -> Result<(), BridgeError> {
        let session = self.require_session(session_id)?;
        session
            .abort()
            .await
            .map_err(|e| BridgeError::Sdk(e.to_string()))
    }

    #[cfg(not(feature = "copilot-sdk"))]
    pub async fn abort_session(&self, _session_id: &str) -> Result<(), BridgeError> {
        Err(BridgeError::NotAvailable)
    }

    /// Unlink a session from the bridge WITHOUT destroying it on the SDK side.
    /// The session stays alive in the subprocess — no `session.shutdown` event is written.
    /// This allows safe re-linking without triggering Zod re-validation.
    #[cfg(feature = "copilot-sdk")]
    pub fn unlink_session(&mut self, session_id: &str) {
        if self.sessions.remove(session_id).is_some() {
            if let Some(task) = self.event_tasks.remove(session_id) {
                task.abort();
            }
            info!("Unlinked session {} (kept alive in subprocess)", session_id);
        } else {
            debug!("unlink_session: {} not in local session map", session_id);
        }
    }

    #[cfg(not(feature = "copilot-sdk"))]
    pub fn unlink_session(&mut self, _session_id: &str) {}

    /// Destroy a resumed session, releasing its resources.
    /// Removes it from the local session map and cancels the event forwarder.
    /// This writes a `session.shutdown` event to events.jsonl.
    #[cfg(feature = "copilot-sdk")]
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
        Ok(())
    }

    #[cfg(not(feature = "copilot-sdk"))]
    pub async fn destroy_session(&mut self, _session_id: &str) -> Result<(), BridgeError> {
        Err(BridgeError::NotAvailable)
    }

    /// Change the session mode (interactive / plan / autopilot).
    #[cfg(feature = "copilot-sdk")]
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

    #[cfg(not(feature = "copilot-sdk"))]
    pub async fn set_session_mode(
        &self,
        _session_id: &str,
        _mode: BridgeSessionMode,
    ) -> Result<(), BridgeError> {
        Err(BridgeError::NotAvailable)
    }

    /// Spawn a tokio task that reads SDK events and forwards them as BridgeEvents.
    #[cfg(feature = "copilot-sdk")]
    pub(super) fn spawn_event_forwarder(
        &mut self,
        session_id: &str,
        session: &Arc<copilot_sdk::Session>,
    ) {
        let tx = self.event_tx.clone();
        let metrics = Arc::clone(&self.metrics);
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
                            if tx.send(bridge_event).is_err() {
                                debug!("No bridge event receivers, stopping forwarder for {}", sid);
                                break;
                            }
                            metrics.events_forwarded.fetch_add(1, Ordering::Relaxed);
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
}
