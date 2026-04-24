//! `set_session_model` — change the active model for a session, using a raw
//! JSON-RPC call in TCP (`--ui-server`) mode to work around an upstream
//! snake_case method-name bug. Split into its own submodule in Wave 44 to
//! keep `session_tasks.rs` under the 400-LOC cap.

use super::BridgeManager;
use super::raw_rpc::raw_rpc_call;
use crate::bridge::BridgeError;
use tracing::{info, warn};

impl BridgeManager {
    /// Change the model for a session.
    ///
    /// In TCP mode, sends a raw JSON-RPC call with the correct camelCase method
    /// name (`session.model.switchTo`). The upstream Rust SDK has a bug where it
    /// sends `session.model.switch_to` (snake_case) which the CLI doesn't recognize.
    /// See: docs/copilot-sdk-rpc-method-bug.md
    pub async fn set_session_model(
        &self,
        session_id: &str,
        model: &str,
        reasoning_effort: Option<String>,
    ) -> Result<(), BridgeError> {
        // TCP mode: bypass SDK with raw JSON-RPC using correct method name
        if let Some(url) = &self.cli_url {
            info!(
                "Setting model for session {} to '{}' via raw RPC (tcp: {})",
                session_id, model, url
            );

            let mut params = serde_json::json!({
                "sessionId": session_id,
                "modelId": model,
            });
            if let Some(effort) = &reasoning_effort {
                params["reasoningEffort"] = serde_json::json!(effort);
            }

            let result = raw_rpc_call(url, "session.model.switchTo", params).await?;
            info!("session.model.switchTo result: {}", result);

            // Verify the model actually changed
            let verify_params = serde_json::json!({ "sessionId": session_id });
            match raw_rpc_call(url, "session.model.getCurrent", verify_params).await {
                Ok(current) => {
                    let current_model = current
                        .get("modelId")
                        .and_then(|v| v.as_str())
                        .unwrap_or("<none>");
                    info!(
                        "session.model.getCurrent after switch: current='{}', requested='{}'",
                        current_model, model
                    );
                    if current_model != model && current_model != "<none>" {
                        warn!(
                            "Model switch may not have taken effect: requested '{}', current '{}'",
                            model, current_model
                        );
                    }
                }
                Err(e) => {
                    warn!("getCurrent verification failed (non-fatal): {}", e);
                }
            }

            return Ok(());
        }

        // Stdio mode: use SDK method (may fail with -32601 due to upstream bug)
        info!(
            "Setting model for session {} to '{}' via SDK (stdio)",
            session_id, model
        );
        let session = self.require_session(session_id)?;
        let opts = reasoning_effort.map(|re| copilot_sdk::SetModelOptions {
            reasoning_effort: Some(re),
        });
        session
            .set_model(model, opts)
            .await
            .map_err(|e| BridgeError::Sdk(e.to_string()))
    }
}
