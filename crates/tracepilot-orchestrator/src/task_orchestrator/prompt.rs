//! Orchestrator prompt template rendering.
//!
//! The prompt template is stored as a markdown file and rendered by replacing
//! `{{variable}}` placeholders with configuration values. The prompt is
//! **task-agnostic** — all task details live in the manifest and context files.

use std::path::Path;

/// The raw prompt template, embedded at compile time.
const ORCHESTRATOR_PROMPT_TEMPLATE: &str = include_str!("orchestrator_prompt.md");

/// Configuration values interpolated into the orchestrator prompt.
pub struct OrchestratorPromptConfig {
    /// Absolute path to manifest.json.
    pub manifest_path: String,
    /// Absolute path to heartbeat.json (sibling of manifest).
    pub heartbeat_path: String,
    /// Poll interval in seconds.
    pub poll_interval: u32,
    /// Maximum concurrent subagent tasks.
    pub max_parallel: u32,
    /// Exit after this many consecutive empty poll cycles.
    pub max_empty_polls: u32,
    /// Exit after this many total cycles (for context freshness).
    pub max_cycles: u32,
}

/// Render the orchestrator prompt by replacing template variables.
pub fn render_orchestrator_prompt(config: &OrchestratorPromptConfig) -> String {
    ORCHESTRATOR_PROMPT_TEMPLATE
        .replace("{{manifest_path}}", &config.manifest_path)
        .replace("{{heartbeat_path}}", &config.heartbeat_path)
        .replace("{{poll_interval}}", &config.poll_interval.to_string())
        .replace("{{max_parallel}}", &config.max_parallel.to_string())
        .replace("{{max_empty_polls}}", &config.max_empty_polls.to_string())
        .replace("{{max_cycles}}", &config.max_cycles.to_string())
}

/// Default jobs directory: `~/.copilot/tracepilot/jobs/`
#[allow(dead_code)]
pub fn default_jobs_dir() -> crate::error::Result<std::path::PathBuf> {
    Ok(
        tracepilot_core::paths::CopilotPaths::from_home(crate::launcher::copilot_home()?)
            .tracepilot()
            .jobs_dir(),
    )
}

/// Resolve the manifest path from a jobs directory.
pub fn manifest_path(jobs_dir: &Path) -> std::path::PathBuf {
    jobs_dir.join("manifest.json")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompt_renders_with_all_variables() {
        let config = OrchestratorPromptConfig {
            manifest_path: "/home/user/.copilot/tracepilot/jobs/manifest.json".to_string(),
            heartbeat_path: "/home/user/.copilot/tracepilot/jobs/heartbeat.json".to_string(),
            poll_interval: 30,
            max_parallel: 3,
            max_empty_polls: 10,
            max_cycles: 100,
        };
        let rendered = render_orchestrator_prompt(&config);

        assert!(rendered.contains("/home/user/.copilot/tracepilot/jobs/manifest.json"));
        assert!(rendered.contains("/home/user/.copilot/tracepilot/jobs/heartbeat.json"));
        assert!(rendered.contains("Start-Sleep -Seconds 30"));
        assert!(rendered.contains("No tasks for 10 cycles"));
        assert!(!rendered.contains("{{manifest_path}}"));
        assert!(!rendered.contains("{{heartbeat_path}}"));
        assert!(!rendered.contains("{{poll_interval}}"));
        assert!(!rendered.contains("{{max_parallel}}"));
        assert!(!rendered.contains("{{max_empty_polls}}"));
        assert!(!rendered.contains("{{max_cycles}}"));
    }

    #[test]
    fn template_contains_key_sections() {
        let template = ORCHESTRATOR_PROMPT_TEMPLATE;
        assert!(template.contains("TracePilot Task Orchestrator"));
        assert!(template.contains("Main Loop"));
        assert!(template.contains("Subagent Prompt"));
        assert!(template.contains("tp-{task"));
        assert!(template.contains("heartbeat"));
    }
}
