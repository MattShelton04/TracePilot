use crate::error::{OrchestratorError, Result};

/// Maximum size for a single template JSON file (1 MB).
pub(super) const MAX_TEMPLATE_SIZE: u64 = 1_048_576;

pub(super) const DISMISSED_DEFAULTS_ID: &str = "dismissed_defaults";

/// Validate a template ID to prevent path traversal attacks.
/// IDs must be non-empty and contain only alphanumeric characters, hyphens, and underscores.
pub(super) fn validate_template_id(id: &str) -> Result<()> {
    crate::validation::validate_identifier(id, crate::validation::TEMPLATE_ID_RULES, "Template ID")
        .map_err(OrchestratorError::NotFound)
}

pub(super) fn reject_reserved_template_id(id: &str) -> Result<()> {
    if id == DISMISSED_DEFAULTS_ID {
        return Err(OrchestratorError::NotFound(
            "Template ID 'dismissed_defaults' is reserved".into(),
        ));
    }

    Ok(())
}
