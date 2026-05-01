use super::default_tracepilot_home;
use super::defaults::default_templates;
use super::storage::{save_template_in, templates_dir_in};
use super::validation::validate_template_id;
use crate::error::{OrchestratorError, Result};
use crate::types::SessionTemplate;
use std::path::Path;

/// Increment usage count for a template.
/// For default templates that haven't been saved yet, creates a user override.
pub fn increment_usage(id: &str) -> Result<()> {
    increment_usage_in(&default_tracepilot_home()?, id)
}

pub fn increment_usage_in(tracepilot_home: &Path, id: &str) -> Result<()> {
    validate_template_id(id)?;

    let dir = templates_dir_in(tracepilot_home)?;
    let path = dir.join(format!("{id}.json"));

    let mut template: SessionTemplate = if path.exists() {
        let content = std::fs::read_to_string(&path)?;
        serde_json::from_str(&content)?
    } else {
        match default_templates().into_iter().find(|t| t.id == id) {
            Some(t) => t,
            None => {
                return Err(OrchestratorError::NotFound(format!(
                    "Template not found: {id}"
                )));
            }
        }
    };

    template.usage_count += 1;
    save_template_in(tracepilot_home, &template)?;
    Ok(())
}
