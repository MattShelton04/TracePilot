//! Copilot CLI session launcher.

use crate::error::{OrchestratorError, Result};
use crate::types::{CreateWorktreeRequest, LaunchConfig, LaunchedSession, ModelInfo, SystemDependencies};
use crate::worktrees;
use std::path::Path;
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

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

/// Validate a model ID against known models (defence-in-depth against injection).
fn validate_model(model: &str) -> Result<()> {
    let known: Vec<String> = available_models().into_iter().map(|m| m.id).collect();
    if known.iter().any(|id| id == model) {
        Ok(())
    } else {
        Err(OrchestratorError::Launch(format!(
            "Unknown model: {model}"
        )))
    }
}

/// Shell-quote a path for safe interpolation into a shell command string.
/// On Windows wraps in double-quotes; on Unix uses single-quote escaping.
#[allow(dead_code)] // Used in macOS/Linux cfg blocks
fn shell_quote(s: &str) -> String {
    #[cfg(windows)]
    {
        // Double-quote the path, escaping any inner double-quotes
        format!("\"{}\"", s.replace('"', "\"\""))
    }
    #[cfg(not(windows))]
    {
        // Replace each ' with '\'' (end quote, escaped quote, start quote)
        format!("'{}'", s.replace('\'', "'\\''"))
    }
}

/// Launch a new Copilot CLI session in a **new terminal window**.
///
/// If `create_worktree` is true and a `branch` is specified, a new git worktree
/// will be created first and used as the working directory.
///
/// NOTE: The returned `pid` is the PID of the **terminal wrapper process**, not
/// the Copilot session itself. It is informational only.
pub fn launch_session(config: &LaunchConfig) -> Result<LaunchedSession> {
    let repo = Path::new(&config.repo_path);
    if !repo.exists() {
        return Err(OrchestratorError::Launch(format!(
            "Repository path does not exist: {}",
            config.repo_path
        )));
    }

    // Handle worktree creation if requested
    let (work_dir, worktree_path) = if config.create_worktree {
        let branch = config.branch.as_deref().ok_or_else(|| {
            OrchestratorError::Launch(
                "Branch is required when creating a worktree".into(),
            )
        })?;

        let request = CreateWorktreeRequest {
            repo_path: config.repo_path.clone(),
            branch: branch.to_string(),
            base_branch: config.base_branch.clone(),
            target_dir: None,
        };

        match worktrees::create_worktree(&request) {
            Ok(wt) => {
                let wt_path = wt.path.clone();
                (std::path::PathBuf::from(&wt.path), Some(wt_path))
            }
            Err(e) => {
                return Err(OrchestratorError::Launch(format!(
                    "Failed to create worktree: {e}"
                )));
            }
        }
    } else {
        (repo.to_path_buf(), None)
    };

    // Build the copilot command arguments
    let mut args: Vec<String> = Vec::new();

    if let Some(model) = &config.model {
        validate_model(model)?;
        args.push(format!("--model={}", model));
    }

    if config.auto_approve {
        args.push("--allow-all".to_string());
    }

    // Set environment variables
    let mut envs = config.env_vars.clone();

    if let Some(effort) = &config.reasoning_effort {
        envs.insert(
            "COPILOT_REASONING_EFFORT".to_string(),
            effort.clone(),
        );
    }

    // Spawn in a new terminal window so the user can interact with the session.
    // We do NOT pass the prompt via -p because that runs non-interactively and exits.
    // Instead, we start an interactive session (copilot <flags>) and the user can
    // paste the prompt if one was provided.
    let copilot_cmd = format!("copilot {}", args.join(" "));

    #[cfg(windows)]
    let child = {
        const CREATE_NEW_CONSOLE: u32 = 0x00000010;
        // Build a PowerShell command that sets the directory and runs copilot.
        // Use single-quote escaping for the path (double any embedded single quotes).
        let escaped_dir = work_dir.display().to_string().replace('\'', "''");

        // If a prompt was provided, copy it to the clipboard so the user can paste it.
        let clipboard_cmd = if let Some(prompt) = &config.prompt {
            let escaped_prompt = prompt.replace('\'', "''");
            format!(
                "Set-Clipboard '{}'; Write-Host '  Prompt copied to clipboard - press Ctrl+V to paste' -ForegroundColor Green; Write-Host '';",
                escaped_prompt
            )
        } else {
            String::new()
        };

        let ps_cmd = format!(
            "Set-Location -LiteralPath '{}'; {}{}",
            escaped_dir, clipboard_cmd, copilot_cmd
        );
        Command::new("powershell")
            .args(["-NoExit", "-Command", &ps_cmd])
            .current_dir(&work_dir)
            .envs(&envs)
            .creation_flags(CREATE_NEW_CONSOLE)
            .spawn()
            .map_err(|e| OrchestratorError::Launch(format!("Failed to open terminal: {e}")))?
    };

    #[cfg(target_os = "macos")]
    let child = {
        let escaped_cwd = shell_quote(&work_dir.display().to_string());
        let script = format!(
            "tell app \"Terminal\" to do script \"cd {} && {}\"",
            escaped_cwd, copilot_cmd
        );
        Command::new("osascript")
            .args(["-e", &script])
            .spawn()
            .map_err(|e| OrchestratorError::Launch(format!("Failed to open terminal: {e}")))?
    };

    #[cfg(target_os = "linux")]
    let child = {
        let terminals = ["x-terminal-emulator", "gnome-terminal", "konsole", "xfce4-terminal", "xterm"];
        let mut result = None;
        for term in &terminals {
            if let Ok(c) = Command::new(term)
                .args(["-e", &copilot_cmd])
                .current_dir(&work_dir)
                .envs(&envs)
                .spawn()
            {
                result = Some(c);
                break;
            }
        }
        result.ok_or_else(|| OrchestratorError::Launch("No terminal emulator found".into()))?
    };

    let pid = child.id();

    Ok(LaunchedSession {
        pid,
        worktree_path,
        command: copilot_cmd,
        launched_at: chrono::Utc::now().to_rfc3339(),
    })
}

