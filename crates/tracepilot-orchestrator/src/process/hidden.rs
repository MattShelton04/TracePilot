//! Hidden (no-window) process spawning, plus related encoding helpers
//! (`win32_quote_arg`, `encode_powershell_command`, `encode_prompt_utf8_base64`)
//! that are consumed by callers building hidden command lines.
//!
//! The Windows `CREATE_NO_WINDOW` flag (`0x0800_0000`) is applied here via
//! [`hidden_command`] / [`hidden_std_command`]; downstream callers should
//! prefer those helpers over hand-rolling `.creation_flags(...)`.

use crate::error::{OrchestratorError, Result};
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
use tracepilot_core::constants::CREATE_NO_WINDOW;

use super::timeout::{execute_with_timeout, run_with_timeout, spawn_captured_child};

// ─── Hidden command builders ────────────────────────────────────────

/// Build a [`tokio::process::Command`] configured to run hidden
/// (no flashing console window on Windows). On non-Windows, returns
/// a plain command.
///
/// Prefer this helper over manually applying `.creation_flags(...)` at
/// every call site — the goal is to keep the `CREATE_NO_WINDOW` flag
/// applied consistently across the workspace.
pub fn hidden_command(program: &str) -> tokio::process::Command {
    #[allow(unused_mut)]
    let mut cmd = tokio::process::Command::new(program);
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Synchronous (`std::process::Command`) variant of [`hidden_command`].
pub fn hidden_std_command(program: &str) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

// ─── find_executable ────────────────────────────────────────────────

/// Probe the system `PATH` for an executable by name.
///
/// On Windows, invokes `where.exe <name>` with `CREATE_NO_WINDOW` so no
/// console window flashes. On other platforms, invokes `which <name>`.
/// Returns the first matching path, or `None` if the probe fails or the
/// executable is not found.
///
/// Use this helper instead of inlining `Command::new("where"/"which")`
/// so that all probes share the same hidden-window + flag semantics.
pub fn find_executable(name: &str) -> Option<PathBuf> {
    #[cfg(windows)]
    {
        let mut cmd = hidden_std_command("where");
        cmd.arg(name);
        let output = cmd.output().ok()?;
        if !output.status.success() {
            return None;
        }
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .next()
            .map(|s| PathBuf::from(s.trim()))
            .filter(|p| !p.as_os_str().is_empty())
    }
    #[cfg(not(windows))]
    {
        let output = Command::new("which").arg(name).output().ok()?;
        if !output.status.success() {
            return None;
        }
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .next()
            .map(|s| PathBuf::from(s.trim()))
            .filter(|p| !p.as_os_str().is_empty())
    }
}

// ─── run_hidden family ──────────────────────────────────────────────

/// Run a command invisibly, capturing stdout and stderr.
///
/// On Windows, sets `CREATE_NO_WINDOW` to prevent console/conhost windows
/// from flashing when a GUI-subsystem app spawns console-mode children
/// (e.g. `git.exe`).
///
/// Pass `cwd: Some(&path)` to set the working directory, or `None` to
/// inherit the parent's CWD.
///
/// If `timeout_secs` is `Some`, the process will be killed if it doesn't
/// complete within that duration.
pub fn run_hidden(
    program: &str,
    args: &[&str],
    cwd: Option<&Path>,
    timeout_secs: Option<u64>,
) -> Result<Output> {
    let mut cmd = hidden_std_command(program);
    cmd.args(args);
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }

    match timeout_secs {
        Some(timeout) => run_with_timeout(cmd, program, args, timeout),
        None => cmd.output().map_err(Into::into),
    }
}

/// Run a command on Windows via `cmd.exe /c` to get PATHEXT / alias /
/// batch-file resolution when direct `CreateProcess` fails.
///
/// **IMPORTANT — this is not an injection-safe escape hatch.** Windows
/// fundamentally passes a single command-line string to `CreateProcess`,
/// so `cmd.exe` will re-tokenise metacharacters (`&`, `|`, `>`, `<`, `^`)
/// that appear anywhere in the joined command line. This helper is
/// appropriate **only** when `program` and `args` come from a closed
/// set of trusted, hardcoded values (e.g. the `check_system_deps` tool
/// list). For anything touched by user input, use [`run_hidden`]
/// directly with a validated argv, or reject the input upstream.
///
/// The benefit over the deprecated [`run_hidden_shell`] is that callers
/// no longer have to `format!("{program} {args}")` themselves — that
/// anti-pattern is now contained inside the trust boundary of this one
/// function, which at least documents the constraint explicitly.
///
/// On non-Windows platforms this is an error — the direct
/// [`run_hidden`] exec already resolves via `PATH` on POSIX.
pub fn run_hidden_via_cmd(
    program: &str,
    args: &[&str],
    cwd: Option<&Path>,
    timeout_secs: Option<u64>,
) -> Result<Output> {
    #[cfg(windows)]
    {
        let mut argv = Vec::with_capacity(args.len() + 2);
        argv.push("/c");
        argv.push(program);
        argv.extend_from_slice(args);

        let mut cmd = hidden_std_command("cmd");
        cmd.args(&argv);
        if let Some(dir) = cwd {
            cmd.current_dir(dir);
        }

        match timeout_secs {
            Some(timeout) => run_with_timeout(cmd, "cmd", &argv, timeout),
            None => cmd.output().map_err(Into::into),
        }
    }

    #[cfg(not(windows))]
    {
        let _ = (program, args, cwd, timeout_secs);
        Err(OrchestratorError::Launch(
            "run_hidden_via_cmd is Windows-only; use run_hidden on POSIX".into(),
        ))
    }
}

