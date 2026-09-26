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
    pub async fn set_session_model(
        &self,
        session_id: &str,
        model: &str,
        reasoning_effort: Option<String>,
    ) -> Result<(), BridgeError> {
        let session = self.require_session(session_id)?;
        info!("Setting model for session {} to '{}'", session_id, model);
        let opts =
            reasoning_effort.map(|effort| SetModelOptions::default().with_reasoning_effort(effort));
        session
            .set_model(model, opts)
            .await
            .map_err(BridgeError::sdk)
    }
}
