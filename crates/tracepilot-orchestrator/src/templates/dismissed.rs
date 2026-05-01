use super::default_tracepilot_home;
use super::defaults::default_templates;
use super::storage::templates_dir_in;
use crate::error::{OrchestratorError, Result};
use std::path::{Path, PathBuf};

/// Path to the file tracking which default templates have been dismissed.
pub(super) fn dismissed_defaults_path() -> Result<PathBuf> {
    dismissed_defaults_path_in(&default_tracepilot_home()?)
}

pub(super) fn dismissed_defaults_path_in(tracepilot_home: &Path) -> Result<PathBuf> {
    Ok(templates_dir_in(tracepilot_home)?.join("dismissed_defaults.json"))
}

/// Read the set of dismissed default template IDs.
///
/// Returns an empty list if the file doesn't exist, cannot be read, or contains invalid JSON.
/// All errors are logged with context.
fn read_dismissed_defaults() -> Vec<String> {
    let path = match dismissed_defaults_path() {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!(
                error = %e,
                "Failed to get dismissed defaults path"
            );
            return Vec::new();
        }
    };
    read_dismissed_defaults_from_path(&path)
}

pub(super) fn read_dismissed_defaults_in(tracepilot_home: &Path) -> Vec<String> {
    let path = match dismissed_defaults_path_in(tracepilot_home) {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!(
                error = %e,
                "Failed to get dismissed defaults path"
            );
            return Vec::new();
        }
    };
    read_dismissed_defaults_from_path(&path)
}

fn read_dismissed_defaults_from_path(path: &Path) -> Vec<String> {
    if !path.exists() {
        return Vec::new();
    }

    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!(
                path = %path.display(),
                error = %e,
                "Failed to read dismissed defaults file, returning empty list"
            );
            return Vec::new();
        }
    };

    match serde_json::from_str(&content) {
        Ok(ids) => ids,
        Err(e) => {
            tracing::warn!(
                path = %path.display(),
                error = %e,
                "Failed to parse dismissed defaults JSON, returning empty list. \
                 File may be corrupted or have an incompatible schema. \
                 The file will be overwritten on the next dismiss operation."
            );
            Vec::new()
        }
    }
}

/// Write the set of dismissed default template IDs.
fn write_dismissed_defaults_in(tracepilot_home: &Path, ids: &[String]) -> Result<()> {
    let path = dismissed_defaults_path_in(tracepilot_home)?;
    write_dismissed_defaults_to_path(ids, &path)
}

fn write_dismissed_defaults_to_path(ids: &[String], path: &Path) -> Result<()> {
    let content = serde_json::to_string_pretty(ids)?;
    std::fs::write(path, content)?;
    Ok(())
}

/// Dismiss a default template so it no longer appears.
pub fn dismiss_default_template(id: &str) -> Result<()> {
    dismiss_default_template_in(&default_tracepilot_home()?, id)
}

pub fn dismiss_default_template_in(tracepilot_home: &Path, id: &str) -> Result<()> {
    let defaults = default_templates();
    if !defaults.iter().any(|t| t.id == id) {
        return Err(OrchestratorError::NotFound(format!(
            "Not a default template: {id}"
        )));
    }
    let mut dismissed = read_dismissed_defaults_in(tracepilot_home);
    if !dismissed.contains(&id.to_string()) {
        dismissed.push(id.to_string());
        write_dismissed_defaults_in(tracepilot_home, &dismissed)?;
    }
    Ok(())
}

/// Restore a previously dismissed default template.
pub fn restore_default_template(id: &str) -> Result<()> {
    restore_default_template_in(&default_tracepilot_home()?, id)
}

pub fn restore_default_template_in(tracepilot_home: &Path, id: &str) -> Result<()> {
    let mut dismissed = read_dismissed_defaults_in(tracepilot_home);
    dismissed.retain(|d| d != id);
    write_dismissed_defaults_in(tracepilot_home, &dismissed)?;
    Ok(())
}

/// Restore all dismissed default templates at once.
pub fn restore_all_default_templates() -> Result<()> {
    let path = dismissed_defaults_path()?;
    restore_all_default_templates_at_path(&path)
}

pub fn restore_all_default_templates_in(tracepilot_home: &Path) -> Result<()> {
    let path = dismissed_defaults_path_in(tracepilot_home)?;
    restore_all_default_templates_at_path(&path)
}

fn restore_all_default_templates_at_path(path: &Path) -> Result<()> {
    if path.exists() {
        std::fs::remove_file(path)?;
    }
    Ok(())
}

/// Check whether any default templates have been dismissed.
pub fn has_dismissed_defaults() -> bool {
    let dismissed = read_dismissed_defaults();
    !dismissed.is_empty()
}

pub fn has_dismissed_defaults_in(tracepilot_home: &Path) -> bool {
    let dismissed = read_dismissed_defaults_in(tracepilot_home);
    !dismissed.is_empty()
}
