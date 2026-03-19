//! Copilot CLI session launcher.

use crate::error::{OrchestratorError, Result};
use crate::types::{LaunchConfig, LaunchedSession, ModelInfo, SystemDependencies};
use std::path::Path;
use std::process::Command;

/// Resolve the copilot home directory.
pub fn copilot_home() -> Result<std::path::PathBuf> {
    home_dir()
        .map(|h| h.join(".copilot"))
        .filter(|p| p.exists())
        .ok_or_else(|| OrchestratorError::Launch("Copilot home directory not found".into()))
}

/// Check system dependencies (git, copilot CLI).
pub fn check_dependencies() -> SystemDependencies {
    let git = check_tool("git", &["--version"]);
    let copilot = check_tool("copilot", &["--version"]);
    let copilot_home_exists = home_dir()
        .map(|h| h.join(".copilot").exists())
        .unwrap_or(false);

    SystemDependencies {
        git_available: git.0,
        git_version: git.1,
        copilot_available: copilot.0,
        copilot_version: copilot.1,
        copilot_home_exists,
    }
}

/// Launch a new Copilot CLI session with the given configuration.
pub fn launch_session(config: &LaunchConfig) -> Result<LaunchedSession> {
    let repo = Path::new(&config.repo_path);
    if !repo.exists() {
        return Err(OrchestratorError::Launch(format!(
            "Repository path does not exist: {}",
            config.repo_path
        )));
    }

    // Build the copilot command arguments
    let mut args: Vec<String> = Vec::new();

    // Always run headless if requested (no TUI, just a process)
    if config.headless {
        args.push("--acp".to_string());
    }

    if let Some(model) = &config.model {
        args.push("--model".to_string());
        args.push(model.clone());
    }

    // Set COPILOT_AUTO_APPROVE for auto-approve mode
    let mut envs = config.env_vars.clone();
    if config.auto_approve {
        envs.insert("COPILOT_AUTO_APPROVE".to_string(), "true".to_string());
    }

    if let Some(effort) = &config.reasoning_effort {
        envs.insert(
            "COPILOT_REASONING_EFFORT".to_string(),
            effort.clone(),
        );
    }

    // Spawn the process directly (no shell wrapping for PID accuracy)
    let child = Command::new("copilot")
        .args(&args)
        .current_dir(repo)
        .envs(&envs)
        .spawn()
        .map_err(|e| OrchestratorError::Launch(format!("Failed to spawn copilot: {e}")))?;

    let pid = child.id();
    let command = format!("copilot {}", args.join(" "));

    Ok(LaunchedSession {
        pid,
        worktree_path: None,
        command,
        launched_at: chrono::Utc::now().to_rfc3339(),
    })
}

