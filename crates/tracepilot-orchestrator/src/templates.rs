//! Session templates management facade.

mod defaults;
mod dismissed;
mod storage;
mod usage;
mod validation;

use crate::error::Result;
use crate::types::SessionTemplate;
use std::path::Path;

pub use defaults::default_templates;
pub use dismissed::{
    dismiss_default_template_in, has_dismissed_defaults_in, restore_all_default_templates_in,
    restore_default_template_in,
};
pub use storage::{delete_template_in, list_templates_in, save_template_in, templates_dir_in};
pub use usage::increment_usage_in;

#[cfg(test)]
mod tests;

/// Return all templates (non-dismissed defaults + user-saved) under the
/// configured TracePilot data folder.
pub fn all_templates_in(tracepilot_home: &Path) -> Result<Vec<SessionTemplate>> {
    let dismissed = dismissed::read_dismissed_defaults_in(tracepilot_home);
    let mut templates: Vec<SessionTemplate> = default_templates()
        .into_iter()
        .filter(|t| !dismissed.contains(&t.id))
        .collect();

    let user_templates = list_templates_in(tracepilot_home)?;

    // User templates override defaults with same ID.
    for ut in user_templates {
        if let Some(pos) = templates.iter().position(|t| t.id == ut.id) {
            templates[pos] = ut;
        } else {
            templates.push(ut);
        }
    }

    Ok(templates)
}
