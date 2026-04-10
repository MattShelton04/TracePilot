//! Copilot CLI session launcher.

use crate::error::{OrchestratorError, Result};
use crate::models;
use crate::types::{
    CreateWorktreeRequest, LaunchConfig, LaunchedSession, ModelInfo, SystemDependencies,
};
use crate::worktrees;
use std::path::Path;
use std::process::Command;

// Re-export process utilities for backward compatibility.
#[cfg(windows)]
pub use crate::process::encode_powershell_command;
#[cfg(windows)]
pub use crate::process::spawn_outside_job;

/// Resolve the copilot home directory.
pub fn copilot_home() -> Result<std::path::PathBuf> {
    tracepilot_core::utils::home_dir_opt()
        .map(|h| h.join(".copilot"))
        .filter(|p| p.exists())
        .ok_or_else(|| OrchestratorError::Launch("Copilot home directory not found".into()))
}

/// Check system dependencies (git, copilot CLI).
pub fn check_dependencies(copilot_cmd: Option<&str>) -> SystemDependencies {
    let git = check_tool("git", &["--version"]);
    let cmd = copilot_cmd.unwrap_or("copilot");
    let copilot = check_tool(cmd, &["--version"]);
    let copilot_home_exists = tracepilot_core::utils::home_dir_opt()
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
    if models::is_known_model(model) {
        Ok(())
    } else {
        Err(OrchestratorError::Launch(format!("Unknown model: {model}")))
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
            OrchestratorError::Launch("Branch is required when creating a worktree".into())
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

    // Sanitize CLI command — allow only safe characters.
    // Colon is needed for Windows drive letters (e.g., C:\path\to\copilot).
    let cli = &config.cli_command;
    if !cli
        .chars()
        .all(|c| c.is_alphanumeric() || "-_./\\ :".contains(c))
    {
        return Err(OrchestratorError::Launch(
            "CLI command contains invalid characters".into(),
        ));
    }

    // Build the copilot command arguments
    let mut args: Vec<String> = Vec::new();

    if let Some(model) = &config.model {
        validate_model(model)?;
        args.push("--model".to_string());
        args.push(model.clone());
    }

    if config.auto_approve {
        args.push("--allow-all".to_string());
    }

    if let Some(effort) = &config.reasoning_effort {
        args.push("--reasoning-effort".to_string());
        args.push(effort.clone());
    }

    // Set environment variables
    let envs = config.env_vars.clone();

    // Build the CLI command string using the user-configured CLI command
    let copilot_cmd = if args.is_empty() {
        cli.clone()
    } else {
        format!("{} {}", cli, args.join(" "))
    };

    // --interactive prompt is appended per-platform with proper shell quoting
    // to handle special characters (quotes, newlines, etc.) safely

    // If a branch was specified but we're NOT creating a worktree, checkout the branch first
    let checkout_cmd = if !config.create_worktree {
        config.branch.as_deref().map(|b| {
            let escaped = b.replace('\'', "''");
            // Try checkout; if it fails (branch doesn't exist locally), try creating from remote
            format!("git checkout '{b}'", b = escaped)
        })
    } else {
        None
    };

    #[cfg(windows)]
    let pid = {
        let escaped_dir = work_dir.display().to_string().replace('\'', "''");

        // Optional branch checkout step: check dirty state, try checkout, auto-create from default branch
        let checkout_step = if let Some(ref _cmd) = checkout_cmd {
            let branch_name = config.branch.as_deref().unwrap_or("").replace('\'', "''");
            // Determine base branch for new branch creation: use config.base_branch or detect default
            let base_branch_expr = if let Some(ref bb) = config.base_branch {
                format!("'{}'", bb.replace('\'', "''"))
            } else {
                // Auto-detect default branch in PowerShell
                "$defaultBranch".to_string()
            };
            let detect_default = if config.base_branch.is_none() {
                "$defaultBranch = (git symbolic-ref refs/remotes/origin/HEAD --short 2>$null); if (-not $defaultBranch) { $defaultBranch = 'origin/main' }; "
            } else {
                ""
            };
            format!(
                concat!(
                    // 1. Check for uncommitted changes
                    "$dirty = (git status --porcelain 2>$null); ",
                    "if ($dirty) {{ ",
                    "  Write-Host 'Warning: You have uncommitted changes. Branch checkout may fail or carry changes over.' -ForegroundColor Yellow; ",
                    "  Write-Host '' ",
                    "}}; ",
                    // 2. Detect default branch if needed
                    "{}",
                    // 3. Try checkout existing branch (suppress stderr red noise from git)
                    "Write-Host 'Checking out branch...' -ForegroundColor Yellow; ",
                    "$output = $(git checkout '{}' 2>&1); ",
                    "if ($LASTEXITCODE -ne 0) {{ ",
                    // 4. Branch doesn't exist, create from default branch
                    "  Write-Host \"Branch not found, creating from {}...\" -ForegroundColor Yellow; ",
                    "  $output = $(git checkout -b '{}' {} 2>&1); ",
                    "  if ($LASTEXITCODE -ne 0) {{ ",
                    "    Write-Host \"Failed to create branch (exit code $LASTEXITCODE). Continuing on current branch.\" -ForegroundColor Red; ",
                    "    Write-Host $output -ForegroundColor Red ",
                    "  }} else {{ ",
                    "    Write-Host 'New branch created and checked out.' -ForegroundColor Green ",
                    "  }} ",
                    "}} else {{ ",
                    "  Write-Host 'Branch checked out.' -ForegroundColor Green ",
                    "}}; Write-Host ''; ",
                ),
                detect_default, branch_name, base_branch_expr, branch_name, base_branch_expr,
            )
        } else {
            String::new()
        };

        // Validate env var names and inject into the PowerShell script so they survive WMI spawning
        for k in envs.keys() {
            crate::process::validate_env_var_name(k)?;
        }
        let env_setup: String = envs
            .iter()
            .map(|(k, v)| format!("$env:{} = '{}'; ", k, v.replace('\'', "''")))
            .collect();

        // Build the full PowerShell script with startup banner
        // Append --interactive with PowerShell single-quote escaping for safe prompt handling
        let interactive_suffix = if let Some(prompt) = &config.prompt {
            let escaped_prompt = prompt.replace('\'', "''");
            format!(" --interactive '{}'", escaped_prompt)
        } else {
            String::new()
        };
        let ps_cmd = format!(
            "{env_setup}$host.UI.RawUI.WindowTitle = 'Copilot Session'; Set-Location -LiteralPath '{}'; Write-Host 'Starting Copilot session in:' -ForegroundColor Cyan; Write-Host '  {}' -ForegroundColor White; Write-Host ''; {}{}{}",
            escaped_dir, escaped_dir, checkout_step, copilot_cmd, interactive_suffix
        );

        // Use -EncodedCommand (Base64 UTF-16LE) to avoid all escaping issues
        let encoded = crate::process::encode_powershell_command(&ps_cmd);
        crate::process::spawn_detached_terminal(
            "powershell",
            &["-NoExit", "-EncodedCommand", &encoded],
            &work_dir,
            None,
        )?
    };

    #[cfg(target_os = "macos")]
    let pid = {
        let checkout_prefix = checkout_cmd
            .as_deref()
            .map(|c| format!("{} && ", c))
            .unwrap_or_default();
        // Shell-escape prompt with single quotes for bash/zsh
        let interactive_suffix = if let Some(prompt) = &config.prompt {
            let escaped_prompt = prompt.replace('\'', "'\\''");
            format!(" --interactive '{}'", escaped_prompt)
        } else {
            String::new()
        };
        let full_cmd = format!("{}{}{}", checkout_prefix, copilot_cmd, interactive_suffix);
        let envs_ref = if envs.is_empty() { None } else { Some(&envs) };
        crate::process::spawn_detached_terminal(&full_cmd, &[], &work_dir, envs_ref)?
    };

    #[cfg(target_os = "linux")]
    let pid = {
        let checkout_prefix = checkout_cmd
            .as_deref()
            .map(|c| format!("{} && ", c))
            .unwrap_or_default();
        let interactive_suffix = if let Some(prompt) = &config.prompt {
            let escaped_prompt = prompt.replace('\'', "'\\''");
            format!(" --interactive '{}'", escaped_prompt)
        } else {
            String::new()
        };
        let full_cmd = format!("{}{}{}", checkout_prefix, copilot_cmd, interactive_suffix);
        let envs_ref = if envs.is_empty() { None } else { Some(&envs) };
        crate::process::spawn_detached_terminal(&full_cmd, &[], &work_dir, envs_ref)?
    };

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
        return Err(OrchestratorError::Launch(format!(
            "Path does not exist: {path}"
        )));
    }

    #[cfg(windows)]
    {
        // Windows explorer requires backslash paths
        let win_path = path.replace('/', "\\");
        Command::new("explorer")
            .arg(&win_path)
            .spawn()
            .map_err(|e| OrchestratorError::launch_ctx("Failed to open explorer", e))?;
    }

    #[cfg(target_os = "macos")]
    Command::new("open")
        .arg(path)
        .spawn()
        .map_err(|e| OrchestratorError::launch_ctx("Failed to open Finder", e))?;

    #[cfg(target_os = "linux")]
    Command::new("xdg-open")
        .arg(path)
        .spawn()
        .map_err(|e| OrchestratorError::launch_ctx("Failed to open file manager", e))?;

    Ok(())
}

