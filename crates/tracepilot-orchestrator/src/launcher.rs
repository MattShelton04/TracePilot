//! Copilot CLI session launcher.

use crate::error::{OrchestratorError, Result};
use crate::types::{CreateWorktreeRequest, LaunchConfig, LaunchedSession, ModelInfo, SystemDependencies};
use crate::worktrees;
use std::path::Path;
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Encode a PowerShell command string as Base64 UTF-16LE for use with -EncodedCommand.
/// This bypasses all command-line escaping issues on Windows.
#[cfg(windows)]
pub fn encode_powershell_command(cmd: &str) -> String {
    use std::io::Write;
    let utf16: Vec<u8> = cmd.encode_utf16().flat_map(|c| c.to_le_bytes()).collect();
    let mut buf = Vec::new();
    {
        let mut encoder = Base64Encoder::new(&mut buf);
        encoder.write_all(&utf16).unwrap();
        encoder.finish().unwrap();
    }
    String::from_utf8(buf).unwrap()
}

/// Minimal base64 encoder (no external dependency needed).
#[cfg(windows)]
struct Base64Encoder<W: std::io::Write> {
    writer: W,
    buf: [u8; 3],
    len: usize,
}

#[cfg(windows)]
impl<W: std::io::Write> Base64Encoder<W> {
    fn new(writer: W) -> Self { Self { writer, buf: [0; 3], len: 0 } }

    fn finish(mut self) -> std::io::Result<()> {
        if self.len > 0 {
            self.encode_block()?;
        }
        Ok(())
    }

    fn encode_block(&mut self) -> std::io::Result<()> {
        const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let b = &self.buf;
        let out = match self.len {
            3 => [
                CHARS[(b[0] >> 2) as usize],
                CHARS[((b[0] & 0x03) << 4 | b[1] >> 4) as usize],
                CHARS[((b[1] & 0x0f) << 2 | b[2] >> 6) as usize],
                CHARS[(b[2] & 0x3f) as usize],
            ],
            2 => [
                CHARS[(b[0] >> 2) as usize],
                CHARS[((b[0] & 0x03) << 4 | b[1] >> 4) as usize],
                CHARS[((b[1] & 0x0f) << 2) as usize],
                b'=',
            ],
            1 => [
                CHARS[(b[0] >> 2) as usize],
                CHARS[((b[0] & 0x03) << 4) as usize],
                b'=',
                b'=',
            ],
            _ => return Ok(()),
        };
        self.writer.write_all(&out)?;
        self.len = 0;
        self.buf = [0; 3];
        Ok(())
    }
}

#[cfg(windows)]
impl<W: std::io::Write> std::io::Write for Base64Encoder<W> {
    fn write(&mut self, data: &[u8]) -> std::io::Result<usize> {
        let mut written = 0;
        for &byte in data {
            self.buf[self.len] = byte;
            self.len += 1;
            if self.len == 3 {
                self.encode_block()?;
            }
            written += 1;
        }
        Ok(written)
    }
    fn flush(&mut self) -> std::io::Result<()> { self.writer.flush() }
}

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

