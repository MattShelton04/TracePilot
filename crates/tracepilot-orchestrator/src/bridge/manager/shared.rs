//! Runtime entry points: never await SDK work while holding the manager lock.
use super::requests::{CLEANUP_TIMEOUT, RequestScope, bounded, stop_client};
use super::sdk_client::{requested_connection_mode, start_client};
use super::{BridgeManager, SharedBridgeManager};
use crate::bridge::{
    BridgeConnectConfig, BridgeConnectionState, BridgeError, SessionRuntimeStatus,
};
use std::sync::Arc;
use tokio::sync::{Mutex, OwnedMutexGuard};

#[derive(Clone, PartialEq, Eq, Hash)]
pub(super) enum GateKey {
    Session(String),
    Endpoint(String),
}

impl SharedBridgeManager {
    pub(super) async fn session_gate(&self, id: &str) -> OwnedMutexGuard<()> {
        self.gate(GateKey::Session(id.to_string())).await
    }

    pub(super) async fn endpoint_gate(&self, address: &str) -> OwnedMutexGuard<()> {
        self.gate(GateKey::Endpoint(address.to_string())).await
    }

    async fn gate(&self, key: GateKey) -> OwnedMutexGuard<()> {
        let gate = {
            let mut mgr = self.write().await;
            mgr.gates.retain(|_, gate| gate.strong_count() > 0);
            match mgr.gates.get(&key).and_then(std::sync::Weak::upgrade) {
                Some(gate) => gate,
                None => {
                    let gate = Arc::new(Mutex::new(()));
                    mgr.gates.insert(key, Arc::downgrade(&gate));
                    gate
                }
            }
        };
        gate.lock_owned().await
    }

    pub async fn connect(&self, config: BridgeConnectConfig) -> Result<(), BridgeError> {
        let (scope, home) = {
            let mut mgr = self.write().await;
            mgr.connection_scope.check()?;
            if mgr.state == BridgeConnectionState::Connected {
                return if mgr.is_same_connection_config(&config) {
                    Ok(())
                } else {
                    Err(BridgeError::AlreadyConnected)
                };
            }
            if mgr.state == BridgeConnectionState::Connecting {
                return Err(BridgeError::AlreadyConnected);
            }
            mgr.check_preference_enabled()?;
            mgr.state = BridgeConnectionState::Connecting;
            mgr.error_message = None;
            mgr.connection_mode = Some(requested_connection_mode(&config));
            mgr.cli_url = config.cli_url.clone();
            mgr.connection_cwd = config.cwd.clone();
            (
                mgr.connection_scope.clone(),
                mgr.copilot_home_reader.as_ref().and_then(|r| r()),
            )
        };
        let result = scope
            .run(
                "connecting SDK client",
                start_client(&config, home.as_deref()),
            )
            .await;
        let mut mgr = self.write().await;
        if let Err(cancelled) = scope.check() {
            drop(mgr);
            if let Ok(client) = result {
                stop_client(client).await;
            }
            return Err(cancelled);
        }
        match result {
            Ok(client) => {
                mgr.client = Some(client);
                mgr.state = BridgeConnectionState::Connected;
            }
            Err(error) => {
                mgr.state = BridgeConnectionState::Error;
                mgr.error_message = Some(error.to_string());
                mgr.emit_status_change();
                return Err(error);
            }
        }
        mgr.emit_status_change();
        Ok(())
    }