/// Open a new terminal window at the given directory.
pub fn open_in_terminal(path: &str) -> Result<()> {
    let p = Path::new(path);
    if !p.exists() {
        return Err(OrchestratorError::Launch(format!(
            "Path does not exist: {path}"
        )));
    }

    // Empty program = just open a terminal at the directory
    crate::process::spawn_detached_terminal("", &[], p, None)?;
    Ok(())
}

/// List available models.
///
/// Keep in sync with the TypeScript model registry at
/// `packages/types/src/models.ts → MODEL_REGISTRY`.
pub fn available_models() -> Vec<ModelInfo> {
    models::available_models()
}

// ─── Internal helpers ─────────────────────────────────────────────

fn check_tool(name: &str, args: &[&str]) -> (bool, Option<String>) {
    // Try raw first, fallback to shell on Windows to catch aliases/functions/batch files
    // Use 5s timeout for version checks (should be instant)
    let output = match crate::process::run_hidden(name, args, None, Some(5)) {
        Ok(out) if out.status.success() => Some(out),
        _ => {
            #[cfg(windows)]
            {
                let full_cmd = if args.is_empty() {
                    name.to_string()
                } else {
                    format!("{} {}", name, args.join(" "))
                };
                crate::process::run_hidden_shell(&full_cmd, None, Some(5)).ok()
            }
            #[cfg(not(windows))]
            None
        }
    };

    match output {
        Some(out) => {
            let out_str = String::from_utf8_lossy(&out.stdout);
            let err_str = String::from_utf8_lossy(&out.stderr);
            // Search both streams for a version pattern; fallback to stdout if none found
            let version = extract_version(&out_str)
                .or_else(|| extract_version(&err_str))
                .unwrap_or_else(|| out_str.trim().to_string());
            (true, Some(version))
        }
        None => (false, None),
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
        assert!(tracepilot_core::utils::home_dir_opt().is_some());
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
        assert_eq!(
            extract_version("version 10.12.3 (build abc)"),
            Some("10.12.3".to_string())
        );
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
}
