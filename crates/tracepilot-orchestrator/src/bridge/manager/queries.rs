//! Read-only client queries on [`BridgeManager`]: list sessions/models, quota,
//! auth, and CLI status. Split out of the main session steering file to keep
//! each submodule's line-count budget in check (Wave 44).

use super::BridgeManager;
use crate::bridge::BridgeQuotaSnapshot;
use crate::bridge::registry::{RecoveryDecision, RegistryRecord};
use crate::bridge::{
    BridgeAuthStatus, BridgeError, BridgeHydrationSnapshot, BridgeModelInfo, BridgeQuota,
    BridgeSessionInfo, BridgeStatus, SessionLiveState,
};

impl BridgeManager {
    /// Return sessions currently tracked by this manager.
    pub fn tracked_sessions(&self) -> Vec<BridgeSessionInfo> {
        self.sessions
            .keys()
            .map(|session_id| BridgeSessionInfo {
                session_id: session_id.clone(),
                model: None,
                working_directory: None,
                mode: None,
                is_active: true,
                resume_error: None,
                is_remote: false,
            })
            .collect()
    }

    /// Return a no-side-effect snapshot for renderer hydration after reload.
    pub fn hydrate(&self) -> BridgeHydrationSnapshot {
        self.mark_stale_registry_sessions_unknown();
        let (registry_sessions, recovery) = match self
            .with_registry(|registry| Ok((registry.list()?, registry.recovery_decisions()?)))
        {
            Ok(Some(snapshot)) => snapshot,
            Ok(None) => (Vec::new(), Vec::new()),
            Err(err) => {
                tracing::warn!(error = %err, "Failed to read SDK registry during hydrate");
                (Vec::new(), Vec::new())
            }
        };
        BridgeHydrationSnapshot {
            status: self.status(),
            sessions: self.tracked_sessions(),
            metrics: self.metrics_snapshot(),
            session_states: self.live_state.list(),
            registry_sessions,
            recovery,
        }
    }

    pub fn get_session_state(&self, session_id: &str) -> Option<SessionLiveState> {
        self.live_state.get(session_id)
    }

    pub fn list_session_states(&self) -> Vec<SessionLiveState> {
        self.live_state.list()
    }

    /// List all sessions known to the SDK client.
    /// Sessions that have been resumed locally are marked `is_active: true`.
    /// Others are listed from the CLI's session metadata (may not be resumable).
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

    /// Get quota information.
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

    /// Get authentication status.
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

    /// Get SDK / CLI version info.
    pub async fn get_cli_status(&self) -> Result<BridgeStatus, BridgeError> {
        let client = self.require_client()?;
        let result = client
            .get_status()
            .await
            .map_err(|e| BridgeError::Sdk(e.to_string()))?;

        Ok(BridgeStatus {
            state: self.state,
            sdk_available: true,
            enabled_by_preference: self.is_enabled_by_preference(),
            cli_version: Some(result.version),
            protocol_version: Some(result.protocol_version),
            active_sessions: self.sessions.len(),
            error: self.error_message.clone(),
            connection_mode: self.connection_mode,
        })
    }

    /// List available models.
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

    pub fn list_registry_sessions(&self) -> Result<Vec<RegistryRecord>, BridgeError> {
        match self.with_registry(|registry| registry.list()) {
            Ok(Some(records)) => Ok(records),
            Ok(None) => Ok(Vec::new()),
            Err(err) => Err(err),
        }
    }

    pub fn registry_recovery_decisions(&self) -> Result<Vec<RecoveryDecision>, BridgeError> {
        self.mark_stale_registry_sessions_unknown();
        match self.with_registry(|registry| registry.recovery_decisions()) {
            Ok(Some(decisions)) => Ok(decisions),
            Ok(None) => Ok(Vec::new()),
            Err(err) => Err(err),
        }
    }

    pub fn forget_registry_session(&self, session_id: &str) -> Result<bool, BridgeError> {
        match self.with_registry(|registry| registry.forget(session_id)) {
            Ok(Some(forgotten)) => Ok(forgotten),
            Ok(None) => Ok(false),
            Err(err) => Err(err),
        }
    }

    pub fn prune_registry(&self, older_than_days: i64) -> Result<usize, BridgeError> {
        match self
            .with_registry(|registry| registry.prune_terminal_older_than_days(older_than_days))
        {
            Ok(Some(pruned)) => Ok(pruned),
            Ok(None) => Ok(0),
            Err(err) => Err(err),
        }
    }
}
