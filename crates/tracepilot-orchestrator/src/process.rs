//! Centralized process execution for TracePilot.
//!
//! All child-process spawning should go through this module to ensure:
//! - Internal/hidden commands don't flash terminal windows on Windows
//! - User-facing terminal launches are properly detached from the app's job object
//! - Platform-specific terminal detection logic is defined in one place

use crate::error::{OrchestratorError, Result};
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Output};
use std::sync::{Arc, Mutex, mpsc};
use std::time::Duration;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

// ─── Windows creation flags ─────────────────────────────────────────
#[cfg(windows)]
const CREATE_NEW_CONSOLE: u32 = 0x00000010;
#[cfg(windows)]
const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x01000000;
/// Re-export of the cross-crate constant so existing
/// `crate::process::CREATE_NO_WINDOW` references keep compiling.
/// New code should import `tracepilot_core::constants::CREATE_NO_WINDOW`.
#[cfg(windows)]
pub(crate) use tracepilot_core::constants::CREATE_NO_WINDOW;

// ─── Linux terminal emulator fallback list ──────────────────────────
#[cfg(target_os = "linux")]
const LINUX_TERMINALS: &[&str] = &[
    "x-terminal-emulator",
    "gnome-terminal",
    "konsole",
    "xfce4-terminal",
    "xterm",
];

// ─── Internal helpers ───────────────────────────────────────────────

/// Internal helper: spawn a command with stdout/stderr piped.
fn spawn_captured_child(mut cmd: Command, program: &str) -> Result<Child> {
    cmd.stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    cmd.spawn()
        .map_err(|e| OrchestratorError::launch_ctx(format!("Failed to spawn {program}"), e))
}

fn read_pipe_to_end<R>(mut reader: R, label: &'static str) -> mpsc::Receiver<Result<Vec<u8>>>
where
    R: Read + Send + 'static,
{
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut buf = Vec::new();
        let result = reader
            .read_to_end(&mut buf)
            .map(|_| buf)
            .map_err(|e| OrchestratorError::launch_ctx(format!("Failed to read {label}"), e));
        let _ = tx.send(result);
    });
    rx
}

/// Core timeout implementation: execute a spawned child process with a wall-clock timeout.
///
/// This function handles:
/// - Async stdout/stderr reading via background threads
/// - Shared child process ownership for timeout-based kill
/// - Timeout detection via `recv_timeout()`
///
/// Returns `(stdout, stderr, status)` on success, or an error if:
/// - The child process cannot be waited on (mutex poison, wait failure)
/// - Pipe reader threads disconnect
/// - The process exceeds `timeout_secs`
///
/// On timeout, attempts to kill the child and logs any kill failures.
fn execute_with_timeout(
    mut child: Child,
    timeout_secs: u64,
) -> std::result::Result<(Vec<u8>, Vec<u8>, std::process::ExitStatus), OrchestratorError> {
    // Take the pipe handles before wrapping the child so the thread owns them.
    // Return an error if pipes weren't configured (defensive programming - should never happen).
    let stdout_pipe = child.stdout.take().ok_or_else(|| {
        OrchestratorError::Launch("stdout not piped: process was not configured correctly".into())
    })?;
    let stderr_pipe = child.stderr.take().ok_or_else(|| {
        OrchestratorError::Launch("stderr not piped: process was not configured correctly".into())
    })?;
    let stdout_rx = read_pipe_to_end(stdout_pipe, "stdout");
    let stderr_rx = read_pipe_to_end(stderr_pipe, "stderr");

    // Wrap child in Arc<Mutex> so the main thread can kill it on timeout.
    let child_shared = Arc::new(Mutex::new(child));
    let child_for_thread = Arc::clone(&child_shared);

    let (tx, rx) = mpsc::channel::<
        std::result::Result<(Vec<u8>, Vec<u8>, std::process::ExitStatus), OrchestratorError>,
    >();

    std::thread::spawn(move || {
        let result = child_for_thread
            .lock()
            .map_err(|_| OrchestratorError::Launch("mutex poisoned".into()))
            .and_then(|mut c| {
                c.wait()
                    .map_err(|e| OrchestratorError::launch_ctx("wait failed", e))
            })
            .and_then(|status| {
                let stdout = stdout_rx.recv().map_err(|_| {
                    OrchestratorError::Launch("stdout reader thread disconnected".into())
                })??;
                let stderr = stderr_rx.recv().map_err(|_| {
                    OrchestratorError::Launch("stderr reader thread disconnected".into())
                })??;
                Ok((stdout, stderr, status))
            });
        let _ = tx.send(result);
    });

    match rx.recv_timeout(Duration::from_secs(timeout_secs)) {
        Ok(result) => result,
        Err(_) => {
            // Timeout occurred - attempt to kill the process
            if let Ok(mut child) = child_shared.lock()
                && let Err(e) = child.kill()
            {
                tracing::warn!("Failed to kill timed-out process: {}", e);
            }
            Err(OrchestratorError::Timeout { secs: timeout_secs })
        }
    }
}