/// Spawn a process in a new console window that survives parent-app shutdown.
///
/// On Windows, Tauri/WebView2 places child processes in a Job Object with
/// `KILL_ON_JOB_CLOSE`. We use a three-tier strategy to escape it:
///
/// 1. **`CREATE_BREAKAWAY_FROM_JOB`** — fastest, works if the Job allows breakaway.
/// 2. **WMI `Win32_Process.Create`** — delegates creation to the WMI service process,
///    which is outside the Job Object entirely.
/// 3. **Plain `CREATE_NEW_CONSOLE`** — graceful degradation; terminal may die with app.
#[cfg(windows)]
pub fn spawn_outside_job(
    program: &str,
    args: &[&str],
    work_dir: &Path,
) -> std::result::Result<u32, OrchestratorError> {
    const CREATE_NEW_CONSOLE: u32 = 0x00000010;
    const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x01000000;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    // Strategy 1: direct spawn with breakaway flag
    match Command::new(program)
        .args(args)
        .current_dir(work_dir)
        .creation_flags(CREATE_NEW_CONSOLE | CREATE_BREAKAWAY_FROM_JOB)
        .spawn()
    {
        Ok(child) => return Ok(child.id()),
        Err(e) if e.raw_os_error() == Some(5) => {
            tracing::debug!("CREATE_BREAKAWAY_FROM_JOB denied, falling back to WMI");
        }
        Err(e) => return Err(OrchestratorError::Launch(format!("Failed to spawn terminal: {e}"))),
    }

    // Strategy 2: WMI Win32_Process.Create (runs via wmiprvse.exe, outside job)
    let cmd_line = if args.is_empty() {
        format!("\"{}\"", program)
    } else {
        let quoted_args: Vec<String> = args
            .iter()
            .map(|a| {
                if a.contains(' ') {
                    format!("\"{}\"", a)
                } else {
                    a.to_string()
                }
            })
            .collect();
        format!("\"{}\" {}", program, quoted_args.join(" "))
    };

    let escaped_cmd = cmd_line.replace('\'', "''");
    let escaped_dir = work_dir.display().to_string().replace('\'', "''");
    let wmi_script = format!(
        "$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create \
         -Arguments @{{CommandLine='{escaped_cmd}'; CurrentDirectory='{escaped_dir}'}}; \
         if ($r.ReturnValue -ne 0) {{ throw \"WMI Create failed (code $($r.ReturnValue))\" }}; \
         $r.ProcessId"
    );

    let output = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &wmi_script])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| OrchestratorError::Launch(format!("WMI fallback failed: {e}")))?;

    if output.status.success() {
        let pid = String::from_utf8_lossy(&output.stdout)
            .trim()
            .parse::<u32>()
            .unwrap_or(0);
        tracing::info!("Terminal spawned via WMI (pid {pid})");
        return Ok(pid);
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    tracing::warn!("WMI fallback failed: {stderr}");

    // Strategy 3: plain CREATE_NEW_CONSOLE (terminal may die with parent)
    tracing::warn!("All detach strategies failed; terminal may not survive app exit");
    let child = Command::new(program)
        .args(args)
        .current_dir(work_dir)
        .creation_flags(CREATE_NEW_CONSOLE)
        .spawn()
        .map_err(|e| OrchestratorError::Launch(format!("Failed to spawn terminal: {e}")))?;
    Ok(child.id())
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

    // Sanitize CLI command — allow only safe characters
    let cli = &config.cli_command;
    if !cli.chars().all(|c| c.is_alphanumeric() || "-_./\\ :".contains(c)) {
        return Err(OrchestratorError::Launch(
            "CLI command contains invalid characters".into(),
        ));
    }

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

    // Build the CLI command string using the user-configured CLI command
    let copilot_cmd = if args.is_empty() {
        cli.clone()
    } else {
        format!("{} {}", cli, args.join(" "))
    };

    // If a branch was specified but we're NOT creating a worktree, checkout the branch first
    let checkout_cmd = if !config.create_worktree {
        config.branch.as_deref().map(|b| {
            let escaped = b.replace('\'', "''");
            // Try checkout; if it fails (branch doesn't exist locally), try creating from remote
            format!("git checkout '{b}'" , b = escaped)
        })
    } else {
        None
    };

    #[cfg(windows)]
    let pid = {
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
                    // 3. Try checkout existing branch
                    "Write-Host 'Checking out branch...' -ForegroundColor Yellow; ",
                    "git checkout '{}' 2>&1; ",
                    "if ($LASTEXITCODE -ne 0) {{ ",
                    // 4. Branch doesn't exist, create from default branch
                    "  Write-Host \"Branch not found, creating from {}...\" -ForegroundColor Yellow; ",
                    "  git checkout -b '{}' {} 2>&1; ",
                    "  if ($LASTEXITCODE -ne 0) {{ ",
                    "    Write-Host \"Failed to create branch (exit code $LASTEXITCODE). Continuing on current branch.\" -ForegroundColor Red ",
                    "  }} else {{ ",
                    "    Write-Host 'New branch created and checked out.' -ForegroundColor Green ",
                    "  }} ",
                    "}} else {{ ",
                    "  Write-Host 'Branch checked out.' -ForegroundColor Green ",
                    "}}; Write-Host ''; ",
                ),
                detect_default,
                branch_name,
                base_branch_expr,
                branch_name,
                base_branch_expr,
            )
        } else {
            String::new()
        };

        // Inject env vars into the PowerShell script so they survive WMI spawning
        let env_setup: String = envs
            .iter()
            .map(|(k, v)| {
                format!(
                    "$env:{} = '{}'; ",
                    k,
                    v.replace('\'', "''")
                )
            })
            .collect();

        // Build the full PowerShell script with startup banner
        let ps_cmd = format!(
            "{env_setup}$host.UI.RawUI.WindowTitle = 'Copilot Session'; Set-Location -LiteralPath '{}'; Write-Host 'Starting Copilot session in:' -ForegroundColor Cyan; Write-Host '  {}' -ForegroundColor White; Write-Host ''; {}{}{}",
            escaped_dir,
            escaped_dir,
            checkout_step,
            clipboard_cmd,
            copilot_cmd
        );

        // Use -EncodedCommand (Base64 UTF-16LE) to avoid all escaping issues
        let encoded = encode_powershell_command(&ps_cmd);
        spawn_outside_job(
            "powershell",
            &["-NoExit", "-EncodedCommand", &encoded],
            &work_dir,
        )?
    };

    #[cfg(target_os = "macos")]
    let pid = {
        let escaped_cwd = shell_quote(&work_dir.display().to_string());
        let checkout_prefix = checkout_cmd.as_deref().map(|c| format!("{} && ", c)).unwrap_or_default();
        let script = format!(
            "tell app \"Terminal\" to do script \"cd {} && {}{}\"",
            escaped_cwd, checkout_prefix, copilot_cmd
        );
        Command::new("osascript")
            .args(["-e", &script])
            .spawn()
            .map_err(|e| OrchestratorError::Launch(format!("Failed to open terminal: {e}")))?
            .id()
    };

    #[cfg(target_os = "linux")]
    let pid = {
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
        result.ok_or_else(|| OrchestratorError::Launch("No terminal emulator found".into()))?.id()
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
        spawn_outside_job("powershell", &[], p)?;
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

    #[cfg(windows)]
    #[test]
    fn test_encode_powershell_command() {
        // "Write-Host 'hi'" encoded as UTF-16LE then Base64
        let cmd = "Write-Host 'hi'";
        let encoded = encode_powershell_command(cmd);
        // Verify it's valid base64 and decodes back to correct UTF-16LE
        let bytes = (0..encoded.len())
            .step_by(4)
            .flat_map(|i| {
                let chunk = &encoded[i..std::cmp::min(i + 4, encoded.len())];
                let vals: Vec<u8> = chunk.bytes().map(|b| match b {
                    b'A'..=b'Z' => b - b'A',
                    b'a'..=b'z' => b - b'a' + 26,
                    b'0'..=b'9' => b - b'0' + 52,
                    b'+' => 62,
                    b'/' => 63,
                    b'=' => 0,
                    _ => panic!("invalid base64"),
                }).collect();
                let pad = chunk.bytes().filter(|&b| b == b'=').count();
                let mut out = Vec::new();
                out.push((vals[0] << 2) | (vals[1] >> 4));
                if pad < 2 { out.push((vals[1] << 4) | (vals[2] >> 2)); }
                if pad < 1 { out.push((vals[2] << 6) | vals[3]); }
                out
            })
            .collect::<Vec<u8>>();
        let decoded: String = bytes.chunks(2)
            .filter_map(|c| if c.len() == 2 { Some(u16::from_le_bytes([c[0], c[1]])) } else { None })
            .filter_map(|c| char::from_u32(c as u32))
            .collect();
        assert_eq!(decoded, cmd);
    }
}
