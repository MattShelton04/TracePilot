//! BridgeManager — owns the Copilot SDK client lifecycle and forwards events.
//!
//! All SDK-specific code is behind `#[cfg(feature = "copilot-sdk")]`. When the
//! feature is disabled every operation returns `BridgeError::NotAvailable`.

#[cfg(feature = "copilot-sdk")]
use super::BridgeQuotaSnapshot;
use super::{
    BridgeAuthStatus, BridgeConnectConfig, BridgeConnectionState, BridgeError, BridgeEvent,
    BridgeMessagePayload, BridgeModelInfo, BridgeQuota, BridgeSessionConfig, BridgeSessionInfo,
    BridgeSessionMode, BridgeStatus,
};
#[cfg(feature = "copilot-sdk")]
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::sync::{RwLock, broadcast};
#[cfg(feature = "copilot-sdk")]
use tracing::{debug, info, warn};

/// Shared bridge manager type for Tauri state.
pub type SharedBridgeManager = Arc<RwLock<BridgeManager>>;

/// Cumulative metrics for the bridge broadcast channels.
///
/// All counters are monotonic and crash-safe (atomics, not locks). Exposed
/// as a snapshot via [`BridgeManager::metrics_snapshot`] so debug UI can
/// surface broadcast-channel lag without taking any lock on the manager.
///
/// See [`docs/tech-debt-plan-revised-2026-04.md`](../../../../docs/tech-debt-plan-revised-2026-04.md)
/// Phase 1A.6 — "Status broadcast channel sizing".
#[derive(Debug, Default)]
pub struct BridgeMetrics {
    /// Number of SDK events successfully forwarded onto the `BridgeEvent`
    /// broadcast channel.
    pub events_forwarded: AtomicU64,
    /// Cumulative count of *individual events* dropped because a broadcast
    /// receiver lagged. Incremented by `n` each time the forwarder observes
    /// `RecvError::Lagged(n)`.
    pub events_dropped_due_to_lag: AtomicU64,
    /// Number of distinct lag occurrences (independent of how many events
    /// each occurrence dropped). Useful for alerting on "lag is happening
    /// at all" vs "lag is huge".
    pub lag_occurrences: AtomicU64,
}

/// Plain-data snapshot of [`BridgeMetrics`] for IPC / logging.
///
/// Serialised in camelCase for frontend consumption (matches the rest of the
/// IPC DTOs; see `packages/types/src/sdk.ts::BridgeMetricsSnapshot`).
#[derive(Debug, Clone, Copy, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BridgeMetricsSnapshot {
    pub events_forwarded: u64,
    pub events_dropped_due_to_lag: u64,
    pub lag_occurrences: u64,
}

/// Manages the lifecycle of the Copilot SDK client connection.
pub struct BridgeManager {
    state: BridgeConnectionState,
    error_message: Option<String>,
    /// "stdio" or "tcp" — tracks how we connected.
    connection_mode: Option<String>,
    /// TCP server URL when in TCP mode — used for raw JSON-RPC calls
    /// that bypass the SDK (workaround for upstream method name bugs).
    cli_url: Option<String>,
    event_tx: broadcast::Sender<BridgeEvent>,
    status_tx: broadcast::Sender<BridgeStatus>,
    metrics: Arc<BridgeMetrics>,

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
    pub fn new() -> (
        Self,
        broadcast::Receiver<BridgeEvent>,
        broadcast::Receiver<BridgeStatus>,
    ) {
        let (tx, rx) = broadcast::channel(512);
        // Sized to 256 (was 16): status updates are tiny struct values; a
        // slow subscriber under heavy reconnect activity used to hit
        // `RecvError::Lagged` well before any UI catch-up window.
        // See docs/tech-debt-plan-revised-2026-04.md Phase 1A.6.
        let (status_tx, status_rx) = broadcast::channel(256);
        let manager = Self {
            state: BridgeConnectionState::Disconnected,
            error_message: None,
            connection_mode: None,
            cli_url: None,
            event_tx: tx,
            status_tx,
            metrics: Arc::new(BridgeMetrics::default()),
            #[cfg(feature = "copilot-sdk")]
            client: None,
            #[cfg(feature = "copilot-sdk")]
            sessions: HashMap::new(),
            #[cfg(feature = "copilot-sdk")]
            event_tasks: HashMap::new(),
        };
        (manager, rx, status_rx)
    }