fn run_with_timeout(
    cmd: Command,
    program: &str,
    args: &[&str],
    timeout_secs: u64,
) -> Result<Output> {
    let child = spawn_captured_child(cmd, program)?;

    match execute_with_timeout(child, timeout_secs) {
        Ok((stdout, stderr, status)) => Ok(Output {
            status,
            stdout,
            stderr,
        }),
        Err(e) => {
            // Enhance timeout error with command context
            if let OrchestratorError::Timeout { secs } = &e {
                let cmd_display = if args.is_empty() {
                    program.to_string()
                } else {
                    format!("{} {}", program, args.join(" "))
                };
                Err(OrchestratorError::Launch(format!(
                    "Command timed out after {secs}s: {cmd_display}. \
                     Check system resources and try again."
                )))
            } else {
                Err(e)
            }
        }
    }
}

// ─── Hidden execution (internal commands) ───────────────────────────

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
        let mut cmd = Command::new("where");
        cmd.arg(name).creation_flags(CREATE_NO_WINDOW);
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
    let mut cmd = Command::new(program);
    cmd.args(args);
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

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
/// no longer have to `format!(\"{program} {args}\")` themselves — that
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
        // cmd.exe /c <program> <arg1> <arg2> ... — each argv element is
        // forwarded to cmd, which performs PATHEXT + alias resolution on
        // `program` but does NOT re-tokenise subsequent args. This gives
        // us the resolution benefit of a shell without the injection
        // surface of passing a single concatenated command string.
        let mut argv = Vec::with_capacity(args.len() + 2);
        argv.push("/c");
        argv.push(program);
        argv.extend_from_slice(args);

        let mut cmd = Command::new("cmd");
        cmd.args(&argv);
        if let Some(dir) = cwd {
            cmd.current_dir(dir);
        }
        cmd.creation_flags(CREATE_NO_WINDOW);

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
        let mut cmd = Command::new("powershell");
        cmd.args(["-NoProfile", "-NonInteractive", "-Command", full_command]);
        if let Some(dir) = cwd {
            cmd.current_dir(dir);
        }
        cmd.creation_flags(CREATE_NO_WINDOW);

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
    let mut cmd = Command::new(program);
    cmd.args(args);
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

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
            // Enhance timeout error with user-friendly context
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

// ─── Detached terminal spawning (user-facing) ───────────────────────

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

// ─── PowerShell encoding (Windows) ──────────────────────────────────

/// Encode a PowerShell command string as Base64 UTF-16LE for use with
/// `-EncodedCommand`. This bypasses all command-line escaping issues.
#[cfg(windows)]
pub fn encode_powershell_command(cmd: &str) -> String {
    use std::io::Write;
    let utf16: Vec<u8> = cmd.encode_utf16().flat_map(|c| c.to_le_bytes()).collect();
    let mut buf = Vec::new();
    {
        let mut encoder = Base64Encoder::new(&mut buf);
        encoder
            .write_all(&utf16)
            .expect("base64 write to Vec<u8> is infallible");
        encoder
            .finish()
            .expect("base64 finish to Vec<u8> is infallible");
    }
    // Safety: base64 output is always valid ASCII (subset of UTF-8)
    String::from_utf8(buf).expect("base64 output is always valid ASCII")
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
    fn new(writer: W) -> Self {
        Self {
            writer,
            buf: [0; 3],
            len: 0,
        }
    }

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
    fn flush(&mut self) -> std::io::Result<()> {
        self.writer.flush()
    }
}

// ─── Base64 prompt encoding ─────────────────────────────────────────

