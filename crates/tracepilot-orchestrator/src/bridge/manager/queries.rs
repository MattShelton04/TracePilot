//! Read-only client queries on [`BridgeManager`]: list sessions/models, quota,
//! auth, and CLI status. Split out of the main session steering file to keep
//! each submodule's line-count budget in check (Wave 44).

use super::BridgeManager;
use crate::bridge::BridgeQuotaSnapshot;
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
        BridgeHydrationSnapshot {
            status: self.status(),
            sessions: self.tracked_sessions(),
            metrics: self.metrics_snapshot(),
            session_states: self.live_state.list(),
        }
    }

    pub fn get_session_state(&self, session_id: &str) -> Option<SessionLiveState> {
        self.live_state.get(session_id)
    }

    pub fn list_session_states(&self) -> Vec<SessionLiveState> {
        self.live_state.list()
    }

    /// List sessions currently tracked by this bridge process.
    ///
    /// The SDK client's `list_sessions()` returns the user's full Copilot CLI
    /// history from disk, which is useful for a future explicit "browse and
    /// resume" picker but wrong for runtime/process visibility.
    pub async fn list_sessions(&self) -> Result<Vec<BridgeSessionInfo>, BridgeError> {
        self.require_client()?;
        Ok(self.tracked_sessions())
    }

    /// Get quota information.
    pub async fn get_quota(&self) -> Result<BridgeQuota, BridgeError> {
        let client = self.require_client()?;
        let result = client
            .get_quota()
            .await
            .map_err(BridgeError::sdk)?;

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
            .map_err(BridgeError::sdk)?;

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
            .map_err(BridgeError::sdk)?;

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
            .map_err(BridgeError::sdk)?;

        Ok(models
            .into_iter()
            .map(|m| BridgeModelInfo {
                id: m.id,
                name: Some(m.name),
            })
            .collect())
    }
}
