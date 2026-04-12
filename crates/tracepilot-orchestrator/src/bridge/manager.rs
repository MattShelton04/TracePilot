//! BridgeManager — owns the Copilot SDK client lifecycle and forwards events.
//!
//! All SDK-specific code is behind `#[cfg(feature = "copilot-sdk")]`. When the
//! feature is disabled every operation returns `BridgeError::NotAvailable`.

use super::{
    BridgeAuthStatus, BridgeConnectConfig, BridgeConnectionState, BridgeError, BridgeEvent,
    BridgeMessagePayload, BridgeModelInfo, BridgeQuota, BridgeSessionConfig,
    BridgeSessionInfo, BridgeSessionMode, BridgeStatus,
};
#[cfg(feature = "copilot-sdk")]
use super::BridgeQuotaSnapshot;
#[cfg(feature = "copilot-sdk")]
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};
#[cfg(feature = "copilot-sdk")]
use tracing::{debug, info, warn};

/// Shared bridge manager type for Tauri state.
pub type SharedBridgeManager = Arc<RwLock<BridgeManager>>;

/// Manages the lifecycle of the Copilot SDK client connection.
pub struct BridgeManager {
    state: BridgeConnectionState,
    error_message: Option<String>,
    /// "stdio" or "tcp" — tracks how we connected.
    connection_mode: Option<String>,
    event_tx: broadcast::Sender<BridgeEvent>,
    status_tx: broadcast::Sender<BridgeStatus>,

    #[cfg(feature = "copilot-sdk")]
    client: Option<copilot_sdk::Client>,
    #[cfg(feature = "copilot-sdk")]
    sessions: HashMap<String, Arc<copilot_sdk::Session>>,
    #[cfg(feature = "copilot-sdk")]
    event_tasks: HashMap<String, tokio::task::JoinHandle<()>>,
}

impl BridgeManager {
    /// Create a new bridge manager. Returns the manager, a broadcast receiver
    /// for bridge events, and a broadcast receiver for status changes
    /// (both typically forwarded to Tauri IPC events).
    pub fn new() -> (Self, broadcast::Receiver<BridgeEvent>, broadcast::Receiver<BridgeStatus>) {
        let (tx, rx) = broadcast::channel(512);
        let (status_tx, status_rx) = broadcast::channel(16);
        let manager = Self {
            state: BridgeConnectionState::Disconnected,
            error_message: None,
            connection_mode: None,
            event_tx: tx,
            status_tx,
            #[cfg(feature = "copilot-sdk")]
            client: None,
            #[cfg(feature = "copilot-sdk")]
            sessions: HashMap::new(),
            #[cfg(feature = "copilot-sdk")]
            event_tasks: HashMap::new(),
        };
        (manager, rx, status_rx)
    }

    /// Subscribe to bridge events (additional receivers beyond the initial one).
    pub fn subscribe(&self) -> broadcast::Receiver<BridgeEvent> {
        self.event_tx.subscribe()
    }

    /// Subscribe to bridge status changes.
    pub fn subscribe_status(&self) -> broadcast::Receiver<BridgeStatus> {
        self.status_tx.subscribe()
    }

    /// Current connection state.
    pub fn connection_state(&self) -> BridgeConnectionState {
        self.state
    }

    /// Whether the SDK Cargo feature is compiled in.
    pub fn is_sdk_available(&self) -> bool {
        cfg!(feature = "copilot-sdk")
    }

    /// Snapshot of bridge status.
    pub fn status(&self) -> BridgeStatus {
        BridgeStatus {
            state: self.state,
            sdk_available: self.is_sdk_available(),
            cli_version: None,
            protocol_version: None,
            #[cfg(feature = "copilot-sdk")]
            active_sessions: self.sessions.len(),
            #[cfg(not(feature = "copilot-sdk"))]
            active_sessions: 0,
            error: self.error_message.clone(),
            connection_mode: self.connection_mode.clone(),
        }
    }

    // ─── Connection Lifecycle ─────────────────────────────────────

