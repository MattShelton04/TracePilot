//! Live attachment work runs outside the manager; per-session/endpoint gates
//! preserve idempotent observer joins and prevent detach racing a new join.
use super::attach::{HOST_GONE_MESSAGE, attached_info, resume_on_host};
use super::requests::{RequestScope, bounded, stop_client};
use super::{SharedBridgeManager, sdk_client};
use crate::bridge::{
    BridgeConnectConfig, BridgeError, BridgeSessionInfo, LiveSessionHost, SessionRuntimeStatus,
};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

/// Identity of attachments when a host probe begins. Later probes cannot
/// detach an attachment created while their process/port lookup was running.
pub struct AttachmentSnapshot(HashMap<String, RequestScope>);

impl SharedBridgeManager {
    pub async fn attach_session(
        &self,
        id: &str,
        address: &str,
    ) -> Result<BridgeSessionInfo, BridgeError> {
        let attachment = self.read().await.attachment_scope.clone();
        attachment.check()?;
        self.reconcile_attachments(&[], self.attachment_snapshot().await)
            .await;
        let scope = {
            let mut mgr = self.write().await;
            if let Some(info) = mgr.cached_session_info(id, None, None)? {
                return Ok(info);
            }
            mgr.check_preference_enabled()?;
            attachment.check()?;
            let scope = mgr
                .session_scopes
                .entry(id.to_string())
                .or_default()
                .clone();
            scope.check()?;
            scope
        };
        let waiting = attachment
            .run(
                "waiting to attach SDK session",
                scope.run("waiting to attach SDK session", async {
                    let gate = self.session_gate(id).await;
                    let endpoint = self.endpoint_gate(address).await;
                    Ok((gate, endpoint))
                }),
            )
            .await;
        let (_gate, _endpoint_gate) = match waiting {
            Ok(gates) => gates,
            Err(error) => {
                self.abandon_session(id, &scope).await;
                return Err(error);
            }
        };
        let existing = {
            let mgr = self.read().await;
            if let Some(info) = mgr.cached_session_info(id, None, None)? {
                return Ok(info);
            }
            mgr.endpoints.get(address).cloned()
        };
        let is_new = existing.is_none();
        let client = if let Some(client) = existing {
            client
        } else {
            let config = BridgeConnectConfig {
                cli_url: Some(address.to_string()),
                cwd: None,
                log_level: None,
                github_token: None,
            };
            let connected = attachment
                .run(
                    "connecting live endpoint",
                    scope.run(
                        "connecting live endpoint",
                        bounded(
                            Duration::from_secs(5),
                            "connecting live endpoint",
                            sdk_client::start_client(&config, None),
                        ),
                    ),
                )
                .await;
            match connected {
                Ok(client) => client,
                Err(error) => {
                    self.abandon_session(id, &scope).await;
                    return Err(error);
                }
            }
        };
        let resumed = attachment
            .run(
                "attaching SDK session",
                scope.run("attaching SDK session", resume_on_host(&client, id)),
            )
            .await;
        let session = match resumed {
            Ok(session) => session,
            Err(error) => {
                self.abandon_session(id, &scope).await;
                let unused = {
                    let mut mgr = self.write().await;
                    if mgr.session_endpoints.values().any(|a| a == address) {
                        None
                    } else {
                        mgr.endpoints.remove(address)
                    }
                };
                if is_new {
                    stop_client(client).await;
                } else if let Some(client) = unused {
                    stop_client(client).await;
                }
                return Err(error);
            }
        };
        let mut mgr = self.write().await;
        if let Err(error) = attachment.check().and_then(|()| scope.check()) {
            drop(mgr);
            super::shared_sessions::discard_session(session).await;
            self.abandon_session(id, &scope).await;
            if is_new {
                stop_client(client).await;
            }
            return Err(error);
        }
        mgr.endpoints.insert(address.to_string(), client);
        let session = Arc::new(session);
        mgr.spawn_event_forwarder(id, &session);
        mgr.mark_live_session_status(id, SessionRuntimeStatus::Idle, None);
        mgr.sessions.insert(id.to_string(), session);
        mgr.session_endpoints
            .insert(id.to_string(), address.to_string());
        mgr.emit_status_change();
        Ok(attached_info(id, true))
    }

    pub async fn attachment_snapshot(&self) -> AttachmentSnapshot {
        AttachmentSnapshot(self.read().await.session_scopes.clone())
    }

    pub async fn reconcile_attachments(
        &self,
        hosts: &[LiveSessionHost],
        snapshot: AttachmentSnapshot,
    ) -> Vec<String> {
        let mut dropped = Vec::new();
        let stale = self.read().await.stale_attachments(hosts);
        for id in stale {
            if let Some(scope) = snapshot.0.get(&id) {
                let detached = self
                    .detach_if_current(
                        &id,
                        Some(Some(HOST_GONE_MESSAGE.to_string())),
                        Some(scope.clone()),
                    )
                    .await;
                if !matches!(detached, Ok(false)) {
                    dropped.push(id);
                }
            }
        }
        let finished: Vec<_> = self
            .read()
            .await
            .event_tasks
            .iter()
            .filter(|(_, task)| task.is_finished())
            .map(|(id, _)| id.clone())
            .collect();
        for id in finished {
            if let Some(scope) = snapshot.0.get(&id) {
                let detached = self.detach_if_current(&id, None, Some(scope.clone())).await;
                if !matches!(detached, Ok(false)) {
                    dropped.push(id);
                }
            }
        }
        if !dropped.is_empty() {
            self.read().await.emit_status_change();
        }
        dropped
    }
}
