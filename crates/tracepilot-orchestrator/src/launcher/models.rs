//! Model validation and listing helpers.

use crate::error::{OrchestratorError, Result};
use crate::models;
use crate::types::ModelInfo;

/// Validate a model ID against known models (defence-in-depth against injection).
pub(super) fn validate_model(model: &str) -> Result<()> {
    if models::is_known_model(model) {
        Ok(())
    } else {
        Err(OrchestratorError::Launch(format!("Unknown model: {model}")))
    }
}

/// Validate the CLI's supported reasoning-effort values before they are
/// interpolated into a platform-specific command line.
pub(super) fn validate_reasoning_effort(effort: &str) -> Result<()> {
    if !effort.is_empty()
        && effort
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
    {
        Ok(())
    } else {
        Err(OrchestratorError::Launch(format!(
            "Invalid reasoning effort: {effort}"
        )))
    }
}

/// List available models.
///
/// Backed by the shared JSON registry at
/// `packages/types/data/model-registry.json` — the same data consumed by the
/// TypeScript `MODEL_REGISTRY` in `packages/types/src/models.ts`.
pub fn available_models() -> Vec<ModelInfo> {
    models::available_models()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_available_models_not_empty() {
        let models = available_models();
        assert!(!models.is_empty());
        assert!(models.iter().any(|m| m.id == "claude-opus-4.6"));
    }

    #[test]
    fn test_validate_model_accepts_known() {
        assert!(validate_model("claude-opus-4.6").is_ok());
        assert!(validate_model("gpt-5.4").is_ok());
        assert!(validate_model("claude-haiku-4.5").is_ok());
    }

    #[test]
    fn test_validate_model_rejects_unknown() {
        assert!(validate_model("unknown-model").is_err());
        assert!(validate_model("'; rm -rf /").is_err());
        assert!(validate_model("& calc &").is_err());
    }

    #[test]
    fn test_validate_reasoning_effort_accepts_safe_current_and_future_values() {
        for effort in ["low", "medium", "high", "xhigh", "max", "extra-high"] {
            assert!(validate_reasoning_effort(effort).is_ok());
        }
        assert!(validate_reasoning_effort("").is_err());
        assert!(validate_reasoning_effort("very high").is_err());
        assert!(validate_reasoning_effort("high; touch /tmp/injected").is_err());
    }
}
