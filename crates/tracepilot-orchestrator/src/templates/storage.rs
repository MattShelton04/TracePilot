use super::default_tracepilot_home;
use super::defaults::default_templates;
use super::dismissed::dismiss_default_template_in;
use super::validation::{
    DISMISSED_DEFAULTS_ID, MAX_TEMPLATE_SIZE, reject_reserved_template_id, validate_template_id,
};
use crate::error::{OrchestratorError, Result};
use crate::types::SessionTemplate;
use std::path::{Path, PathBuf};

/// Default templates storage path.
pub fn templates_dir() -> Result<PathBuf> {
    templates_dir_in(&default_tracepilot_home()?)
}

pub fn templates_dir_in(tracepilot_home: &Path) -> Result<PathBuf> {
    let dir = tracepilot_core::paths::TracePilotPaths::from_root(tracepilot_home).templates_dir();
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// List all saved templates.
pub fn list_templates() -> Result<Vec<SessionTemplate>> {
    let dir = templates_dir()?;
    list_templates_from_dir(&dir)
}

pub fn list_templates_in(tracepilot_home: &Path) -> Result<Vec<SessionTemplate>> {
    let dir = templates_dir_in(tracepilot_home)?;
    list_templates_from_dir(&dir)
}

fn list_templates_from_dir(dir: &Path) -> Result<Vec<SessionTemplate>> {
    let mut templates = Vec::new();

    if !dir.exists() {
        return Ok(templates);
    }

    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }

        // Skip the dismissed_defaults metadata file.
        if path.file_stem().and_then(|s| s.to_str()) == Some(DISMISSED_DEFAULTS_ID) {
            continue;
        }

        // Reject unreasonably large template files to prevent DoS.
        match std::fs::metadata(&path) {
            Ok(meta) if meta.len() > MAX_TEMPLATE_SIZE => {
                tracing::warn!(
                    "Skipping oversized template file ({} bytes): {}",
                    meta.len(),
                    path.display()
                );
                continue;
            }
            Err(e) => {
                tracing::warn!(
                    "Cannot read metadata for template file {}: {}",
                    path.display(),
                    e
                );
                continue;
            }
            _ => {}
        }

        let content = std::fs::read_to_string(&path)?;
        match serde_json::from_str::<SessionTemplate>(&content) {
            Ok(template) => templates.push(template),
            Err(e) => {
                tracing::warn!("Failed to parse template {}: {}", path.display(), e);
            }
        }
    }

    templates.sort_by(|a, b| b.usage_count.cmp(&a.usage_count));
    Ok(templates)
}

/// Save a new template.
pub fn save_template(template: &SessionTemplate) -> Result<()> {
    save_template_in(&default_tracepilot_home()?, template)
}

pub fn save_template_in(tracepilot_home: &Path, template: &SessionTemplate) -> Result<()> {
    validate_template_id(&template.id)?;
    reject_reserved_template_id(&template.id)?;

    let dir = templates_dir_in(tracepilot_home)?;
    let path = dir.join(format!("{}.json", template.id));
    let temp = dir.join(format!(".{}.json.tmp", template.id));

    let content = serde_json::to_string_pretty(template)?;
    std::fs::write(&temp, &content)?;
    std::fs::rename(&temp, &path)?;
    Ok(())
}

/// Delete a template by ID. For default templates, this dismisses them instead.
pub fn delete_template(id: &str) -> Result<()> {
    delete_template_in(&default_tracepilot_home()?, id)
}

pub fn delete_template_in(tracepilot_home: &Path, id: &str) -> Result<()> {
    validate_template_id(id)?;
    reject_reserved_template_id(id)?;

    // Check if it's a default template — dismiss instead of file delete.
    let defaults = default_templates();
    if defaults.iter().any(|t| t.id == id) {
        // Dismiss first to avoid data loss if the file delete succeeds but dismiss fails.
        dismiss_default_template_in(tracepilot_home, id)?;
        // Then remove any user override file if it exists.
        let dir = templates_dir_in(tracepilot_home)?;
        let path = dir.join(format!("{id}.json"));
        if path.exists() {
            std::fs::remove_file(&path)?;
        }
        return Ok(());
    }

    let dir = templates_dir_in(tracepilot_home)?;
    let path = dir.join(format!("{id}.json"));
    if !path.exists() {
        return Err(OrchestratorError::NotFound(format!(
            "Template not found: {id}"
        )));
    }
    std::fs::remove_file(&path)?;
    Ok(())
}