/// Run a shell script file invisibly, capturing stdout and stderr.
///
/// **WARNING — prefer [`run_hidden`] whenever possible.** Shell invocation
/// is only appropriate when the command genuinely needs shell resolution
/// (aliases, PATH lookup for built-in functions, or executing an explicit
/// `.ps1`/`.sh` script). For everything else — and especially for any
/// value that originated from user input — use [`run_hidden`] with an
/// explicit `program` + argv slice.
///
/// Run a command through a shell, with `full_command` interpreted as a
/// shell script string.
///
/// **DEPRECATED — DO NOT USE FOR NEW CODE.** Use [`run_hidden`] with an
/// explicit `(program, &[args])` argv whenever possible. If you need to
/// resolve Windows aliases / `PATHEXT` extensions (batch files,
/// PowerShell functions), use [`run_hidden_via_cmd`] which passes the
/// program and arguments as separate argv entries to `cmd.exe /c`
/// without concatenation.
///
/// This function does **not** sanitise `full_command`; callers are
/// responsible for ensuring it is not attacker-controlled. See the
/// Phase 1A.4 audit in `docs/tech-debt-plan-revised-2026-04.md`.
///
/// On Windows, uses `powershell -Command`. On Unix, uses `sh -c`.
///
/// If `timeout_secs` is `Some`, the process will be killed if it doesn't
/// complete within that duration.
#[deprecated(
    note = "prefer run_hidden with explicit argv; use run_hidden_via_cmd on Windows for alias/PATHEXT resolution"
)]
pub fn run_hidden_shell(
    full_command: &str,
    cwd: Option<&Path>,
    timeout_secs: Option<u64>,
) -> Result<Output> {
    #[cfg(windows)]
    {
        let mut cmd = hidden_std_command("powershell");
        cmd.args(["-NoProfile", "-NonInteractive", "-Command", full_command]);
        if let Some(dir) = cwd {
            cmd.current_dir(dir);
        }

        match timeout_secs {
            Some(timeout) => {
                run_with_timeout(cmd, "powershell", &["-Command", full_command], timeout)
            }
            None => cmd.output().map_err(Into::into),
        }
    }

    #[cfg(not(windows))]
    {
        let mut cmd = Command::new("sh");
        cmd.args(["-c", full_command]);
        if let Some(dir) = cwd {
            cmd.current_dir(dir);
        }

        match timeout_secs {
            Some(timeout) => run_with_timeout(cmd, "sh", &["-c", full_command], timeout),
            None => cmd.output().map_err(Into::into),
        }
    }
}

/// Convenience wrapper: run a hidden command and return trimmed stdout on success.
///
/// Returns `OrchestratorError::Launch` if the command exits with non-zero status,
/// including stderr in the error message.
///
/// If `timeout_secs` is `Some`, the process will be killed if it doesn't
/// complete within that duration.
pub fn run_hidden_stdout(
    program: &str,
    args: &[&str],
    cwd: Option<&Path>,
    timeout_secs: Option<u64>,
) -> Result<String> {
    let output = run_hidden(program, args, cwd, timeout_secs)?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(OrchestratorError::Launch(format!(
            "{} failed (exit {}): {}",
            program,
            output.status.code().unwrap_or(-1),
            stderr
        )))
    }
}

/// Run a hidden command with a wall-clock timeout, returning trimmed stdout.
///
/// If the process does not complete within `timeout_secs` seconds it is killed
/// and an error is returned. This prevents commands like `gh api` from blocking
/// indefinitely on large repositories or slow network connections.
pub fn run_hidden_stdout_timeout(
    program: &str,
    args: &[&str],
    cwd: Option<&Path>,
    timeout_secs: u64,
) -> Result<String> {
    let mut cmd = hidden_std_command(program);
    cmd.args(args);
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }

    let child = spawn_captured_child(cmd, program)?;

    match execute_with_timeout(child, timeout_secs) {
        Ok((stdout, stderr, status)) => {
            if status.success() {
                Ok(String::from_utf8_lossy(&stdout).trim().to_string())
            } else {
                let stderr_str = String::from_utf8_lossy(&stderr).trim().to_string();
                Err(OrchestratorError::Launch(format!(
                    "{program} failed (exit {}): {stderr_str}",
                    status.code().unwrap_or(-1)
                )))
            }
        }
        Err(e) => {
            if let OrchestratorError::Timeout { secs } = &e {
                Err(OrchestratorError::Launch(format!(
                    "GitHub API call timed out after {secs}s. \
                     Check your internet connection and try again."
                )))
            } else {
                Err(e)
            }
        }
    }
}

// ─── is_alive ───────────────────────────────────────────────────────

/// Check if a process with the given PID is still alive (portable, no extra deps).
pub fn is_alive(pid: u32) -> bool {
    #[cfg(windows)]
    {
        hidden_std_command("tasklist")
            .args(["/NH", "/FI", &format!("PID eq {pid}")])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output()
            .map(|o| {
                let out = String::from_utf8_lossy(&o.stdout);
                // tasklist returns "INFO: No tasks..." when PID doesn't exist
                !out.contains("No tasks") && out.contains(&pid.to_string())
            })
            .unwrap_or(false)
    }
    #[cfg(unix)]
    {
        // signal 0 checks process existence without killing it
        Command::new("kill")
            .args(["-0", &pid.to_string()])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }
}
