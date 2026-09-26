//! Connection lifecycle for [`BridgeManager`] — `connect` / `disconnect` for
//! both stdio (SDK spawns a private CLI subprocess) and TCP (SDK attaches to
//! an existing `copilot --ui-server`) modes. Client construction lives in
//! [`super::sdk_client`].

use super::BridgeManager;
use super::sdk_client::{requested_connection_mode, start_client};
use super::session_tasks::DETACH_TIMEOUT;
use crate::bridge::{BridgeConnectConfig, BridgeConnectionState, BridgeError};

use std::time::Instant;
use tracing::{debug, info, warn};

impl BridgeManager {
    fn is_same_connection_config(&self, config: &BridgeConnectConfig) -> bool {
        self.connection_mode == Some(requested_connection_mode(config))
            && self.cli_url.as_deref() == config.cli_url.as_deref()
            && self.connection_cwd.as_deref() == config.cwd.as_deref()
    }

    /// Connect to the Copilot CLI via the SDK.
    ///
    /// If `config.cli_url` is set, attaches to an existing `copilot --ui-server`
    /// over TCP. Otherwise, spawns a private CLI process via stdio.
    pub async fn connect(&mut self, config: BridgeConnectConfig) -> Result<(), BridgeError> {
        if self.state == BridgeConnectionState::Connected {
            if self.is_same_connection_config(&config) {
                info!("Already connected with matching SDK bridge config — keeping connection");
                self.emit_status_change();
                return Ok(());
            }
            return Err(BridgeError::AlreadyConnected);
        }

        self.check_preference_enabled()?;

        self.state = BridgeConnectionState::Connecting;
        self.error_message = None;

        // Track connection identity for idempotent renderer hydration.
        let mode = requested_connection_mode(&config);
        self.connection_mode = Some(mode);
        self.cli_url = config.cli_url.clone();
        self.connection_cwd = config.cwd.clone();

        // DEEP-03: capture connect-path timing so operators can see slow
        // starts (CLI spawn + protocol handshake) in the logs.
        let connect_started_at = Instant::now();
        debug!(
            mode = %mode,
            has_cli_url = config.cli_url.is_some(),
            has_cwd = config.cwd.is_some(),
            "SDK bridge connect: starting"
        );

        let client = match start_client(&config).await {
            Ok(client) => client,
            Err(e) => {
                self.state = BridgeConnectionState::Error;
                self.error_message = Some(e.to_string());
                self.emit_status_change();
                return Err(e);
            }
        };
        let total_ms = connect_started_at.elapsed().as_millis() as u64;
        let protocol_version = client.protocol_version();

        self.client = Some(client);
        self.state = BridgeConnectionState::Connected;
        self.emit_status_change();
        info!(
            mode = %mode,
            total_ms,
            protocol_version = ?protocol_version,
            "Copilot SDK bridge connected"
        );
        Ok(())
    }

    /// Disconnect from the Copilot CLI, stopping all sessions.
    ///
    /// Order matters (DEEP-06): every tracked session is detached first with a
    /// bounded, best-effort `Session::disconnect()` so attached `--ui-server`
    /// sessions are released cleanly (this never writes to the session's
    /// history). Then `client.stop()` closes the transport (and ends the
    /// private CLI in stdio mode), the session handles are dropped, and every
    /// forwarder is aborted and awaited. The abort+await pair is what makes
    /// teardown deterministic, not the natural-exit path.
    ///
    /// Live-state is cleared silently — no per-session terminal broadcast.
    /// The renderer treats a `Disconnected` `BridgeStatus` as the canonical
    /// "all sessions gone" signal; emitting per-session terminal events
    /// here would just duplicate that information.
    pub async fn disconnect(&mut self) -> Result<(), BridgeError> {
        for (id, session) in &self.sessions {
            match tokio::time::timeout(DETACH_TIMEOUT, session.disconnect()).await {
                Ok(Ok(())) => debug!("Detached session {} during disconnect", id),
                Ok(Err(e)) => debug!("Best-effort detach of {} failed: {}", id, e),
                Err(_) => debug!("Best-effort detach of {} timed out", id),
            }
        }

        if let Some(client) = self.client.take()
            && let Err(errors) = client.stop().await
        {
            warn!("SDK stop reported errors: {}", errors);
        }
        // Live attach endpoints: their sessions were detached above, so this
        // only closes TracePilot's connections; the terminals keep running.
        self.stop_all_endpoints().await;

        self.sessions.clear();

        for (id, handle) in self.event_tasks.drain() {
            handle.abort();
            if let Err(e) = handle.await
                && !e.is_cancelled()
            {
                warn!("event forwarder for {} failed to join cleanly: {}", id, e);
            }
        }

        self.live_state.clear();

        self.state = BridgeConnectionState::Disconnected;
        self.error_message = None;
        self.connection_mode = None;
        self.cli_url = None;
        self.connection_cwd = None;
        self.emit_status_change();
        info!("Copilot SDK bridge disconnected");
        Ok(())
    }
}
