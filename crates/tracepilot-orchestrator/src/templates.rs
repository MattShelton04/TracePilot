//! Session templates management.

use crate::error::{OrchestratorError, Result};
use crate::types::SessionTemplate;
use std::path::PathBuf;

/// Default templates storage path.
pub fn templates_dir() -> Result<PathBuf> {
    let home = crate::launcher::copilot_home()?;
    let dir = home.join("tracepilot").join("templates");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// List all saved templates.
pub fn list_templates() -> Result<Vec<SessionTemplate>> {
    let dir = templates_dir()?;
    let mut templates = Vec::new();

    if !dir.exists() {
        return Ok(templates);
    }

    for entry in std::fs::read_dir(&dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
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
    let dir = templates_dir()?;
    let path = dir.join(format!("{}.json", template.id));
    let temp = dir.join(format!(".{}.json.tmp", template.id));

    let content = serde_json::to_string_pretty(template)?;
    std::fs::write(&temp, &content)?;
    std::fs::rename(&temp, &path)?;
    Ok(())
}

/// Delete a template by ID.
pub fn delete_template(id: &str) -> Result<()> {
    let dir = templates_dir()?;
    let path = dir.join(format!("{id}.json"));
    if !path.exists() {
        return Err(OrchestratorError::NotFound(format!("Template not found: {id}")));
    }
    std::fs::remove_file(&path)?;
    Ok(())
}

/// Increment usage count for a template.
pub fn increment_usage(id: &str) -> Result<()> {
    let dir = templates_dir()?;
    let path = dir.join(format!("{id}.json"));
    if !path.exists() {
        return Err(OrchestratorError::NotFound(format!("Template not found: {id}")));
    }

    let content = std::fs::read_to_string(&path)?;
    let mut template: SessionTemplate = serde_json::from_str(&content)?;
    template.usage_count += 1;
    save_template(&template)?;
    Ok(())
}

/// Get built-in default templates.
pub fn default_templates() -> Vec<SessionTemplate> {
    let now = chrono::Utc::now().to_rfc3339();
    vec![
        SessionTemplate {
            id: "default-bugfix".into(),
            name: "Bug Fix".into(),
            description: "Quick bug fix session with auto-approve".into(),
            category: "Development".into(),
            config: crate::types::LaunchConfig {
                repo_path: String::new(),
                branch: Some("fix/".into()),
                base_branch: None,
                model: Some("claude-sonnet-4.6".into()),
                prompt: None,
                headless: false,
                reasoning_effort: None,
                custom_instructions: None,
                env_vars: Default::default(),
                create_worktree: true,
                auto_approve: true,
                cli_command: "copilot".into(),
            },
            tags: vec!["bugfix".into(), "quick".into()],
            created_at: now.clone(),
            usage_count: 0,
        },
        SessionTemplate {
            id: "default-feature".into(),
            name: "Feature Development".into(),
            description: "Full feature development with premium model".into(),
            category: "Development".into(),
            config: crate::types::LaunchConfig {
                repo_path: String::new(),
                branch: Some("feature/".into()),
                base_branch: None,
                model: Some("claude-opus-4.6".into()),
                prompt: None,
                headless: false,
                reasoning_effort: Some("high".into()),
                custom_instructions: None,
                env_vars: Default::default(),
                create_worktree: true,
                auto_approve: false,
                cli_command: "copilot".into(),
            },
            tags: vec!["feature".into(), "premium".into()],
            created_at: now.clone(),
            usage_count: 0,
        },
        SessionTemplate {
            id: "default-review".into(),
            name: "Code Review".into(),
            description: "Code review session with explore agent".into(),
            category: "Review".into(),
            config: crate::types::LaunchConfig {
                repo_path: String::new(),
                branch: None,
                base_branch: None,
                model: Some("claude-sonnet-4.6".into()),
                prompt: Some("Review the recent changes and provide feedback".into()),
                headless: false,
                reasoning_effort: None,
                custom_instructions: None,
                env_vars: Default::default(),
                create_worktree: false,
                auto_approve: false,
                cli_command: "copilot".into(),
            },
            tags: vec!["review".into()],
            created_at: now,
            usage_count: 0,
        },
    ]
}

/// Return all templates (defaults + user-saved).
pub fn all_templates() -> Result<Vec<SessionTemplate>> {
    let mut templates = default_templates();
    let user_templates = list_templates()?;

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

    #[test]
    fn test_default_templates_not_empty() {
        let templates = default_templates();
        assert_eq!(templates.len(), 3);
        assert!(templates.iter().any(|t| t.id == "default-bugfix"));
        assert!(templates.iter().any(|t| t.id == "default-feature"));
        assert!(templates.iter().any(|t| t.id == "default-review"));
    }

    #[test]
    fn test_save_and_list_templates() {
        // This test would need a temp dir override for templates_dir()
        // In integration tests we'd mock the path. For unit tests, we test serialization.
        let template = SessionTemplate {
            id: "test-1".into(),
            name: "Test Template".into(),
            description: "A test".into(),
            category: "Test".into(),
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
                cli_command: "copilot".into(),
            },
            tags: vec![],
            created_at: "2025-01-01T00:00:00Z".into(),
            usage_count: 5,
        };

        let json = serde_json::to_string_pretty(&template).unwrap();
        let parsed: SessionTemplate = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.id, "test-1");
        assert_eq!(parsed.usage_count, 5);
    }
}
