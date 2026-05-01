use crate::types::{LaunchConfig, LaunchMode, SessionTemplate};

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
            config: LaunchConfig {
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
                launch_mode: LaunchMode::Terminal,
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
            config: LaunchConfig {
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
                launch_mode: LaunchMode::Terminal,
                cli_command: tracepilot_core::constants::DEFAULT_CLI_COMMAND.into(),
            },
            tags: vec!["testing".into(), "coverage".into()],
            created_at: now,
            usage_count: 0,
        },
    ]
}
