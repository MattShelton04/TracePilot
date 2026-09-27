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
use super::sdk_client::SdkSession;
use super::session_tasks::resume_observer;
use crate::bridge::live_host::{LiveHostState, LiveSessionHost};
use crate::bridge::{BridgeError, BridgeSessionInfo};
use std::time::{Duration, Instant};
use tracing::debug;

/// A terminal that just started holds the session lock and listens on its
/// port shortly before it has loaded the session, so an early resume reports
/// "session not found". Retry for this long before giving up.
const HOST_WARMUP_WINDOW: Duration = Duration::from_secs(8);
const HOST_WARMUP_RETRY: Duration = Duration::from_millis(400);
/// Error recorded on the live state when the hosting terminal stops serving
/// the session (it exited, or switched to another session).
pub(crate) const HOST_GONE_MESSAGE: &str =
    "The terminal running this session closed, or switched to another session.";

impl BridgeManager {
    /// Whether `session_id` is tracked (created, resumed, or attached).
    pub fn is_tracked(&self, session_id: &str) -> bool {
        self.sessions.contains_key(session_id)
    }

    /// IDs of sessions joined through [`super::SharedBridgeManager::attach_session`], sorted.
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
}

/// Observer resume on a hosting endpoint, retrying while the host warms up.
pub(super) async fn resume_on_host(
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

pub(super) fn attached_info(session_id: &str, is_remote: bool) -> BridgeSessionInfo {
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
