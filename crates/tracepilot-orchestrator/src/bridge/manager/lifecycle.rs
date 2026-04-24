//! Connection lifecycle for [`BridgeManager`] — `connect` / `disconnect` for
//! both stdio (SDK spawns a private CLI subprocess) and TCP (SDK attaches to
//! an existing `copilot --ui-server`) modes.

use super::BridgeManager;
use crate::bridge::{BridgeConnectConfig, BridgeConnectionState, BridgeError, ConnectionMode};

use tracing::{info, warn};

impl BridgeManager {
    /// Connect to the Copilot CLI via the SDK.
    ///
    /// If `config.cli_url` is set, connects to an existing `copilot --ui-server`.
    /// Otherwise, spawns a new CLI process via stdio.
    pub async fn connect(&mut self, config: BridgeConnectConfig) -> Result<(), BridgeError> {
        self.check_preference_enabled()?;

        // If already connected, auto-disconnect first (idempotent reconnect).
        if self.state == BridgeConnectionState::Connected {
            info!("Already connected — disconnecting before reconnect");
            if let Err(e) = self.disconnect().await {
                // best-effort: reconnect proceeds even if the previous disconnect
                // surfaced an error — the new connect() reinitialises all state.
                tracing::debug!(error = %e, "disconnect-before-reconnect returned error (ignored)");
            }
        }

        self.state = BridgeConnectionState::Connecting;
        self.error_message = None;

        // Track connection mode based on config
        self.connection_mode = Some(if config.cli_url.is_some() {
            ConnectionMode::Tcp
        } else {
            ConnectionMode::Stdio
        });
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

    /// Disconnect from the Copilot CLI, stopping all sessions.
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
}