    /// Point-in-time snapshot of broadcast-channel metrics. Cheap (a few
    /// atomic loads) and takes no lock on the manager itself.
    pub fn metrics_snapshot(&self) -> BridgeMetricsSnapshot {
        BridgeMetricsSnapshot {
            events_forwarded: self.metrics.events_forwarded.load(Ordering::Relaxed),
            events_dropped_due_to_lag: self
                .metrics
                .events_dropped_due_to_lag
                .load(Ordering::Relaxed),
            lag_occurrences: self.metrics.lag_occurrences.load(Ordering::Relaxed),
        }
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
        self.cli_url = config.cli_url.clone();

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
        self.cli_url = None;
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

    /// Change the model for a session.
    ///
    /// In TCP mode, sends a raw JSON-RPC call with the correct camelCase method
    /// name (`session.model.switchTo`). The upstream Rust SDK has a bug where it
    /// sends `session.model.switch_to` (snake_case) which the CLI doesn't recognize.
    /// See: docs/copilot-sdk-rpc-method-bug.md
    #[cfg(feature = "copilot-sdk")]
    pub async fn set_session_model(
        &self,
        session_id: &str,
        model: &str,
        reasoning_effort: Option<String>,
    ) -> Result<(), BridgeError> {
        // TCP mode: bypass SDK with raw JSON-RPC using correct method name
        if let Some(url) = &self.cli_url {
            info!(
                "Setting model for session {} to '{}' via raw RPC (tcp: {})",
                session_id, model, url
            );

            let mut params = serde_json::json!({
                "sessionId": session_id,
                "modelId": model,
            });
            if let Some(effort) = &reasoning_effort {
                params["reasoningEffort"] = serde_json::json!(effort);
            }

            let result = raw_rpc_call(url, "session.model.switchTo", params).await?;
            info!("session.model.switchTo result: {}", result);

            // Verify the model actually changed
            let verify_params = serde_json::json!({ "sessionId": session_id });
            match raw_rpc_call(url, "session.model.getCurrent", verify_params).await {
                Ok(current) => {
                    let current_model = current
                        .get("modelId")
                        .and_then(|v| v.as_str())
                        .unwrap_or("<none>");
                    info!(
                        "session.model.getCurrent after switch: current='{}', requested='{}'",
                        current_model, model
                    );
                    if current_model != model && current_model != "<none>" {
                        warn!(
                            "Model switch may not have taken effect: requested '{}', current '{}'",
                            model, current_model
                        );
                    }
                }
                Err(e) => {
                    warn!("getCurrent verification failed (non-fatal): {}", e);
                }
            }

            return Ok(());
        }

        // Stdio mode: use SDK method (may fail with -32601 due to upstream bug)
        info!(
            "Setting model for session {} to '{}' via SDK (stdio)",
            session_id, model
        );
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
    fn require_session(&self, session_id: &str) -> Result<&Arc<copilot_sdk::Session>, BridgeError> {
        self.sessions
            .get(session_id)
            .ok_or_else(|| BridgeError::SessionNotFound(session_id.to_string()))
    }

    /// Spawn a tokio task that reads SDK events and forwards them as BridgeEvents.
    #[cfg(feature = "copilot-sdk")]
    fn spawn_event_forwarder(&mut self, session_id: &str, session: &Arc<copilot_sdk::Session>) {
        let tx = self.event_tx.clone();
        let metrics = Arc::clone(&self.metrics);
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
        });

        self.event_tasks.insert(session_id.to_string(), handle);
    }
}

