//! Live attach (ADR-0016): join sessions hosted by `copilot --ui-server`
//! terminals over loopback TCP, one SDK client per hosting endpoint.
//!
//! Attachments live beside the legacy single-connection bridge (`connect`):
//! they share the session map, event forwarder, live-state store, and steering
//! calls, but each attached session remembers the endpoint that hosts it. An
//! endpoint's client is started on first attach and stopped when its last
//! session detaches. Stopping an external client only closes TracePilot's
//! connection; the terminal keeps running.

use super::BridgeManager;
use super::sdk_client;
use super::sdk_client::SdkSession;
use super::session_tasks::resume_observer;
use crate::bridge::live_host::{LiveHostState, LiveSessionHost};
use crate::bridge::live_state::SessionRuntimeStatus;
use crate::bridge::{BridgeConnectConfig, BridgeError, BridgeSessionInfo};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tracing::{debug, info, warn};

/// Upper bound for connecting to a hosting endpoint. A lock-holder PID that
/// was reused by an unrelated listener must fail fast rather than hang.
const ENDPOINT_CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
/// Upper bound for the observer resume. The SDK's JSON-RPC layer has no
/// request timeout, and this runs under the manager's write lock.
const ATTACH_RESUME_TIMEOUT: Duration = Duration::from_secs(15);
/// A terminal that just started holds the session lock and listens on its
/// port shortly before it has loaded the session, so an early resume reports
/// "session not found". Retry for this long before giving up.
const HOST_WARMUP_WINDOW: Duration = Duration::from_secs(8);
const HOST_WARMUP_RETRY: Duration = Duration::from_millis(400);
/// Upper bound for closing an endpoint client whose peer may be gone.
const ENDPOINT_STOP_TIMEOUT: Duration = Duration::from_secs(2);

/// Error recorded on the live state when the hosting terminal stops serving
/// the session (it exited, or switched to another session).
pub(crate) const HOST_GONE_MESSAGE: &str =
    "The terminal running this session closed, or switched to another session.";

impl BridgeManager {
    /// Attach to `session_id`, hosted by the CLI server at `address`
    /// (`127.0.0.1:<port>`, from [`crate::bridge::locate_sessions`]).
    ///
    /// Idempotent: an already-tracked session returns its info without a
    /// second resume, because every resume writes a `session.resume` event
    /// into the session's history (F8).
    pub async fn attach_session(
        &mut self,
        session_id: &str,
        address: &str,
    ) -> Result<BridgeSessionInfo, BridgeError> {
        self.prune_finished_sessions().await;
        if self.sessions.contains_key(session_id) {
            debug!("attach_session: {} already tracked", session_id);
            return Ok(attached_info(
                session_id,
                self.session_endpoints.contains_key(session_id),
            ));
        }
        self.check_preference_enabled()?;

        let client = self.endpoint_client(address).await?;
        let resumed =
            tokio::time::timeout(ATTACH_RESUME_TIMEOUT, resume_on_host(&client, session_id))
                .await
                .unwrap_or_else(|_| {
                    Err(BridgeError::Timeout(format!(
                        "resuming session {session_id} on {address}"
                    )))
                });
        let session = match resumed {
            Ok(session) => session,
            Err(e) => {
                self.stop_endpoint_if_unused(address).await;
                return Err(e);
            }
        };
        let session = Arc::new(session);
        info!("Attached to session {} via {}", session_id, address);

        self.spawn_event_forwarder(session_id, &session);
        self.mark_live_session_status(session_id, SessionRuntimeStatus::Idle, None);
        self.sessions.insert(session_id.to_string(), session);
        self.session_endpoints
            .insert(session_id.to_string(), address.to_string());
        self.emit_status_change();
        Ok(attached_info(session_id, true))
    }

    /// Whether `session_id` is tracked (created, resumed, or attached).
    pub fn is_tracked(&self, session_id: &str) -> bool {
        self.sessions.contains_key(session_id)
    }

    /// IDs of sessions joined through [`Self::attach_session`], sorted.
    pub fn attached_session_ids(&self) -> Vec<String> {
        let mut ids: Vec<String> = self.session_endpoints.keys().cloned().collect();
        ids.sort();
        ids
    }

    /// Set [`LiveSessionHost::attached`] from the current attachments.
    pub fn mark_attached(&self, hosts: &mut [LiveSessionHost]) {
        for host in hosts {
            host.attached = self.session_endpoints.contains_key(&host.session_id);
        }
    }

    /// Attached sessions that `hosts` shows are no longer served where
    /// TracePilot joined them.
    pub fn stale_attachments(&self, hosts: &[LiveSessionHost]) -> Vec<String> {
        hosts
            .iter()
            .filter(|host| self.is_stale(host))
            .map(|host| host.session_id.clone())
            .collect()
    }

    /// Whether any event stream ended on its own and awaits pruning.
    pub fn has_finished_sessions(&self) -> bool {
        self.event_tasks.values().any(|handle| handle.is_finished())
    }

    fn is_stale(&self, host: &LiveSessionHost) -> bool {
        self.session_endpoints
            .get(&host.session_id)
            .is_some_and(|address| {
                host.state != LiveHostState::Attachable
                    || host.address.as_deref() != Some(address.as_str())
            })
    }