/// Open a path in the system file explorer.
pub fn open_in_explorer(path: &str) -> Result<()> {
    let p = Path::new(path);
    if !p.exists() {
        return Err(OrchestratorError::Launch(format!("Path does not exist: {path}")));
    }

    #[cfg(windows)]
    {
        // Windows explorer requires backslash paths
        let win_path = path.replace('/', "\\");
        Command::new("explorer")
            .arg(&win_path)
            .spawn()
            .map_err(|e| OrchestratorError::Launch(format!("Failed to open explorer: {e}")))?;
    }

    #[cfg(target_os = "macos")]
    Command::new("open")
        .arg(path)
        .spawn()
        .map_err(|e| OrchestratorError::Launch(format!("Failed to open Finder: {e}")))?;

    #[cfg(target_os = "linux")]
    Command::new("xdg-open")
        .arg(path)
        .spawn()
        .map_err(|e| OrchestratorError::Launch(format!("Failed to open file manager: {e}")))?;

    Ok(())
}

/// Open a new terminal window at the given directory.
pub fn open_in_terminal(path: &str) -> Result<()> {
    let p = Path::new(path);
    if !p.exists() {
        return Err(OrchestratorError::Launch(format!("Path does not exist: {path}")));
    }

    #[cfg(windows)]
    {
        const CREATE_NEW_CONSOLE: u32 = 0x00000010;
        Command::new("powershell")
            .current_dir(p)
            .creation_flags(CREATE_NEW_CONSOLE)
            .spawn()
            .map_err(|e| OrchestratorError::Launch(format!("Failed to open terminal: {e}")))?;
    }

    #[cfg(target_os = "macos")]
    {
        let escaped = shell_quote(path);
        let script = format!("tell app \"Terminal\" to do script \"cd {}\"", escaped);
        Command::new("osascript")
            .args(["-e", &script])
            .spawn()
            .map_err(|e| OrchestratorError::Launch(format!("Failed to open terminal: {e}")))?;
    }

    #[cfg(target_os = "linux")]
    {
        let terminals = ["x-terminal-emulator", "gnome-terminal", "konsole", "xfce4-terminal", "xterm"];
        let mut launched = false;
        for term in &terminals {
            if Command::new(term).current_dir(p).spawn().is_ok() {
                launched = true;
                break;
            }
        }
        if !launched {
            return Err(OrchestratorError::Launch("No terminal emulator found".into()));
        }
    }

    Ok(())
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

    #[test]
    fn test_validate_model_accepts_known() {
        assert!(validate_model("claude-opus-4.6").is_ok());
        assert!(validate_model("gpt-5.4").is_ok());
        assert!(validate_model("claude-haiku-4.5").is_ok());
    }

    #[test]
    fn test_validate_model_rejects_unknown() {
        assert!(validate_model("unknown-model").is_err());
        assert!(validate_model("'; rm -rf /").is_err());
        assert!(validate_model("& calc &").is_err());
    }

    #[test]
    fn test_shell_quote_plain_path() {
        let quoted = shell_quote("C:\\git\\MyProject");
        // On Windows, should be double-quoted
        #[cfg(windows)]
        assert_eq!(quoted, "\"C:\\git\\MyProject\"");
        // On Unix, should be single-quoted
        #[cfg(not(windows))]
        assert_eq!(quoted, "'C:\\git\\MyProject'");
    }

    #[test]
    fn test_shell_quote_path_with_spaces() {
        let quoted = shell_quote("C:\\My Projects\\repo");
        #[cfg(windows)]
        assert_eq!(quoted, "\"C:\\My Projects\\repo\"");
        #[cfg(not(windows))]
        assert_eq!(quoted, "'C:\\My Projects\\repo'");
    }

    #[test]
    fn test_shell_quote_path_with_ampersand() {
        let quoted = shell_quote("C:\\A&B Corp\\repo");
        #[cfg(windows)]
        assert_eq!(quoted, "\"C:\\A&B Corp\\repo\"");
    }
}
