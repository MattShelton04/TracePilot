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
    find_executables(name).into_iter().next()
}

/// Probe the system `PATH` for every executable matching `name`, in PATH
/// order.
///
/// On Windows `where.exe` lists every match, which matters for npm-style
/// installs where an extensionless shell shim precedes the spawnable
/// `.cmd` / `.exe`. On other platforms `which` reports only the first
/// match. Returns an empty list if the probe fails.
pub fn find_executables(name: &str) -> Vec<PathBuf> {
    #[cfg(windows)]
    let output = {
        let mut cmd = hidden_std_command("where");
        cmd.arg(name);
        cmd.output()
    };
    #[cfg(not(windows))]
    let output = Command::new("which").arg(name).output();

    let Ok(output) = output else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(|s| PathBuf::from(s.trim()))
        .filter(|p| !p.as_os_str().is_empty())
        .collect()
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

// ─── process_start_time ─────────────────────────────────────────────

/// When the process `pid` started, in the format Claude Code records as
/// `procStart`. `None` when no such process exists or the time cannot be read.
///
/// - Windows: its creation FILETIME (100 ns ticks since 1601, UTC) as a
///   decimal string, from one hidden PowerShell.
/// - Linux: `starttime` from `/proc/<pid>/stat` (clock ticks since boot).
/// - macOS: `ps -o lstart=` in the C locale and UTC, trimmed (for example
///   `Sat Oct 10 02:37:47 2026`).
///
/// Windows and macOS spawn a process, so call it only for a pid a session's
/// pid file names, never in a loop over every session.
pub fn process_start_time(pid: u32) -> Option<String> {
    #[cfg(windows)]
    {
        process_start_time_within(pid, PROCESS_START_TIMEOUT_SECS)
    }
    #[cfg(target_os = "linux")]
    {
        let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
        parse_proc_stat_start(&stat)
    }
    #[cfg(target_os = "macos")]
    {
        ps_start_time_within(pid, PROCESS_START_TIMEOUT_SECS)
    }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        let _ = pid;
        None
    }
}

/// `starttime`, field 22 of a `/proc/<pid>/stat` line. The command name in
/// field 2 may contain spaces and parentheses, so fields are counted from the
/// last `)`.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub(crate) fn parse_proc_stat_start(stat: &str) -> Option<String> {
    let after_comm = stat.get(stat.rfind(')')? + 1..)?;
    // Field 3 (state) is the first after the command name.
    let start = after_comm.split_whitespace().nth(22 - 3)?;
    start
        .bytes()
        .all(|b| b.is_ascii_digit())
        .then(|| start.to_owned())
}

/// The process start time as `ps -o lstart=` prints it in the C locale and
/// UTC, which is what Claude Code records on macOS. Built for every unix so
/// Linux CI exercises the macOS lookup.
#[cfg(unix)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) fn ps_start_time_within(pid: u32, timeout_secs: u64) -> Option<String> {
    let mut cmd = Command::new("ps");
    cmd.args(["-o", "lstart=", "-p", &pid.to_string()])
        .env("LC_ALL", "C")
        .env("TZ", "UTC")
        .stdin(std::process::Stdio::null());
    let child = spawn_captured_child(cmd, "ps").ok()?;
    let (stdout, _, status) = execute_with_timeout(child, timeout_secs).ok()?;
    let start = String::from_utf8_lossy(&stdout).trim().to_owned();
    (status.success() && !start.is_empty()).then_some(start)
}

/// [`process_start_time`] with its PowerShell bounded by `timeout_secs`. A
/// lookup that times out reads as `None`, the same as a missing process.
#[cfg(windows)]
pub(crate) fn process_start_time_within(pid: u32, timeout_secs: u64) -> Option<String> {
    let script =
        format!("[System.Diagnostics.Process]::GetProcessById({pid}).StartTime.ToFileTimeUtc()");
    let stdout = run_hidden_stdout(
        "powershell",
        &["-NoProfile", "-NonInteractive", "-Command", &script],
        None,
        Some(timeout_secs),
    )
    .ok()?;
    parse_filetime(&stdout)
}

#[cfg(any(windows, target_os = "macos"))]
const PROCESS_START_TIMEOUT_SECS: u64 = 10;

/// A FILETIME in decimal, re-rendered so stray output never matches.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn parse_filetime(stdout: &str) -> Option<String> {
    stdout
        .trim()
        .parse::<u64>()
        .ok()
        .filter(|ticks| *ticks > 0)
        .map(|ticks| ticks.to_string())
}