    /// Drop attachments whose hosting endpoint no longer serves the session,
    /// given freshly located hosts. The session keeps running wherever it is;
    /// TracePilot just stops observing it. Returns the IDs that were dropped.
    pub async fn reconcile_attachments(&mut self, hosts: &[LiveSessionHost]) -> Vec<String> {
        let mut dropped = Vec::new();
        for host in hosts {
            if !self.is_stale(host) {
                continue;
            }
            info!(
                "Hosting endpoint for {} is gone ({:?}); detaching",
                host.session_id, host.state
            );
            self.drop_attachment(&host.session_id, HOST_GONE_MESSAGE)
                .await;
            dropped.push(host.session_id.clone());
        }
        let pruned = self.prune_finished_sessions().await;
        dropped.extend(pruned);
        if !dropped.is_empty() {
            self.emit_status_change();
        }
        dropped
    }

    /// Untrack sessions whose event stream ended on its own (the forwarder
    /// already published a terminal live-state snapshot). Returns their IDs.
    pub(super) async fn prune_finished_sessions(&mut self) -> Vec<String> {
        let finished: Vec<String> = self
            .event_tasks
            .iter()
            .filter(|(_, handle)| handle.is_finished())
            .map(|(id, _)| id.clone())
            .collect();
        for session_id in &finished {
            debug!("Pruning session {} (event stream ended)", session_id);
            self.event_tasks.remove(session_id);
            self.sessions.remove(session_id);
            self.release_endpoint_for(session_id).await;
            self.live_state.remove(session_id);
        }
        finished
    }

    /// Detach from a session whose host went away: bounded best-effort
    /// `detach`, one terminal snapshot carrying `reason`, then untrack.
    async fn drop_attachment(&mut self, session_id: &str, reason: &str) {
        if let Some(Err(e)) = self.detach_tracked(session_id).await {
            debug!("Detach from stale host for {} failed: {}", session_id, e);
        }
        self.mark_existing_session_status(
            session_id,
            SessionRuntimeStatus::Shutdown,
            Some(reason.to_string()),
        );
        self.live_state.remove(session_id);
    }

    /// Forget which endpoint hosts `session_id`, stopping that endpoint's
    /// client when no other attached session uses it.
    pub(super) async fn release_endpoint_for(&mut self, session_id: &str) {
        if let Some(address) = self.session_endpoints.remove(session_id) {
            self.stop_endpoint_if_unused(&address).await;
        }
    }

    async fn stop_endpoint_if_unused(&mut self, address: &str) {
        if self.session_endpoints.values().any(|a| a == address) {
            return;
        }
        if let Some(client) = self.endpoints.remove(address) {
            match tokio::time::timeout(ENDPOINT_STOP_TIMEOUT, client.stop()).await {
                Ok(Ok(())) => debug!("Closed live endpoint {}", address),
                Ok(Err(e)) => debug!("Closing live endpoint {} reported: {}", address, e),
                Err(_) => {
                    warn!("Timed out closing live endpoint {}", address);
                    client.force_stop();
                }
            }
        }
    }

    /// Stop every endpoint client (used by `disconnect`).
    pub(super) async fn stop_all_endpoints(&mut self) {
        self.session_endpoints.clear();
        let addresses: Vec<String> = self.endpoints.keys().cloned().collect();
        for address in addresses {
            self.stop_endpoint_if_unused(&address).await;
        }
    }

    async fn endpoint_client(
        &mut self,
        address: &str,
    ) -> Result<github_copilot_sdk::Client, BridgeError> {
        if let Some(client) = self.endpoints.get(address) {
            return Ok(client.clone());
        }
        let config = BridgeConnectConfig {
            cli_url: Some(address.to_string()),
            cwd: None,
            log_level: None,
            github_token: None,
        };
        let client = tokio::time::timeout(
            ENDPOINT_CONNECT_TIMEOUT,
            sdk_client::start_client(&config, None),
        )
        .await
        .map_err(|_| {
            BridgeError::Timeout(format!("connecting to Copilot CLI server at {address}"))
        })??;
        info!("Connected to live endpoint {}", address);
        self.endpoints.insert(address.to_string(), client.clone());
        Ok(client)
    }
}

/// Observer resume on a hosting endpoint, retrying while the host warms up.
async fn resume_on_host(
    client: &github_copilot_sdk::Client,
    session_id: &str,
) -> Result<SdkSession, BridgeError> {
    let started = Instant::now();
    loop {
        match resume_observer(client, session_id, None, None).await {
            Err(BridgeError::Sdk(message))
                if is_session_not_found(&message) && started.elapsed() < HOST_WARMUP_WINDOW =>
            {
                debug!("Host has not loaded {} yet; retrying", session_id);
                tokio::time::sleep(HOST_WARMUP_RETRY).await;
            }
            result => return result,
        }
    }
}

fn is_session_not_found(message: &str) -> bool {
    message.to_ascii_lowercase().contains("session not found")
}

fn attached_info(session_id: &str, is_remote: bool) -> BridgeSessionInfo {
    BridgeSessionInfo {
        session_id: session_id.to_string(),
        model: None,
        working_directory: None,
        mode: None,
        is_active: true,
        resume_error: None,
        is_remote,
    }
}