/// Base64-encode a prompt string (UTF-8 bytes) for safe embedding in shell/PS scripts.
///
/// The result contains only `[A-Za-z0-9+/=]` and therefore requires no escaping
/// in PS single-quoted strings, POSIX single-quoted strings, or AppleScript
/// double-quoted strings. Used by all platforms to safely pass `--interactive`
/// prompts containing arbitrary characters (quotes, newlines, backslashes, etc.).
pub(crate) fn encode_prompt_utf8_base64(s: &str) -> String {
    const CHARS: &[u8] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(4 * ((bytes.len() + 2) / 3));
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0];
        let b1 = if chunk.len() > 1 { chunk[1] } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] } else { 0 };
        out.push(CHARS[(b0 >> 2) as usize]);
        out.push(CHARS[((b0 & 0x03) << 4 | b1 >> 4) as usize]);
        out.push(if chunk.len() > 1 {
            CHARS[((b1 & 0x0f) << 2 | b2 >> 6) as usize]
        } else {
            b'='
        });
        out.push(if chunk.len() > 2 {
            CHARS[(b2 & 0x3f) as usize]
        } else {
            b'='
        });
    }
    // Safety: base64 output is always valid ASCII (subset of UTF-8)
    String::from_utf8(out).expect("base64 output is always valid ASCII")
}

// ─── Environment variable name validation ───────────────────────────

/// Validate that an environment variable name contains only safe characters.
/// Prevents shell injection via env var names in constructed commands.
pub(crate) fn validate_env_var_name(name: &str) -> Result<()> {
    crate::validation::validate_identifier(
        name,
        crate::validation::ENV_VAR_RULES,
        "Environment variable name",
    )
    .map_err(OrchestratorError::Launch)
}

// ─── Shell quoting ──────────────────────────────────────────────────