/// Launch a `copilot --ui-server` process in a new terminal window.
///
/// This is independent of the SDK client — it simply spawns the CLI
/// binary with `--ui-server` so the user gets a visible terminal with
/// the Copilot TUI that TracePilot can then connect to via TCP.
pub fn launch_ui_server(working_dir: Option<&str>) -> Result<u32, BridgeError> {
    // Resolve copilot binary path via PATH
    let copilot_path =
        crate::process::find_executable(tracepilot_core::constants::DEFAULT_CLI_COMMAND)
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|| tracepilot_core::constants::DEFAULT_CLI_COMMAND.to_string());

    let work_dir = working_dir
        .map(std::path::PathBuf::from)
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_else(|| std::path::PathBuf::from("."));

    #[cfg(windows)]
    {
        let ps_cmd = format!(
            "$host.UI.RawUI.WindowTitle = 'TracePilot \u{2022} Copilot CLI Server'; \
             Write-Host 'Starting Copilot CLI UI Server...' -ForegroundColor Cyan; \
             Write-Host '  Working directory: {}' -ForegroundColor White; \
             Write-Host '  Connect from TracePilot Settings > Detect & Connect' -ForegroundColor DarkGray; \
             Write-Host ''; \
             & '{}' --ui-server",
            work_dir.display().to_string().replace('\'', "''"),
            copilot_path.replace('\'', "''"),
        );
        let encoded = crate::process::encode_powershell_command(&ps_cmd);
        crate::process::spawn_detached_terminal(
            "powershell",
            &["-NoExit", "-EncodedCommand", &encoded],
            &work_dir,
            None,
        )
        .map_err(|e| BridgeError::Sdk(format!("Failed to launch UI server: {e}")))
    }

    #[cfg(target_os = "macos")]
    {
        let cmd = format!("{} --ui-server", copilot_path);
        crate::process::spawn_detached_terminal(&cmd, &[], &work_dir, None)
            .map_err(|e| BridgeError::Sdk(format!("Failed to launch UI server: {e}")))
    }

    #[cfg(target_os = "linux")]
    {
        let cmd = format!("{} --ui-server", copilot_path);
        crate::process::spawn_detached_terminal(&cmd, &[], &work_dir, None)
            .map_err(|e| BridgeError::Sdk(format!("Failed to launch UI server: {e}")))
    }
}

