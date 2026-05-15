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

/// List available models.
///
/// Keep in sync with the TypeScript model registry at
/// `packages/types/src/models.ts → MODEL_REGISTRY`.
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
}