/// List available models.
pub fn available_models() -> Vec<ModelInfo> {
    vec![
        ModelInfo { id: "claude-sonnet-4.6".into(), name: "Claude Sonnet 4.6".into(), tier: "standard".into() },
        ModelInfo { id: "claude-sonnet-4.5".into(), name: "Claude Sonnet 4.5".into(), tier: "standard".into() },
        ModelInfo { id: "claude-haiku-4.5".into(), name: "Claude Haiku 4.5".into(), tier: "fast/cheap".into() },
        ModelInfo { id: "claude-opus-4.6".into(), name: "Claude Opus 4.6".into(), tier: "premium".into() },
        ModelInfo { id: "claude-opus-4.6-fast".into(), name: "Claude Opus 4.6 Fast".into(), tier: "premium".into() },
        ModelInfo { id: "claude-opus-4.5".into(), name: "Claude Opus 4.5".into(), tier: "premium".into() },
        ModelInfo { id: "claude-sonnet-4".into(), name: "Claude Sonnet 4".into(), tier: "standard".into() },
        ModelInfo { id: "gemini-3-pro-preview".into(), name: "Gemini 3 Pro".into(), tier: "standard".into() },
        ModelInfo { id: "gpt-5.4".into(), name: "GPT-5.4".into(), tier: "standard".into() },
        ModelInfo { id: "gpt-5.3-codex".into(), name: "GPT-5.3 Codex".into(), tier: "standard".into() },
        ModelInfo { id: "gpt-5.2-codex".into(), name: "GPT-5.2 Codex".into(), tier: "standard".into() },
        ModelInfo { id: "gpt-5.2".into(), name: "GPT-5.2".into(), tier: "standard".into() },
        ModelInfo { id: "gpt-5.1-codex-max".into(), name: "GPT-5.1 Codex Max".into(), tier: "standard".into() },
        ModelInfo { id: "gpt-5.1-codex".into(), name: "GPT-5.1 Codex".into(), tier: "standard".into() },
        ModelInfo { id: "gpt-5.1".into(), name: "GPT-5.1".into(), tier: "standard".into() },
        ModelInfo { id: "gpt-5.4-mini".into(), name: "GPT-5.4 Mini".into(), tier: "fast/cheap".into() },
        ModelInfo { id: "gpt-5.1-codex-mini".into(), name: "GPT-5.1 Codex Mini".into(), tier: "fast/cheap".into() },
        ModelInfo { id: "gpt-5-mini".into(), name: "GPT-5 Mini".into(), tier: "fast/cheap".into() },
        ModelInfo { id: "gpt-4.1".into(), name: "GPT-4.1".into(), tier: "fast/cheap".into() },
    ]
}

// ─── Internal helpers ─────────────────────────────────────────────

fn home_dir() -> Option<std::path::PathBuf> {
    #[cfg(windows)]
    {
        std::env::var("USERPROFILE")
            .map(std::path::PathBuf::from)
            .ok()
    }
    #[cfg(not(windows))]
    {
        std::env::var("HOME")
            .map(std::path::PathBuf::from)
            .ok()
    }
}

fn check_tool(name: &str, args: &[&str]) -> (bool, Option<String>) {
    match Command::new(name).args(args).output() {
        Ok(output) if output.status.success() => {
            let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let version = extract_version(&raw).unwrap_or(raw);
            (true, Some(version))
        }
        _ => (false, None),
    }
}

/// Extract a semver-like version number from a string.
/// E.g. "GitHub Copilot CLI 1.0.9. Run ..." → "1.0.9"
/// E.g. "git version 2.45.0.windows.1" → "2.45.0"
fn extract_version(s: &str) -> Option<String> {
    // Find first occurrence of digit.digit.digit pattern
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i].is_ascii_digit() {
            let start = i;
            // Try to match \d+\.\d+\.\d+
            while i < bytes.len() && bytes[i].is_ascii_digit() {
                i += 1;
            }
            if i < bytes.len() && bytes[i] == b'.' {
                i += 1;
                if i < bytes.len() && bytes[i].is_ascii_digit() {
                    while i < bytes.len() && bytes[i].is_ascii_digit() {
                        i += 1;
                    }
                    if i < bytes.len() && bytes[i] == b'.' {
                        i += 1;
                        if i < bytes.len() && bytes[i].is_ascii_digit() {
                            while i < bytes.len() && bytes[i].is_ascii_digit() {
                                i += 1;
                            }
                            return Some(s[start..i].to_string());
                        }
                    }
                }
            }
        }
        i += 1;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_available_models_not_empty() {
        let models = available_models();
        assert!(!models.is_empty());
        assert!(models.iter().any(|m| m.id == "claude-opus-4.6"));
    }

    #[test]
    fn test_home_dir_returns_something() {
        // Should always return Some on developer machines
        assert!(home_dir().is_some());
    }

    #[test]
    fn test_extract_version() {
        assert_eq!(
            extract_version("GitHub Copilot CLI 1.0.9. Run 'copilot update' to check for updates."),
            Some("1.0.9".to_string())
        );
        assert_eq!(
            extract_version("git version 2.45.0.windows.1"),
            Some("2.45.0".to_string())
        );
        assert_eq!(extract_version("1.0.8"), Some("1.0.8".to_string()));
        assert_eq!(extract_version("no version here"), None);
    }
}