    /// Connect to the Copilot CLI via the SDK.
    ///
    /// If `config.cli_url` is set, connects to an existing `copilot --ui-server`.
    /// Otherwise, spawns a new CLI process via stdio.
    #[cfg(feature = "copilot-sdk")]
    pub async fn connect(&mut self, config: BridgeConnectConfig) -> Result<(), BridgeError> {
        // If already connected, auto-disconnect first (idempotent reconnect).
        if self.state == BridgeConnectionState::Connected {
            info!("Already connected — disconnecting before reconnect");
            let _ = self.disconnect().await;
        }

        self.state = BridgeConnectionState::Connecting;
        self.error_message = None;

        // Track connection mode based on config
        let is_tcp = config.cli_url.is_some();
        self.connection_mode = Some(if is_tcp { "tcp" } else { "stdio" }.to_string());

        let mut builder = copilot_sdk::Client::builder();

        if let Some(url) = &config.cli_url {
            builder = builder.cli_url(url.as_str());
            // Don't set use_logged_in_user when connecting to an external server
            // — the SDK rejects that combination.
        } else {
            builder = builder.use_logged_in_user(true);
        }
        if let Some(cwd) = &config.cwd {
            builder = builder.cwd(cwd.as_str());
        }
        if let Some(token) = &config.github_token {
            builder = builder.github_token(token.as_str());
        }
        if let Some(level) = &config.log_level {
            let sdk_level = match level.to_lowercase().as_str() {
                "error" => copilot_sdk::LogLevel::Error,
                "warn" => copilot_sdk::LogLevel::Warn,
                "debug" => copilot_sdk::LogLevel::Debug,
                _ => copilot_sdk::LogLevel::Info,
            };
            builder = builder.log_level(sdk_level);
        }

        let client = builder.build().map_err(|e| {
            self.state = BridgeConnectionState::Error;
            self.error_message = Some(e.to_string());
            BridgeError::ConnectionFailed(e.to_string())
        })?;

        client.start().await.map_err(|e| {
            self.state = BridgeConnectionState::Error;
            self.error_message = Some(e.to_string());
            BridgeError::ConnectionFailed(e.to_string())
        })?;

        self.client = Some(client);
        self.state = BridgeConnectionState::Connected;
        self.emit_status_change();
        info!("Copilot SDK bridge connected");
        Ok(())
    }

    #[cfg(not(feature = "copilot-sdk"))]
    pub async fn connect(&mut self, _config: BridgeConnectConfig) -> Result<(), BridgeError> {
        Err(BridgeError::NotAvailable)
    }

    /// Disconnect from the Copilot CLI, stopping all sessions.
    #[cfg(feature = "copilot-sdk")]
    pub async fn disconnect(&mut self) -> Result<(), BridgeError> {
        for (_, handle) in self.event_tasks.drain() {
            handle.abort();
        }
        self.sessions.clear();

        if let Some(client) = self.client.take() {
            let errors = client.stop().await;
            if !errors.is_empty() {
                warn!("SDK stop reported {} errors", errors.len());
            }
        }

        self.state = BridgeConnectionState::Disconnected;
        self.error_message = None;
        self.connection_mode = None;
        self.emit_status_change();
        info!("Copilot SDK bridge disconnected");
        Ok(())
    }

    #[cfg(not(feature = "copilot-sdk"))]
    pub async fn disconnect(&mut self) -> Result<(), BridgeError> {
        Ok(())
    }

    // ─── Session Management ───────────────────────────────────────

