//! Session templates management.

use crate::error::{OrchestratorError, Result};
use crate::types::SessionTemplate;
use std::path::{Path, PathBuf};

/// Maximum size for a single template JSON file (1 MB).
const MAX_TEMPLATE_SIZE: u64 = 1_048_576;

/// Validate a template ID to prevent path traversal attacks.
/// IDs must be non-empty and contain only alphanumeric characters, hyphens, and underscores.
fn validate_template_id(id: &str) -> Result<()> {
    crate::validation::validate_identifier(id, crate::validation::TEMPLATE_ID_RULES, "Template ID")
        .map_err(OrchestratorError::NotFound)
}

/// Default templates storage path.
pub fn templates_dir() -> Result<PathBuf> {
    let root = tracepilot_core::paths::CopilotPaths::from_home(crate::launcher::copilot_home()?)
        .tracepilot()
        .root()
        .to_path_buf();
    templates_dir_in(&root)
}

pub fn templates_dir_in(tracepilot_home: &Path) -> Result<PathBuf> {
    let dir = tracepilot_core::paths::TracePilotPaths::from_root(tracepilot_home).templates_dir();
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Path to the file tracking which default templates have been dismissed.
fn dismissed_defaults_path() -> Result<PathBuf> {
    Ok(templates_dir()?.join("dismissed_defaults.json"))
}

fn dismissed_defaults_path_in(tracepilot_home: &Path) -> Result<PathBuf> {
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

fn read_dismissed_defaults_in(tracepilot_home: &Path) -> Vec<String> {
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

    let content = match std::fs::read_to_string(&path) {
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
    let root = tracepilot_core::paths::CopilotPaths::from_home(crate::launcher::copilot_home()?)
        .tracepilot()
        .root()
        .to_path_buf();
    dismiss_default_template_in(&root, id)
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
    let root = tracepilot_core::paths::CopilotPaths::from_home(crate::launcher::copilot_home()?)
        .tracepilot()
        .root()
        .to_path_buf();
    restore_default_template_in(&root, id)
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

    for entry in std::fs::read_dir(&dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
            // Skip the dismissed_defaults metadata file
            if path.file_stem().and_then(|s| s.to_str()) == Some("dismissed_defaults") {
                continue;
            }
            // Reject unreasonably large template files to prevent DoS
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
    }

    templates.sort_by(|a, b| b.usage_count.cmp(&a.usage_count));
    Ok(templates)
}

/// Save a new template.
pub fn save_template(template: &SessionTemplate) -> Result<()> {
    let root = tracepilot_core::paths::CopilotPaths::from_home(crate::launcher::copilot_home()?)
        .tracepilot()
        .root()
        .to_path_buf();
    save_template_in(&root, template)
}

pub fn save_template_in(tracepilot_home: &Path, template: &SessionTemplate) -> Result<()> {
    validate_template_id(&template.id)?;

    // Prevent collision with internal metadata file
    if template.id == "dismissed_defaults" {
        return Err(OrchestratorError::NotFound(
            "Template ID 'dismissed_defaults' is reserved".into(),
        ));
    }

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
    let root = tracepilot_core::paths::CopilotPaths::from_home(crate::launcher::copilot_home()?)
        .tracepilot()
        .root()
        .to_path_buf();
    delete_template_in(&root, id)
}

pub fn delete_template_in(tracepilot_home: &Path, id: &str) -> Result<()> {
    validate_template_id(id)?;

    // Prevent accidental deletion of internal metadata file
    if id == "dismissed_defaults" {
        return Err(OrchestratorError::NotFound(
            "Template ID 'dismissed_defaults' is reserved".into(),
        ));
    }

    // Check if it's a default template — dismiss instead of file delete
    let defaults = default_templates();
    if defaults.iter().any(|t| t.id == id) {
        // Dismiss first to avoid data loss if the file delete succeeds but dismiss fails
        dismiss_default_template_in(tracepilot_home, id)?;
        // Then remove any user override file if it exists
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

/// Increment usage count for a template.
/// For default templates that haven't been saved yet, creates a user override.
pub fn increment_usage(id: &str) -> Result<()> {
    let root = tracepilot_core::paths::CopilotPaths::from_home(crate::launcher::copilot_home()?)
        .tracepilot()
        .root()
        .to_path_buf();
    increment_usage_in(&root, id)
}

pub fn increment_usage_in(tracepilot_home: &Path, id: &str) -> Result<()> {
    validate_template_id(id)?;

    let dir = templates_dir_in(tracepilot_home)?;
    let path = dir.join(format!("{id}.json"));

    let mut template = if path.exists() {
        let content = std::fs::read_to_string(&path)?;
        serde_json::from_str(&content)?
    } else {
        // Check if it's a default template
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

/// Get built-in default templates.
pub fn default_templates() -> Vec<SessionTemplate> {
    let now = chrono::Utc::now().to_rfc3339();
    vec![
        SessionTemplate {
            id: "default-multi-agent-review".into(),
            name: "Multi Agent Code Review".into(),
            description: "Comprehensive code review using multiple AI models".into(),
            icon: Some("🔍".into()),
            category: "Quality".into(),
            config: crate::types::LaunchConfig {
                repo_path: String::new(),
                branch: None,
                base_branch: None,
                model: Some("claude-opus-4.6".into()),
                prompt: Some(
                    "Spin up opus 4.6, GPT 5.4, Codex 5.3, and Gemini subagents to do a \
                     comprehensive code review of the changes on this branch (git diff). \
                     Consolidate and validate their feedback, and provide a summary."
                        .into(),
                ),
                headless: false,
                reasoning_effort: Some("high".into()),
                custom_instructions: None,
                env_vars: Default::default(),
                create_worktree: false,
                auto_approve: false,
                ui_server: false,
                launch_mode: crate::types::LaunchMode::Terminal,
                cli_command: tracepilot_core::constants::DEFAULT_CLI_COMMAND.into(),
            },
            tags: vec!["review".into(), "multi-agent".into(), "premium".into()],
            created_at: now.clone(),
            usage_count: 0,
        },
        SessionTemplate {
            id: "default-write-tests".into(),
            name: "Write Tests".into(),
            description: "Generate comprehensive test coverage for recent changes".into(),
            icon: Some("🧪".into()),
            category: "Quality".into(),
            config: crate::types::LaunchConfig {
                repo_path: String::new(),
                branch: None,
                base_branch: None,
                model: Some("claude-sonnet-4.6".into()),
                prompt: Some(
                    "Analyze the recent changes and generate comprehensive tests. \
                     Cover edge cases, error paths, and integration scenarios."
                        .into(),
                ),
                headless: false,
                reasoning_effort: Some("high".into()),
                custom_instructions: None,
                env_vars: Default::default(),
                create_worktree: false,
                auto_approve: false,
                ui_server: false,
                launch_mode: crate::types::LaunchMode::Terminal,
                cli_command: tracepilot_core::constants::DEFAULT_CLI_COMMAND.into(),
            },
            tags: vec!["testing".into(), "coverage".into()],
            created_at: now,
            usage_count: 0,
        },
    ]
}

/// Return all templates (non-dismissed defaults + user-saved).
pub fn all_templates() -> Result<Vec<SessionTemplate>> {
    let root = tracepilot_core::paths::CopilotPaths::from_home(crate::launcher::copilot_home()?)
        .tracepilot()
        .root()
        .to_path_buf();
    all_templates_in(&root)
}

pub fn all_templates_in(tracepilot_home: &Path) -> Result<Vec<SessionTemplate>> {
    let dismissed = read_dismissed_defaults_in(tracepilot_home);
    let mut templates: Vec<SessionTemplate> = default_templates()
        .into_iter()
        .filter(|t| !dismissed.contains(&t.id))
        .collect();

    let user_templates = list_templates_in(tracepilot_home)?;

    // User templates override defaults with same ID
    for ut in user_templates {
        if let Some(pos) = templates.iter().position(|t| t.id == ut.id) {
            templates[pos] = ut;
        } else {
            templates.push(ut);
        }
    }

    Ok(templates)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn with_temp_home<F: FnOnce()>(f: F) {
        let _guard = crate::TEST_ENV_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let tmp = TempDir::new().unwrap();
        // Create .copilot so copilot_home() succeeds
        std::fs::create_dir_all(tmp.path().join(".copilot")).unwrap();
        let old = std::env::var("HOME").ok();
        let old_userprofile = std::env::var("USERPROFILE").ok();
        // SAFETY: Environment mutation is serialized across the entire crate via
        // crate::TEST_ENV_LOCK, matching the Rust 2024 requirements for set_var/remove_var.
        unsafe {
            std::env::set_var("HOME", tmp.path());
            std::env::set_var("USERPROFILE", tmp.path());
        }
        f();
        unsafe {
            match old {
                Some(v) => std::env::set_var("HOME", v),
                None => std::env::remove_var("HOME"),
            }
            match old_userprofile {
                Some(v) => std::env::set_var("USERPROFILE", v),
                None => std::env::remove_var("USERPROFILE"),
            }
        }
    }

    #[test]
    fn test_default_templates_not_empty() {
        let templates = default_templates();
        assert_eq!(templates.len(), 2);
        assert!(
            templates
                .iter()
                .any(|t| t.id == "default-multi-agent-review")
        );
        assert!(templates.iter().any(|t| t.id == "default-write-tests"));
    }

    #[test]
    fn test_default_templates_have_icons() {
        let templates = default_templates();
        for t in &templates {
            assert!(t.icon.is_some(), "Template {} should have an icon", t.id);
        }
        assert_eq!(templates[0].icon.as_deref(), Some("🔍"));
        assert_eq!(templates[1].icon.as_deref(), Some("🧪"));
    }

    #[test]
    fn test_template_serialization_roundtrip() {
        let template = SessionTemplate {
            id: "test-1".into(),
            name: "Test Template".into(),
            description: "A test".into(),
            category: "Test".into(),
            icon: Some("🚀".into()),
            config: crate::types::LaunchConfig {
                repo_path: "/tmp/test".into(),
                branch: None,
                base_branch: None,
                model: None,
                prompt: None,
                headless: false,
                reasoning_effort: None,
                custom_instructions: None,
                env_vars: Default::default(),
                create_worktree: false,
                auto_approve: false,
                ui_server: false,
                launch_mode: crate::types::LaunchMode::Terminal,
                cli_command: tracepilot_core::constants::DEFAULT_CLI_COMMAND.into(),
            },
            tags: vec![],
            created_at: "2025-01-01T00:00:00Z".into(),
            usage_count: 5,
        };

        let json = serde_json::to_string_pretty(&template).unwrap();
        let parsed: SessionTemplate = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.id, "test-1");
        assert_eq!(parsed.usage_count, 5);
        assert_eq!(parsed.icon.as_deref(), Some("🚀"));
    }

    #[test]
    fn test_template_deserialization_without_icon() {
        // Backward compat: old templates without icon field should parse fine
        let json = r#"{
            "id": "old-template",
            "name": "Old Template",
            "description": "No icon field",
            "category": "Test",
            "config": {
                "repoPath": "",
                "headless": false,
                "envVars": {},
                "createWorktree": false,
                "autoApprove": false
            },
            "tags": [],
            "createdAt": "2025-01-01T00:00:00Z",
            "usageCount": 0
        }"#;
        let parsed: SessionTemplate = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.id, "old-template");
        assert!(parsed.icon.is_none());
    }

    #[test]
    fn test_dismiss_and_restore_default_template() {
        with_temp_home(|| {
            // All defaults should appear initially
            let all = all_templates().unwrap();
            assert_eq!(all.len(), 2);

            // Dismiss one
            dismiss_default_template("default-write-tests").unwrap();
            let all = all_templates().unwrap();
            assert_eq!(all.len(), 1);
            assert_eq!(all[0].id, "default-multi-agent-review");

            // Restore it
            restore_default_template("default-write-tests").unwrap();
            let all = all_templates().unwrap();
            assert_eq!(all.len(), 2);
        });
    }

    #[test]
    fn test_dismiss_nondefault_fails() {
        with_temp_home(|| {
            let result = dismiss_default_template("nonexistent");
            assert!(result.is_err());
        });
    }

    #[test]
    fn test_delete_default_template_dismisses_it() {
        with_temp_home(|| {
            let all_before = all_templates().unwrap();
            assert_eq!(all_before.len(), 2);

            // delete_template on a default should dismiss it, not error
            delete_template("default-write-tests").unwrap();
            let all_after = all_templates().unwrap();
            assert_eq!(all_after.len(), 1);
            assert!(!all_after.iter().any(|t| t.id == "default-write-tests"));
        });
    }

    #[test]
    fn test_save_and_list_user_template() {
        with_temp_home(|| {
            let template = SessionTemplate {
                id: "user-custom-1".into(),
                name: "Custom Template".into(),
                description: "A user template".into(),
                category: "Custom".into(),
                icon: Some("⭐".into()),
                config: crate::types::LaunchConfig {
                    repo_path: "/tmp/test".into(),
                    branch: None,
                    base_branch: None,
                    model: None,
                    prompt: None,
                    headless: false,
                    reasoning_effort: None,
                    custom_instructions: None,
                    env_vars: Default::default(),
                    create_worktree: false,
                    auto_approve: false,
                    ui_server: false,
                    launch_mode: crate::types::LaunchMode::Terminal,
                    cli_command: tracepilot_core::constants::DEFAULT_CLI_COMMAND.into(),
                },
                tags: vec![],
                created_at: "2025-01-01T00:00:00Z".into(),
                usage_count: 0,
            };

            save_template(&template).unwrap();
            let all = all_templates().unwrap();
            // 2 defaults + 1 user
            assert_eq!(all.len(), 3);
            assert!(all.iter().any(|t| t.id == "user-custom-1"));
        });
    }

    #[test]
    fn test_restore_all_default_templates() {
        with_temp_home(|| {
            // Dismiss both defaults
            dismiss_default_template("default-multi-agent-review").unwrap();
            dismiss_default_template("default-write-tests").unwrap();
            assert_eq!(all_templates().unwrap().len(), 0);
            assert!(has_dismissed_defaults());

            // Restore all at once
            restore_all_default_templates().unwrap();
            assert_eq!(all_templates().unwrap().len(), 2);
            assert!(!has_dismissed_defaults());
        });
    }

    #[test]
    fn test_has_dismissed_defaults() {
        with_temp_home(|| {
            assert!(!has_dismissed_defaults());
            dismiss_default_template("default-write-tests").unwrap();
            assert!(has_dismissed_defaults());
            restore_default_template("default-write-tests").unwrap();
            assert!(!has_dismissed_defaults());
        });
    }

    #[test]
    fn test_reserved_id_rejected_on_save() {
        with_temp_home(|| {
            let template = SessionTemplate {
                id: "dismissed_defaults".into(),
                name: "Sneaky".into(),
                description: "Trying to overwrite metadata".into(),
                category: "Test".into(),
                icon: None,
                config: crate::types::LaunchConfig {
                    repo_path: String::new(),
                    branch: None,
                    base_branch: None,
                    model: None,
                    prompt: None,
                    headless: false,
                    reasoning_effort: None,
                    custom_instructions: None,
                    env_vars: Default::default(),
                    create_worktree: false,
                    auto_approve: false,
                    ui_server: false,
                    launch_mode: crate::types::LaunchMode::Terminal,
                    cli_command: tracepilot_core::constants::DEFAULT_CLI_COMMAND.into(),
                },
                tags: vec![],
                created_at: "2025-01-01T00:00:00Z".into(),
                usage_count: 0,
            };
            let result = save_template(&template);
            assert!(result.is_err());
        });
    }

    #[test]
    fn test_reserved_id_rejected_on_delete() {
        with_temp_home(|| {
            let result = delete_template("dismissed_defaults");
            assert!(result.is_err());
        });
    }

    #[test]
    fn test_default_templates_have_prompts() {
        let templates = default_templates();
        for t in &templates {
            assert!(
                t.config.prompt.is_some(),
                "Default template {} should have a prompt",
                t.id
            );
        }
    }

    #[test]
    fn test_increment_usage_default_template() {
        with_temp_home(|| {
            // Default templates start with usage_count 0
            let all = all_templates().unwrap();
            let review = all
                .iter()
                .find(|t| t.id == "default-multi-agent-review")
                .unwrap();
            assert_eq!(review.usage_count, 0);

            // Increment creates a user override file
            increment_usage("default-multi-agent-review").unwrap();
            let all = all_templates().unwrap();
            let review = all
                .iter()
                .find(|t| t.id == "default-multi-agent-review")
                .unwrap();
            assert_eq!(review.usage_count, 1);

            // Second increment reads from the file
            increment_usage("default-multi-agent-review").unwrap();
            let all = all_templates().unwrap();
            let review = all
                .iter()
                .find(|t| t.id == "default-multi-agent-review")
                .unwrap();
            assert_eq!(review.usage_count, 2);
        });
    }

    #[test]
    fn test_increment_usage_nonexistent_fails() {
        with_temp_home(|| {
            let result = increment_usage("nonexistent-template");
            assert!(result.is_err());
        });
    }

    #[test]
    fn test_corrupted_dismissed_defaults_returns_all_templates() {
        with_temp_home(|| {
            // Write corrupted JSON to dismissed_defaults.json
            let path = dismissed_defaults_path().unwrap();
            std::fs::write(&path, b"{invalid json}").unwrap();

            // Should log warning and return all default templates (empty dismissed list)
            let all = all_templates().unwrap();
            assert_eq!(
                all.len(),
                2,
                "Should return all default templates when dismissed_defaults.json is corrupted"
            );
            assert!(all.iter().any(|t| t.id == "default-multi-agent-review"));
            assert!(all.iter().any(|t| t.id == "default-write-tests"));
        });
    }

    #[test]
    fn test_corrupted_dismissed_defaults_has_dismissed_returns_false() {
        with_temp_home(|| {
            // Write corrupted JSON
            let path = dismissed_defaults_path().unwrap();
            std::fs::write(&path, b"not valid json").unwrap();

            // Should return false (treats as no dismissed templates)
            assert!(!has_dismissed_defaults());
        });
    }

    #[test]
    fn test_empty_dismissed_defaults_file() {
        with_temp_home(|| {
            // Write empty string (not valid JSON array)
            let path = dismissed_defaults_path().unwrap();
            std::fs::write(&path, b"").unwrap();

            // Should log warning and return all templates
            let all = all_templates().unwrap();
            assert_eq!(all.len(), 2);
        });
    }

    #[test]
    fn test_dismissed_defaults_wrong_json_type() {
        with_temp_home(|| {
            let path = dismissed_defaults_path().unwrap();

            // Test object instead of array
            std::fs::write(&path, b"{\"key\": \"value\"}").unwrap();
            let all = all_templates().unwrap();
            assert_eq!(
                all.len(),
                2,
                "Should return all templates when dismissed_defaults is an object"
            );

            // Test string instead of array
            std::fs::write(&path, b"\"just a string\"").unwrap();
            let all = all_templates().unwrap();
            assert_eq!(
                all.len(),
                2,
                "Should return all templates when dismissed_defaults is a string"
            );

            // Test number instead of array
            std::fs::write(&path, b"42").unwrap();
            let all = all_templates().unwrap();
            assert_eq!(
                all.len(),
                2,
                "Should return all templates when dismissed_defaults is a number"
            );
        });
    }
}
