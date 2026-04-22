//! User-facing detached terminal spawning.
//!
//! Opens a new visible terminal window per platform and, on Windows,
//! escapes the app's Job object so the terminal survives parent exit.

use crate::error::{OrchestratorError, Result};
use std::collections::HashMap;
use std::path::Path;
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
use tracepilot_core::constants::CREATE_NO_WINDOW;

// ─── Windows creation flags ─────────────────────────────────────────
#[cfg(windows)]
const CREATE_NEW_CONSOLE: u32 = 0x00000010;
#[cfg(windows)]
const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x01000000;

// ─── Linux terminal emulator fallback list ──────────────────────────
#[cfg(target_os = "linux")]
const LINUX_TERMINALS: &[&str] = &[
    "x-terminal-emulator",
    "gnome-terminal",
    "konsole",
    "xfce4-terminal",
    "xterm",
];

/// Spawn a process in a new visible terminal window, detached from the
/// parent app's job object so it survives app exit.
///
/// # Platform behavior
///
/// - **Windows**: Three-tier strategy to escape Tauri's `KILL_ON_JOB_CLOSE`:
///   1. `CREATE_BREAKAWAY_FROM_JOB` — fastest, if the Job allows it
///   2. WMI `Win32_Process.Create` — delegates to wmiprvse.exe (outside job)
///   3. Plain `CREATE_NEW_CONSOLE` — graceful degradation
///
/// - **macOS**: Opens a new Terminal.app window via `osascript`.
///
/// - **Linux**: Tries common terminal emulators in order.
///
/// Returns the PID of the spawned terminal wrapper process.
pub fn spawn_detached_terminal(
    program: &str,
    args: &[&str],
    work_dir: &Path,
    envs: Option<&HashMap<String, String>>,
) -> Result<u32> {
    #[cfg(windows)]
    {
        let _ = envs; // Env vars are baked into the PowerShell script by callers
        spawn_outside_job_win(program, args, work_dir)
    }

    #[cfg(target_os = "macos")]
    {
        spawn_terminal_macos(program, args, work_dir, envs)
    }

    #[cfg(target_os = "linux")]
    {
        spawn_terminal_linux(program, args, work_dir, envs)
    }
}

// ─── Windows: three-tier detached spawn ─────────────────────────────

#[cfg(windows)]
fn spawn_outside_job_win(program: &str, args: &[&str], work_dir: &Path) -> Result<u32> {
    // Default to powershell if no program specified (e.g., "open terminal here")
    let program = if program.is_empty() {
        "powershell"
    } else {
        program
    };

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
        Err(e) => {
            return Err(OrchestratorError::Launch(format!(
                "Failed to spawn terminal: {e}"
            )));
        }
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
        .map_err(|e| OrchestratorError::launch_ctx("WMI fallback failed", e))?;

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
        .map_err(|e| OrchestratorError::launch_ctx("Failed to spawn terminal", e))?;
    Ok(child.id())
}

// ─── macOS: osascript Terminal.app ──────────────────────────────────

#[cfg(target_os = "macos")]
fn spawn_terminal_macos(
    program: &str,
    args: &[&str],
    work_dir: &Path,
    envs: Option<&HashMap<String, String>>,
) -> Result<u32> {
    use super::{shell_quote, validate_env_var_name};

    let escaped_cwd = shell_quote(&work_dir.display().to_string());

    // Build the script parts: cd, optional env exports, optional command
    let mut parts: Vec<String> = vec![format!("cd {}", escaped_cwd)];

    if let Some(e) = envs {
        for (k, v) in e {
            validate_env_var_name(k)?;
            parts.push(format!("export {}={}", k, shell_quote(v)));
        }
    }

    if !program.is_empty() {
        let cmd_str = if args.is_empty() {
            program.to_string()
        } else {
            format!("{} {}", program, args.join(" "))
        };
        parts.push(cmd_str);
    }

    // Escape for AppleScript double-quoted string context:
    // The content will be inside `do script "..."` so backslashes and
    // double-quotes must be escaped for the AppleScript parser.
    let body = parts.join(" && ");
    let applescript_safe = body.replace('\\', "\\\\").replace('"', "\\\"");

    let script = format!(
        "tell app \"Terminal\" to do script \"{}\"",
        applescript_safe
    );

    let child = Command::new("osascript")
        .args(["-e", &script])
        .spawn()
        .map_err(|e| OrchestratorError::launch_ctx("Failed to open terminal", e))?;
    Ok(child.id())
}

// ─── Linux: terminal emulator fallback chain ────────────────────────

#[cfg(target_os = "linux")]
fn spawn_terminal_linux(
    program: &str,
    args: &[&str],
    work_dir: &Path,
    envs: Option<&HashMap<String, String>>,
) -> Result<u32> {
    use super::validate_env_var_name;

    for term in LINUX_TERMINALS {
        let mut command = Command::new(term);

        // If a program is specified, pass it via -e; otherwise just open a shell
        if !program.is_empty() {
            let cmd_str = if args.is_empty() {
                program.to_string()
            } else {
                format!("{} {}", program, args.join(" "))
            };
            command.args(["-e", &cmd_str]);
        }

        command.current_dir(work_dir);
        if let Some(e) = envs {
            for k in e.keys() {
                validate_env_var_name(k)?;
            }
            command.envs(e.iter().map(|(k, v)| (k.as_str(), v.as_str())));
        }
        if let Ok(child) = command.spawn() {
            return Ok(child.id());
        }
    }

    Err(OrchestratorError::Launch(
        "No terminal emulator found".into(),
    ))
}

// ─── Backward-compatible re-exports ─────────────────────────────────

/// Backward-compatible alias for [`spawn_detached_terminal`] (Windows only).
///
/// Prefer using `spawn_detached_terminal` directly in new code.
#[cfg(windows)]
pub fn spawn_outside_job(
    program: &str,
    args: &[&str],
    work_dir: &Path,
) -> std::result::Result<u32, OrchestratorError> {
    spawn_detached_terminal(program, args, work_dir, None)
}
