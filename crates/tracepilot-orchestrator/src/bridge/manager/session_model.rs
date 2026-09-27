//! `set_session_model` — change the active model for a session.
//!
//! The community SDK sent a snake_case method name that the CLI rejected, so
//! TCP mode used to bypass it with a raw JSON-RPC client. The official SDK
//! (ADR-0015) sends `session.model.switchTo` correctly in every mode.

use super::BridgeManager;
use crate::bridge::BridgeError;
use github_copilot_sdk::SetModelOptions;
use tracing::info;

impl BridgeManager {
    /// Change the model (and optionally the reasoning effort) for a session.
    pub fn set_session_model(
        &self,
        session_id: &str,
        model: &str,
        reasoning_effort: Option<String>,
    ) -> impl std::future::Future<Output = Result<(), BridgeError>> + Send + use<> {
        let session = self.require_session(session_id).cloned();
        let scope = self
            .session_scopes
            .get(session_id)
            .cloned()
            .unwrap_or_else(|| self.connection_scope.clone());
        let session_id = session_id.to_string();
        let model = model.to_string();
        async move {
            scope
                .run("set_session_model", async move {
                    let session = session?;
                    info!("Setting model for session {} to '{}'", session_id, model);
                    let opts = reasoning_effort
                        .map(|effort| SetModelOptions::default().with_reasoning_effort(effort));
                    session
                        .set_model(&model, opts)
                        .await
                        .map_err(BridgeError::sdk)
                })
                .await
        }
    }
}
