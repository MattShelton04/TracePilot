use super::dismissed::dismissed_defaults_path;
use super::*;
use crate::types::SessionTemplate;
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