    /// Create a new Copilot session via the SDK.
    #[cfg(feature = "copilot-sdk")]
    pub async fn create_session(
        &mut self,
        config: BridgeSessionConfig,
    ) -> Result<BridgeSessionInfo, BridgeError> {
        let client = self.require_client()?;

        let mut session_config = copilot_sdk::SessionConfig::default();
        session_config.model = config.model.clone();
        session_config.working_directory = config.working_directory.clone();
        session_config.reasoning_effort = config.reasoning_effort.clone();
        session_config.agent = config.agent.clone();
        session_config.client_name = Some("tracepilot".to_string());

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
    ) -> Result<BridgeSessionInfo, BridgeError> {
        // Already tracked — no-op.
        if self.sessions.contains_key(session_id) {
            debug!("Session {} already resumed — returning cached", session_id);
            return Ok(BridgeSessionInfo {
                session_id: session_id.to_string(),
                model: None,
                working_directory: None,
                mode: None,
                is_active: true,
                resume_error: None,
                is_remote: false,
            });
        }

        info!("Resuming session {} via SDK", session_id);
        let client = self.require_client()?;
        let session = client
            .resume_session(session_id, copilot_sdk::ResumeSessionConfig::default())
            .await
            .map_err(|e| {
                let msg = e.to_string();
                // Categorize common resume failures for better frontend UX:
                // - "Session file is corrupted" → CLI schema validation mismatch
                // - "Session not found" → session dir doesn't exist on disk
                // - "lock" / "in use" → another process is writing to the session
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
        info!("Session {} resumed successfully (returned ID: {})", session_id, sid);
        self.spawn_event_forwarder(&sid, &session);
        self.sessions.insert(sid.clone(), session);

        // In TCP (--ui-server) mode, also set this as the foreground session so the
        // CLI's TUI knows about it. This is a best-effort operation — ignore errors.
        if self.connection_mode.as_deref() == Some("tcp") {
            if let Some(client) = &self.client {
                match client.set_foreground_session_id(&sid).await {
                    Ok(_) => info!("Set foreground session to {} (--ui-server)", sid),
                    Err(e) => debug!("set_foreground_session best-effort failed: {}", e),
                }
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
            debug!("destroy_session: {} not in local session map, skipping", session_id);
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

    /// Change the model for a session.
    #[cfg(feature = "copilot-sdk")]
    pub async fn set_session_model(
        &self,
        session_id: &str,
        model: &str,
        reasoning_effort: Option<String>,
    ) -> Result<(), BridgeError> {
        let session = self.require_session(session_id)?;
        let opts = reasoning_effort.map(|re| copilot_sdk::SetModelOptions {
            reasoning_effort: Some(re),
        });
        session
            .set_model(model, opts)
            .await
            .map_err(|e| BridgeError::Sdk(e.to_string()))
    }

    #[cfg(not(feature = "copilot-sdk"))]
    pub async fn set_session_model(
        &self,
        _session_id: &str,
        _model: &str,
        _reasoning_effort: Option<String>,
    ) -> Result<(), BridgeError> {
        Err(BridgeError::NotAvailable)
    }

    // ─── Query Operations ─────────────────────────────────────────

    /// List all sessions known to the SDK client.
    /// Sessions that have been resumed locally are marked `is_active: true`.
    /// Others are listed from the CLI's session metadata (may not be resumable).
    #[cfg(feature = "copilot-sdk")]
    pub async fn list_sessions(&self) -> Result<Vec<BridgeSessionInfo>, BridgeError> {
        let client = self.require_client()?;
        let sessions = client
            .list_sessions()
            .await
            .map_err(|e| BridgeError::Sdk(e.to_string()))?;

        Ok(sessions
            .into_iter()
            .map(|m| {
                let is_resumed = self.sessions.contains_key(&m.session_id);
                BridgeSessionInfo {
                    session_id: m.session_id,
                    model: None,
                    working_directory: None,
                    mode: None,
                    is_active: is_resumed,
                    resume_error: None,
                    is_remote: m.is_remote,
                }
            })
            .collect())
    }

    #[cfg(not(feature = "copilot-sdk"))]
    pub async fn list_sessions(&self) -> Result<Vec<BridgeSessionInfo>, BridgeError> {
        Err(BridgeError::NotAvailable)
    }

    /// Get quota information.
    #[cfg(feature = "copilot-sdk")]
    pub async fn get_quota(&self) -> Result<BridgeQuota, BridgeError> {
        let client = self.require_client()?;
        let result = client
            .get_quota()
            .await
            .map_err(|e| BridgeError::Sdk(e.to_string()))?;

        Ok(BridgeQuota {
            quotas: result
                .quotas
                .into_iter()
                .map(|q| BridgeQuotaSnapshot {
                    quota_type: q.quota_type,
                    limit: q.limit,
                    used: q.used,
                    remaining: q.remaining,
                    resets_at: q.resets_at,
                })
                .collect(),
        })
    }

    #[cfg(not(feature = "copilot-sdk"))]
    pub async fn get_quota(&self) -> Result<BridgeQuota, BridgeError> {
        Err(BridgeError::NotAvailable)
    }

    /// Get authentication status.
    #[cfg(feature = "copilot-sdk")]
    pub async fn get_auth_status(&self) -> Result<BridgeAuthStatus, BridgeError> {
        let client = self.require_client()?;
        let result = client
            .get_auth_status()
            .await
            .map_err(|e| BridgeError::Sdk(e.to_string()))?;

        Ok(BridgeAuthStatus {
            is_authenticated: result.is_authenticated,
            auth_type: result.auth_type,
            host: result.host,
            login: result.login,
            status_message: result.status_message,
        })
    }

    #[cfg(not(feature = "copilot-sdk"))]
    pub async fn get_auth_status(&self) -> Result<BridgeAuthStatus, BridgeError> {
        Err(BridgeError::NotAvailable)
    }

    /// Get SDK / CLI version info.
    #[cfg(feature = "copilot-sdk")]
    pub async fn get_cli_status(&self) -> Result<BridgeStatus, BridgeError> {
        let client = self.require_client()?;
        let result = client
            .get_status()
            .await
            .map_err(|e| BridgeError::Sdk(e.to_string()))?;

        Ok(BridgeStatus {
            state: self.state,
            sdk_available: true,
            cli_version: Some(result.version),
            protocol_version: Some(result.protocol_version),
            #[cfg(feature = "copilot-sdk")]
            active_sessions: self.sessions.len(),
            #[cfg(not(feature = "copilot-sdk"))]
            active_sessions: 0,
            error: self.error_message.clone(),
            connection_mode: self.connection_mode.clone(),
        })
    }

    #[cfg(not(feature = "copilot-sdk"))]
    pub async fn get_cli_status(&self) -> Result<BridgeStatus, BridgeError> {
        Err(BridgeError::NotAvailable)
    }

    /// List available models.
    #[cfg(feature = "copilot-sdk")]
    pub async fn list_models(&self) -> Result<Vec<BridgeModelInfo>, BridgeError> {
        let client = self.require_client()?;
        let models = client
            .list_models()
            .await
            .map_err(|e| BridgeError::Sdk(e.to_string()))?;

        Ok(models
            .into_iter()
            .map(|m| BridgeModelInfo {
                id: m.id,
                name: Some(m.name),
            })
            .collect())
    }

    #[cfg(not(feature = "copilot-sdk"))]
    pub async fn list_models(&self) -> Result<Vec<BridgeModelInfo>, BridgeError> {
        Err(BridgeError::NotAvailable)
    }

    // ─── Foreground Session (--ui-server mode) ────────────────────

    /// Get the foreground session ID from a `copilot --ui-server` instance.
    #[cfg(feature = "copilot-sdk")]
    pub async fn get_foreground_session(&self) -> Result<Option<String>, BridgeError> {
        let client = self.require_client()?;
        let resp = client
            .get_foreground_session_id()
            .await
            .map_err(|e| BridgeError::Sdk(e.to_string()))?;
        Ok(resp.session_id)
    }

    #[cfg(not(feature = "copilot-sdk"))]
    pub async fn get_foreground_session(&self) -> Result<Option<String>, BridgeError> {
        Err(BridgeError::NotAvailable)
    }

    /// Set the foreground session ID (switches which session the TUI displays).
    #[cfg(feature = "copilot-sdk")]
    pub async fn set_foreground_session(&self, session_id: &str) -> Result<(), BridgeError> {
        let client = self.require_client()?;
        client
            .set_foreground_session_id(session_id)
            .await
            .map_err(|e| BridgeError::Sdk(e.to_string()))?;
        Ok(())
    }

    #[cfg(not(feature = "copilot-sdk"))]
    pub async fn set_foreground_session(&self, _session_id: &str) -> Result<(), BridgeError> {
        Err(BridgeError::NotAvailable)
    }

    // ─── Internal Helpers ─────────────────────────────────────────

    /// Broadcast the current status to all status subscribers.
    #[allow(dead_code)] // Used in feature-gated connect/disconnect paths
    fn emit_status_change(&self) {
        let _ = self.status_tx.send(self.status());
    }

    #[cfg(feature = "copilot-sdk")]
    fn require_client(&self) -> Result<&copilot_sdk::Client, BridgeError> {
        self.client.as_ref().ok_or(BridgeError::NotConnected)
    }

    #[cfg(feature = "copilot-sdk")]
    fn require_session(
        &self,
        session_id: &str,
    ) -> Result<&Arc<copilot_sdk::Session>, BridgeError> {
        self.sessions
            .get(session_id)
            .ok_or_else(|| BridgeError::SessionNotFound(session_id.to_string()))
    }

    /// Spawn a tokio task that reads SDK events and forwards them as BridgeEvents.
    #[cfg(feature = "copilot-sdk")]
    fn spawn_event_forwarder(&mut self, session_id: &str, session: &Arc<copilot_sdk::Session>) {
        let tx = self.event_tx.clone();
        let sid = session_id.to_string();
        let mut events = session.subscribe();

        let handle = tokio::spawn(async move {
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
                            debug!(
                                "No bridge event receivers, stopping forwarder for {}",
                                sid
                            );
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                        debug!("SDK event channel closed for session {}", sid);
                        break;
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        warn!("Bridge event receiver lagged by {} for session {}", n, sid);
                    }
                }
            }
        });

        self.event_tasks.insert(session_id.to_string(), handle);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manager_reports_sdk_availability() {
        let (mgr, _rx, _status_rx) = BridgeManager::new();
        // Availability depends on compile-time feature
        let status = mgr.status();
        assert_eq!(status.state, BridgeConnectionState::Disconnected);
        assert_eq!(status.active_sessions, 0);
    }

    #[tokio::test]
    async fn connect_without_feature_returns_not_available() {
        let (mut mgr, _rx, _status_rx) = BridgeManager::new();
        if !mgr.is_sdk_available() {
            let result = mgr
                .connect(BridgeConnectConfig {
                    cli_url: None,
                    cwd: None,
                    log_level: None,
                    github_token: None,
                })
                .await;
            assert!(matches!(result, Err(BridgeError::NotAvailable)));
        }
    }
}