    /// Cancel pending work, detach sessions, then stop transports. `keep_live`
    /// preserves terminal attachments and their independent request scopes.
    pub async fn disconnect(&self, keep_live: bool) -> Result<(), BridgeError> {
        let _teardown = self.teardown.lock().await;
        let (ids, client, endpoints, teardown_scope) = {
            let mut mgr = self.write().await;
            // Invalidate pending creates/resumes/queries before any cleanup awaits.
            mgr.connection_scope.cancel();
            let teardown_scope = RequestScope::default();
            teardown_scope.cancel();
            mgr.connection_scope = teardown_scope.clone();
            if !keep_live {
                mgr.attachment_scope.cancel();
            }
            let ids: Vec<_> = mgr
                .sessions
                .keys()
                .filter(|id| !keep_live || !mgr.session_endpoints.contains_key(*id))
                .cloned()
                .collect();
            for (id, scope) in &mgr.session_scopes {
                if !keep_live || ids.contains(id) {
                    scope.cancel();
                }
            }
            let endpoints = if keep_live {
                Vec::new()
            } else {
                mgr.session_endpoints.clear();
                mgr.endpoints.drain().map(|(_, c)| c).collect()
            };
            (ids, mgr.client.take(), endpoints, teardown_scope)
        };
        // Clean up sessions concurrently: N stalled peers cost one deadline, not N.
        let mut cleanup = tokio::task::JoinSet::new();
        for id in ids {
            let bridge = self.clone();
            cleanup.spawn(async move {
                let _ = bridge.detach_session(&id, None).await;
            });
        }
        while cleanup.join_next().await.is_some() {}
        let mut stops = tokio::task::JoinSet::new();
        for client in client.into_iter().chain(endpoints) {
            stops.spawn(stop_client(client));
        }
        while stops.join_next().await.is_some() {}
        let mut mgr = self.write().await;
        if !mgr.connection_scope.same(&teardown_scope) {
            return Ok(());
        }
        mgr.connection_scope = RequestScope::default();
        if !keep_live {
            mgr.attachment_scope = RequestScope::default();
            mgr.live_state.clear();
        }
        mgr.state = BridgeConnectionState::Disconnected;
        mgr.error_message = None;
        mgr.connection_mode = None;
        mgr.cli_url = None;
        mgr.connection_cwd = None;
        mgr.emit_status_change();
        Ok(())
    }

    /// Release the SDK attachment and emit a terminal snapshot. History and
    /// the terminal's session survive even when detach fails or times out.
    pub async fn destroy_session(&self, id: &str) -> Result<(), BridgeError> {
        self.detach_session(id, Some(None)).await
    }

    /// Release the attachment without emitting a terminal snapshot.
    pub async fn unlink_session(&self, id: &str) {
        let _ = self.detach_session(id, None).await;
    }

    pub(super) async fn detach_session(
        &self,
        id: &str,
        terminal_error: Option<Option<String>>,
    ) -> Result<(), BridgeError> {
        self.detach_if_current(id, terminal_error, None)
            .await
            .map(|_| ())
    }

    pub(super) async fn detach_if_current(
        &self,
        id: &str,
        terminal_error: Option<Option<String>>,
        expected: Option<RequestScope>,
    ) -> Result<bool, BridgeError> {
        // Cancel even an in-flight resume before waiting for its session gate.
        {
            let mgr = self.read().await;
            if expected
                .as_ref()
                .is_some_and(|old| !mgr.session_scopes.get(id).is_some_and(|s| old.same(s)))
            {
                return Ok(false);
            }
            if let Some(scope) = mgr.session_scopes.get(id) {
                scope.cancel();
            }
        }
        let _gate = self.session_gate(id).await;
        let address = self.read().await.session_endpoints.get(id).cloned();
        let _endpoint_gate = if let Some(address) = address {
            Some(self.endpoint_gate(&address).await)
        } else {
            None
        };
        let (session, forwarder, endpoint) = {
            let mut mgr = self.write().await;
            if expected
                .as_ref()
                .is_some_and(|old| !mgr.session_scopes.get(id).is_some_and(|s| old.same(s)))
            {
                return Ok(false);
            }
            if let Some(scope) = mgr.session_scopes.remove(id) {
                scope.cancel();
            }
            let session = mgr.sessions.remove(id);
            let forwarder = mgr.event_tasks.remove(id);
            if let Some(task) = &forwarder {
                task.abort();
            }
            let endpoint = mgr.take_unused_endpoint(id);
            (session, forwarder, endpoint)
        };
        if let Some(task) = forwarder {
            let _ = task.await;
        }
        {
            let mgr = self.write().await;
            if let Some(error) = terminal_error {
                mgr.mark_existing_session_status(id, SessionRuntimeStatus::Shutdown, error);
            }
            mgr.live_state.remove(id);
        }
        let result = if let Some(session) = session {
            bounded(CLEANUP_TIMEOUT, "detaching SDK session", async {
                session.disconnect().await.map_err(BridgeError::sdk)
            })
            .await
        } else {
            Ok(())
        };
        if let Some(client) = endpoint {
            stop_client(client).await;
        }
        result.map(|()| true)
    }
}

impl BridgeManager {
    pub(super) fn take_unused_endpoint(&mut self, id: &str) -> Option<github_copilot_sdk::Client> {
        let address = self.session_endpoints.remove(id)?;
        if self.session_endpoints.values().any(|a| a == &address) {
            return None;
        }
        self.endpoints.remove(&address)
    }
}