/// Shell-quote a string for safe interpolation into a shell command.
/// On Windows wraps in double-quotes; on Unix uses single-quote escaping.
#[allow(dead_code)] // Used in macOS/Linux cfg blocks
pub(crate) fn shell_quote(s: &str) -> String {
    #[cfg(windows)]
    {
        format!("\"{}\"", s.replace('"', "\"\""))
    }
    #[cfg(not(windows))]
    {
        format!("'{}'", s.replace('\'', "'\\''"))
    }
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

// ─── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_run_hidden_captures_stdout() {
        // git --version should always succeed on dev machines
        let output = run_hidden("git", &["--version"], None, None).unwrap();
        assert!(output.status.success());
        let stdout = String::from_utf8_lossy(&output.stdout);
        assert!(stdout.contains("git version"));
    }

    #[test]
    fn test_run_hidden_with_cwd() {
        // Run in a specific directory
        let temp = std::env::temp_dir();
        let output = run_hidden("git", &["--version"], Some(&temp), None).unwrap();
        assert!(output.status.success());
    }

    #[test]
    fn test_run_hidden_nonexistent_command() {
        let result = run_hidden("this_command_does_not_exist_xyz", &[], None, None);
        assert!(result.is_err());
    }

    #[test]
    fn test_run_hidden_stdout_success() {
        let version = run_hidden_stdout("git", &["--version"], None, None).unwrap();
        assert!(version.contains("git version"));
    }

    #[test]
    fn test_run_hidden_stdout_failure() {
        // git with an invalid subcommand should return non-zero
        let result = run_hidden_stdout("git", &["this-is-not-a-valid-subcommand"], None, None);
        assert!(result.is_err());
    }

    #[test]
    fn test_run_hidden_with_timeout_success() {
        // Fast command should complete within timeout
        let output = run_hidden("git", &["--version"], None, Some(5)).unwrap();
        assert!(output.status.success());
    }

    #[test]
    fn test_run_hidden_timeout_triggers() {
        // Use a command that will definitely timeout (sleep for 10s with 1s timeout)
        #[cfg(not(windows))]
        let result = run_hidden("sleep", &["10"], None, Some(1));

        #[cfg(windows)]
        #[allow(deprecated)] // test-only; exercises the deprecated API's timeout path
        let result = run_hidden_shell("Start-Sleep -Seconds 10", None, Some(1));

        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(err_msg.contains("timed out") || err_msg.contains("Command timed out"));
    }

    #[test]
    fn test_run_hidden_stdout_with_timeout() {
        // Fast command should work with timeout
        let version = run_hidden_stdout("git", &["--version"], None, Some(5)).unwrap();
        assert!(version.contains("git version"));
    }

    #[test]
    fn test_timeout_with_command_failure() {
        // Command that fails quickly (before timeout) - using run_hidden_stdout which checks status
        let result = run_hidden_stdout("git", &["not-a-valid-subcommand"], None, Some(10));
        assert!(result.is_err());

        // Should NOT be a timeout error
        let err_msg = result.unwrap_err().to_string();
        assert!(
            !err_msg.contains("timed out"),
            "Should not report timeout for quick failure"
        );
        assert!(err_msg.contains("failed"), "Should report command failure");
    }

    #[test]
    fn test_timeout_with_spawn_failure() {
        // Command that doesn't exist should fail during spawn, not timeout
        let result = run_hidden("command_that_does_not_exist_xyz123", &[], None, Some(5));
        assert!(result.is_err());

        let err_msg = result.unwrap_err().to_string();
        // Should be spawn error, not timeout
        assert!(err_msg.contains("Failed to spawn"));
        assert!(!err_msg.contains("timed out"));
    }

    #[test]
    fn test_very_short_timeout() {
        // 1 second timeout should be enough for git --version
        let result = run_hidden("git", &["--version"], None, Some(1));
        assert!(
            result.is_ok(),
            "Fast command should complete within 1s timeout"
        );
    }

    #[test]
    fn test_timeout_error_message_format() {
        #[cfg(not(windows))]
        let result = run_hidden("sleep", &["5"], None, Some(1));

        #[cfg(windows)]
        #[allow(deprecated)] // test-only; exercises the deprecated API's timeout path
        let result = run_hidden_shell("Start-Sleep -Seconds 5", None, Some(1));

        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();

        // Verify error message contains key information
        assert!(
            err_msg.contains("timed out"),
            "Error should mention timeout"
        );
        assert!(
            err_msg.contains("1s"),
            "Error should mention timeout duration"
        );
        assert!(
            err_msg.contains("Check system resources"),
            "Error should be actionable"
        );
    }

    #[cfg(windows)]
    #[test]
    fn test_run_hidden_via_cmd_resolves_aliases() {
        // `where` is a cmd-builtin — direct CreateProcess can't find it, but
        // cmd.exe /c can. This exercises the alias/PATHEXT fallback path.
        let out = run_hidden_via_cmd("where", &["cmd"], None, Some(5));
        assert!(
            out.is_ok(),
            "run_hidden_via_cmd should resolve cmd builtins"
        );
        let out = out.unwrap();
        assert!(out.status.success());
        let stdout = String::from_utf8_lossy(&out.stdout);
        assert!(
            stdout.to_lowercase().contains("cmd.exe"),
            "expected cmd path in stdout, got: {stdout}"
        );
    }

    #[cfg(not(windows))]
    #[test]
    fn test_run_hidden_via_cmd_errors_on_posix() {
        let result = run_hidden_via_cmd("true", &[], None, None);
        assert!(result.is_err());
    }

    #[test]
    fn test_find_executable_missing_returns_none() {
        // A name that almost certainly isn't on PATH on any platform.
        let result = find_executable("tracepilot-definitely-does-not-exist-xyz");
        assert!(result.is_none(), "expected None for missing executable");
    }

    #[cfg(windows)]
    #[test]
    fn test_find_executable_locates_cmd() {
        // `cmd.exe` is always on PATH on Windows.
        let result = find_executable("cmd");
        let path = result.expect("expected to locate cmd on PATH");
        let display = path.to_string_lossy().to_lowercase();
        assert!(
            display.ends_with("cmd.exe") || display.ends_with("cmd"),
            "expected cmd path, got {}",
            path.display()
        );
    }

    #[cfg(not(windows))]
    #[test]
    fn test_find_executable_locates_sh() {
        // `sh` is universally present on POSIX systems.
        let result = find_executable("sh");
        let path = result.expect("expected to locate sh on PATH");
        assert!(
            path.is_absolute() || path.exists(),
            "expected absolute or existing path for sh, got {}",
            path.display()
        );
    }

    #[cfg(windows)]
    #[test]
    fn test_encode_powershell_command() {
        let cmd = "Write-Host 'hi'";
        let encoded = encode_powershell_command(cmd);
        // Verify it's valid base64 and decodes back to correct UTF-16LE
        let bytes = (0..encoded.len())
            .step_by(4)
            .flat_map(|i| {
                let chunk = &encoded[i..std::cmp::min(i + 4, encoded.len())];
                let vals: Vec<u8> = chunk
                    .bytes()
                    .map(|b| match b {
                        b'A'..=b'Z' => b - b'A',
                        b'a'..=b'z' => b - b'a' + 26,
                        b'0'..=b'9' => b - b'0' + 52,
                        b'+' => 62,
                        b'/' => 63,
                        b'=' => 0,
                        _ => panic!("invalid base64"),
                    })
                    .collect();
                let mut out = Vec::new();
                if vals.len() >= 2 {
                    out.push((vals[0] << 2) | (vals[1] >> 4));
                }
                if vals.len() >= 3 && chunk.as_bytes().get(2) != Some(&b'=') {
                    out.push(((vals[1] & 0x0f) << 4) | (vals[2] >> 2));
                }
                if vals.len() >= 4 && chunk.as_bytes().get(3) != Some(&b'=') {
                    out.push(((vals[2] & 0x03) << 6) | vals[3]);
                }
                out
            })
            .collect::<Vec<u8>>();
        // Decode UTF-16LE back to string
        let decoded: String = bytes
            .chunks(2)
            .filter_map(|pair| {
                if pair.len() == 2 {
                    Some(u16::from_le_bytes([pair[0], pair[1]]))
                } else {
                    None
                }
            })
            .map(|c| char::from_u32(c as u32).unwrap_or('?'))
            .collect();
        assert_eq!(decoded, cmd);
    }

    #[test]
    fn test_shell_quote_plain() {
        let quoted = shell_quote("hello");
        #[cfg(windows)]
        assert_eq!(quoted, "\"hello\"");
        #[cfg(not(windows))]
        assert_eq!(quoted, "'hello'");
    }

    #[test]
    fn test_shell_quote_with_spaces() {
        let quoted = shell_quote("hello world");
        #[cfg(windows)]
        assert_eq!(quoted, "\"hello world\"");
        #[cfg(not(windows))]
        assert_eq!(quoted, "'hello world'");
    }

    #[test]
    fn test_validate_env_var_name_valid() {
        assert!(validate_env_var_name("PATH").is_ok());
        assert!(validate_env_var_name("MY_VAR").is_ok());
        assert!(validate_env_var_name("_private").is_ok());
        assert!(validate_env_var_name("VAR123").is_ok());
    }

    #[test]
    fn test_validate_env_var_name_invalid() {
        assert!(validate_env_var_name("").is_err());
        assert!(validate_env_var_name("FOO;rm -rf").is_err());
        assert!(validate_env_var_name("1BAD").is_err());
        assert!(validate_env_var_name("HAS SPACE").is_err());
        assert!(validate_env_var_name("A=B").is_err());
    }

    #[test]
    fn test_execute_with_timeout_missing_stdout_pipe() {
        // Spawn a process without piping stdout to verify error handling
        let child = Command::new("git")
            .arg("--version")
            .stderr(std::process::Stdio::piped())
            // stdout is NOT piped - should trigger our error
            .spawn()
            .expect("failed to spawn test process");

        let result = execute_with_timeout(child, 5);
        assert!(result.is_err());
        let err = result.unwrap_err();
        let err_msg = err.to_string();
        assert!(
            err_msg.contains("stdout not piped") || err_msg.contains("not configured correctly"),
            "Expected stdout pipe error, got: {}",
            err_msg
        );
    }

    #[test]
    fn test_execute_with_timeout_missing_stderr_pipe() {
        // Spawn a process without piping stderr to verify error handling
        let child = Command::new("git")
            .arg("--version")
            .stdout(std::process::Stdio::piped())
            // stderr is NOT piped - should trigger our error
            .spawn()
            .expect("failed to spawn test process");

        let result = execute_with_timeout(child, 5);
        assert!(result.is_err());
        let err = result.unwrap_err();
        let err_msg = err.to_string();
        assert!(
            err_msg.contains("stderr not piped") || err_msg.contains("not configured correctly"),
            "Expected stderr pipe error, got: {}",
            err_msg
        );
    }

    #[test]
    fn test_execute_with_timeout_missing_both_pipes() {
        // Spawn a process without piping either stdout or stderr
        let child = Command::new("git")
            .arg("--version")
            // Neither stdout nor stderr are piped
            .spawn()
            .expect("failed to spawn test process");

        let result = execute_with_timeout(child, 5);
        assert!(result.is_err());
        // Should error on the first pipe (stdout) that's checked
        let err = result.unwrap_err();
        let err_msg = err.to_string();
        assert!(
            err_msg.contains("stdout not piped") || err_msg.contains("not configured correctly"),
            "Expected stdout pipe error, got: {}",
            err_msg
        );
    }
}
