//! Session creation and resume: reserve, perform I/O, publish if still current.
use super::SharedBridgeManager;
use super::requests::{CLEANUP_TIMEOUT, RequestScope, bounded};
use super::session_tasks::{resume_observer, sdk_session_config};
use crate::bridge::{
    BridgeError, BridgeSessionConfig, BridgeSessionInfo, ConnectionMode, SessionRuntimeStatus,
};
use std::sync::Arc;

impl SharedBridgeManager {
    /// Create without a permission handler: the runtime denies tool permission
    /// requests unless another connected client answers them.
    pub async fn create_session(
        &self,
        config: BridgeSessionConfig,
    ) -> Result<BridgeSessionInfo, BridgeError> {
        self.create_launcher_session(config, false).await
    }

    /// Install approval handling only when the launcher has explicit consent.
    pub async fn create_launcher_session(
        &self,
        config: BridgeSessionConfig,
        auto_approve: bool,
    ) -> Result<BridgeSessionInfo, BridgeError> {
        let (client, scope) = {
            let mgr = self.read().await;
            mgr.check_preference_enabled()?;
            (mgr.require_client()?.clone(), mgr.connection_scope.clone())
        };
        let session = scope
            .run("creating SDK session", async {
                client
                    .create_session(sdk_session_config(&config, auto_approve))
                    .await
                    .map_err(BridgeError::sdk)
            })
            .await?;
        let mut mgr = self.write().await;
        if let Err(error) = scope.check() {
            drop(mgr);
            discard_session(session).await;
            return Err(error);
        }
        let id = session.id().to_string();
        mgr.session_scopes.insert(id, RequestScope::default());
        Ok(mgr.track_created_session(Arc::new(session), config))
    }

    /// Join as a handler-less observer, leaving prompts and streaming choices
    /// with the owning terminal. Per-session serialization avoids duplicate
    /// resume events when callers join concurrently.
    pub async fn resume_session(
        &self,
        id: &str,
        cwd: Option<&str>,
        model: Option<&str>,
    ) -> Result<BridgeSessionInfo, BridgeError> {
        let (client, connection, scope, foreground) = {
            let mut mgr = self.write().await;
            if let Some(info) = mgr.cached_session_info(id, cwd, model)? {
                return Ok(info);
            }
            mgr.check_preference_enabled()?;
            let client = mgr.require_client()?.clone();
            mgr.connection_scope.check()?;
            let scope = mgr
                .session_scopes
                .entry(id.to_string())
                .or_default()
                .clone();
            scope.check()?;
            (
                client,
                mgr.connection_scope.clone(),
                scope,
                mgr.connection_mode == Some(ConnectionMode::Tcp),
            )
        };
        let waiting = connection
            .run(
                "waiting to resume SDK session",
                scope.run("waiting to resume SDK session", async {
                    Ok(self.session_gate(id).await)
                }),
            )
            .await;
        let _gate = match waiting {
            Ok(gate) => gate,
            Err(error) => {
                self.abandon_session(id, &scope).await;
                return Err(error);
            }
        };
        // Another concurrent join may have published while this request waited.
        if let Some(info) = self.read().await.cached_session_info(id, cwd, model)? {
            return Ok(info);
        }
        let resumed = connection
            .run(
                "resuming SDK session",
                scope.run(
                    "resuming SDK session",
                    resume_observer(&client, id, cwd, model),
                ),
            )
            .await;
        let session = match resumed {
            Ok(session) => session,
            Err(error) => {
                self.abandon_session(id, &scope).await;
                return Err(error);
            }
        };
        let mut mgr = self.write().await;
        if let Err(error) = connection.check().and_then(|()| scope.check()) {
            drop(mgr);
            discard_session(session).await;
            self.abandon_session(id, &scope).await;
            return Err(error);
        }
        let session = Arc::new(session);
        mgr.spawn_event_forwarder(id, &session);
        mgr.mark_live_session_status(id, SessionRuntimeStatus::Idle, None);
        mgr.sessions.insert(id.to_string(), session);
        let info = super::attach::attached_info(id, false);
        drop(mgr);
        if foreground {
            let _ = connection
                .run(
                    "setting foreground session",
                    scope.run("setting foreground session", async {
                        client
                            .set_foreground_session_id(&github_copilot_sdk::SessionId::new(id))
                            .await
                            .map_err(BridgeError::sdk)
                    }),
                )
                .await;
        }
        connection.check()?;
        scope.check()?;
        Ok(info)
    }
    pub(super) async fn abandon_session(&self, id: &str, scope: &RequestScope) {
        let mut mgr = self.write().await;
        if !mgr.sessions.contains_key(id)
            && mgr
                .session_scopes
                .get(id)
                .is_some_and(|current| current.same(scope))
        {
            scope.cancel();
            mgr.session_scopes.remove(id);
        }
    }
}

impl super::BridgeManager {
    pub(super) fn cached_session_info(
        &self,
        id: &str,
        cwd: Option<&str>,
        model: Option<&str>,
    ) -> Result<Option<BridgeSessionInfo>, BridgeError> {
        if !self.sessions.contains_key(id) {
            return Ok(None);
        }
        if let Some(scope) = self.session_scopes.get(id) {
            scope.check()?;
        }
        if self.get_session_state(id).is_none() {
            self.mark_live_session_status(id, SessionRuntimeStatus::Idle, None);
        }
        let mut info = super::attach::attached_info(id, self.session_endpoints.contains_key(id));
        info.model = model.map(String::from);
        info.working_directory = cwd.map(String::from);
        Ok(Some(info))
    }
}

pub(super) async fn discard_session(session: super::sdk_client::SdkSession) {
    let _ = bounded(CLEANUP_TIMEOUT, "discarding stale SDK session", async {
        session.disconnect().await.map_err(BridgeError::sdk)
    })
    .await;
}