/// Send a raw JSON-RPC request to the CLI server over TCP.
///
/// Bypasses the SDK to work around upstream method name bugs
/// (e.g. `session.model.switch_to` should be `session.model.switchTo`).
/// Uses Content-Length framing (LSP-style protocol).
#[cfg(feature = "copilot-sdk")]
async fn raw_rpc_call(
    cli_url: &str,
    method: &str,
    params: serde_json::Value,
) -> Result<serde_json::Value, BridgeError> {
    use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
    use tokio::net::TcpStream;
    use tokio::time::{Duration, timeout};

    const RPC_TIMEOUT: Duration = Duration::from_secs(10);
    const MAX_BODY_SIZE: usize = 10 * 1024 * 1024; // 10 MB

    // Parse URL — accepts "host:port", "http://host:port", "ws://host:port", or bare "port"
    let addr = if let Some(rest) = cli_url.strip_prefix("http://") {
        rest.to_string()
    } else if let Some(rest) = cli_url.strip_prefix("ws://") {
        rest.to_string()
    } else if cli_url.contains(':') {
        cli_url.to_string()
    } else {
        format!("127.0.0.1:{cli_url}")
    };

    debug!("raw_rpc_call: {} → {} params={}", addr, method, params);

    let mut stream = timeout(RPC_TIMEOUT, TcpStream::connect(&addr))
        .await
        .map_err(|_| {
            BridgeError::Sdk(format!(
                "TCP connect to {addr}: timed out after {RPC_TIMEOUT:?}"
            ))
        })?
        .map_err(|e| BridgeError::Sdk(format!("TCP connect to {addr}: {e}")))?;

    let body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": method,
        "params": params,
    });
    let body_str = serde_json::to_string(&body)
        .map_err(|e| BridgeError::Sdk(format!("JSON serialize: {e}")))?;

    let msg = format!("Content-Length: {}\r\n\r\n{}", body_str.len(), body_str);
    timeout(RPC_TIMEOUT, stream.write_all(msg.as_bytes()))
        .await
        .map_err(|_| BridgeError::Sdk("TCP write timed out".into()))?
        .map_err(|e| BridgeError::Sdk(format!("TCP write: {e}")))?;

    // Read Content-Length header from response
    let mut reader = BufReader::new(stream);
    let mut content_length: usize = 0;
    let header_result = timeout(RPC_TIMEOUT, async {
        loop {
            let mut line = String::new();
            reader
                .read_line(&mut line)
                .await
                .map_err(|e| BridgeError::Sdk(format!("TCP read header: {e}")))?;
            let trimmed = line.trim();
            if trimmed.is_empty() {
                break;
            }
            if let Some(len_str) = trimmed.strip_prefix("Content-Length:") {
                content_length = len_str
                    .trim()
                    .parse()
                    .map_err(|_| BridgeError::Sdk("Invalid Content-Length".into()))?;
            }
        }
        Ok::<(), BridgeError>(())
    })
    .await
    .map_err(|_| BridgeError::Sdk("TCP read header timed out".into()))?;
    header_result?;

    if content_length == 0 {
        return Err(BridgeError::Sdk("No Content-Length in response".into()));
    }
    if content_length > MAX_BODY_SIZE {
        return Err(BridgeError::Sdk(format!(
            "Response body too large: {content_length} bytes (max {MAX_BODY_SIZE})"
        )));
    }

    let mut body_buf = vec![0u8; content_length];
    timeout(RPC_TIMEOUT, reader.read_exact(&mut body_buf))
        .await
        .map_err(|_| BridgeError::Sdk("TCP read body timed out".into()))?
        .map_err(|e| BridgeError::Sdk(format!("TCP read body: {e}")))?;

    let response: serde_json::Value = serde_json::from_slice(&body_buf)
        .map_err(|e| BridgeError::Sdk(format!("JSON parse response: {e}")))?;

    debug!("raw_rpc_call: {} response={}", method, response);

    if let Some(error) = response.get("error") {
        let msg = error
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("Unknown");
        let code = error.get("code").and_then(|c| c.as_i64()).unwrap_or(0);
        return Err(BridgeError::Sdk(format!("JSON-RPC error {code}: {msg}")));
    }

    Ok(response
        .get("result")
        .cloned()
        .unwrap_or(serde_json::Value::Null))
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

    #[test]
    fn manager_new_has_no_cli_url() {
        let (mgr, _rx, _status_rx) = BridgeManager::new();
        assert!(mgr.cli_url.is_none());
        assert!(mgr.connection_mode.is_none());
    }

    /// Helper: starts a minimal Content-Length framed JSON-RPC server that
    /// returns a canned response for the first request, then shuts down.
    #[cfg(feature = "copilot-sdk")]
    async fn mock_jsonrpc_server(response: serde_json::Value) -> (tokio::net::TcpListener, String) {
        use tokio::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap().to_string();
        let response_clone = response.clone();

        tokio::spawn(async move {
            use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};

            let (stream, _) = listener.accept().await.unwrap();
            let mut reader = BufReader::new(stream);

            // Read headers
            let mut content_length: usize = 0;
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).await.unwrap();
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    break;
                }
                if let Some(len_str) = trimmed.strip_prefix("Content-Length:") {
                    content_length = len_str.trim().parse().unwrap();
                }
            }

            // Read body
            let mut body_buf = vec![0u8; content_length];
            reader.read_exact(&mut body_buf).await.unwrap();

            let request: serde_json::Value = serde_json::from_slice(&body_buf).unwrap();

            // Build JSON-RPC response with matching id
            let resp = serde_json::json!({
                "jsonrpc": "2.0",
                "id": request.get("id").cloned().unwrap_or(serde_json::json!(1)),
                "result": response_clone,
            });

            let resp_str = serde_json::to_string(&resp).unwrap();
            let msg = format!("Content-Length: {}\r\n\r\n{}", resp_str.len(), resp_str);
            reader.get_mut().write_all(msg.as_bytes()).await.unwrap();
        });

        // Return the listener (to keep it alive) and address
        let addr_for_caller = addr.clone();
        // We need to return something that keeps the spawned task's listener alive.
        // The listener is moved into the spawned task, so we just return the address.
        // Bind a new reference to keep things tidy:
        let listener2 = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        (listener2, addr_for_caller)
    }

    /// Helper: starts a JSON-RPC server that returns an error.
    #[cfg(feature = "copilot-sdk")]
    async fn mock_jsonrpc_error_server(code: i64, message: &str) -> String {
        use tokio::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap().to_string();
        let msg_owned = message.to_string();

        tokio::spawn(async move {
            use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};

            let (stream, _) = listener.accept().await.unwrap();
            let mut reader = BufReader::new(stream);

            let mut content_length: usize = 0;
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).await.unwrap();
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    break;
                }
                if let Some(len_str) = trimmed.strip_prefix("Content-Length:") {
                    content_length = len_str.trim().parse().unwrap();
                }
            }

            let mut body_buf = vec![0u8; content_length];
            reader.read_exact(&mut body_buf).await.unwrap();

            let request: serde_json::Value = serde_json::from_slice(&body_buf).unwrap();

            let resp = serde_json::json!({
                "jsonrpc": "2.0",
                "id": request.get("id").cloned().unwrap_or(serde_json::json!(1)),
                "error": {
                    "code": code,
                    "message": msg_owned,
                },
            });

            let resp_str = serde_json::to_string(&resp).unwrap();
            let msg = format!("Content-Length: {}\r\n\r\n{}", resp_str.len(), resp_str);
            reader.get_mut().write_all(msg.as_bytes()).await.unwrap();
        });

        addr
    }

    #[cfg(feature = "copilot-sdk")]
    #[tokio::test]
    async fn raw_rpc_call_success_returns_result() {
        let expected = serde_json::json!({ "modelId": "gpt-4.1" });
        let (_keep, addr) = mock_jsonrpc_server(expected.clone()).await;

        let result = raw_rpc_call(
            &addr,
            "session.model.getCurrent",
            serde_json::json!({ "sessionId": "test-123" }),
        )
        .await
        .expect("should succeed");

        assert_eq!(result, expected);
    }

    #[cfg(feature = "copilot-sdk")]
    #[tokio::test]
    async fn raw_rpc_call_null_result() {
        let (_keep, addr) = mock_jsonrpc_server(serde_json::Value::Null).await;

        let result = raw_rpc_call(
            &addr,
            "session.model.switchTo",
            serde_json::json!({ "sessionId": "test-123", "modelId": "gpt-4.1" }),
        )
        .await
        .expect("should succeed");

        assert_eq!(result, serde_json::Value::Null);
    }

    #[cfg(feature = "copilot-sdk")]
    #[tokio::test]
    async fn raw_rpc_call_error_response() {
        let addr = mock_jsonrpc_error_server(-32601, "Unhandled method").await;

        let result = raw_rpc_call(
            &addr,
            "session.model.switch_to",
            serde_json::json!({ "sessionId": "test-123" }),
        )
        .await;

        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("-32601"), "error should contain code: {err}");
        assert!(
            err.contains("Unhandled method"),
            "error should contain message: {err}"
        );
    }

    #[cfg(feature = "copilot-sdk")]
    #[tokio::test]
    async fn raw_rpc_call_connection_refused() {
        // Use a port that's extremely unlikely to be listening
        let result = raw_rpc_call("127.0.0.1:1", "test.method", serde_json::json!({})).await;

        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(
            err.contains("TCP connect"),
            "error should mention TCP connect: {err}"
        );
    }

    #[cfg(feature = "copilot-sdk")]
    #[tokio::test]
    async fn raw_rpc_call_parses_http_prefix() {
        let expected = serde_json::json!("ok");
        let (_keep, addr) = mock_jsonrpc_server(expected.clone()).await;

        let url_with_http = format!("http://{}", addr);
        let result = raw_rpc_call(&url_with_http, "test.method", serde_json::json!({}))
            .await
            .expect("should handle http:// prefix");

        assert_eq!(result, expected);
    }

    #[cfg(feature = "copilot-sdk")]
    #[tokio::test]
    async fn raw_rpc_call_parses_ws_prefix() {
        let expected = serde_json::json!("ok");
        let (_keep, addr) = mock_jsonrpc_server(expected.clone()).await;

        let url_with_ws = format!("ws://{}", addr);
        let result = raw_rpc_call(&url_with_ws, "test.method", serde_json::json!({}))
            .await
            .expect("should handle ws:// prefix");

        assert_eq!(result, expected);
    }

    #[cfg(feature = "copilot-sdk")]
    #[tokio::test]
    async fn raw_rpc_call_rejects_oversized_body() {
        // Simulate a server that claims a body larger than 10MB — raw_rpc_call should reject
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        let _server = tokio::spawn(async move {
            if let Ok((mut stream, _)) = listener.accept().await {
                use tokio::io::{AsyncReadExt, AsyncWriteExt};
                let mut buf = vec![0u8; 4096];
                let _ = stream.read(&mut buf).await;
                // Respond with a Content-Length that exceeds MAX_BODY_SIZE
                let response = "Content-Length: 20000000\r\n\r\n{}";
                let _ = stream.write_all(response.as_bytes()).await;
            }
        });

        let result = raw_rpc_call(&addr.to_string(), "test.method", serde_json::json!({})).await;

        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(
            err.contains("too large"),
            "error should mention body too large: {err}"
        );
    }
}
