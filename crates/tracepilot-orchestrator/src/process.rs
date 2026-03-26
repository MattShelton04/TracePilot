//! Centralized process execution for TracePilot.
//!
//! All child-process spawning should go through this module to ensure:
//! - Internal/hidden commands don't flash terminal windows on Windows
//! - User-facing terminal launches are properly detached from the app's job object
//! - Platform-specific terminal detection logic is defined in one place

use crate::error::{OrchestratorError, Result};
use std::collections::HashMap;
use std::path::Path;
use std::process::{Command, Output};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

// ─── Windows creation flags ─────────────────────────────────────────
#[cfg(windows)]
const CREATE_NEW_CONSOLE: u32 = 0x00000010;
#[cfg(windows)]
const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x01000000;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

// ─── Linux terminal emulator fallback list ──────────────────────────
#[cfg(target_os = "linux")]
const LINUX_TERMINALS: &[&str] = &[
    "x-terminal-emulator",
    "gnome-terminal",
    "konsole",
    "xfce4-terminal",
    "xterm",
];

// ─── Hidden execution (internal commands) ───────────────────────────

/// Run a command invisibly, capturing stdout and stderr.
///
/// On Windows, sets `CREATE_NO_WINDOW` to prevent console/conhost windows
/// from flashing when a GUI-subsystem app spawns console-mode children
/// (e.g. `git.exe`).
///
/// Pass `cwd: Some(&path)` to set the working directory, or `None` to
/// inherit the parent's CWD.
pub fn run_hidden(program: &str, args: &[&str], cwd: Option<&Path>) -> Result<Output> {
    let mut cmd = Command::new(program);
    cmd.args(args);
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    cmd.output().map_err(Into::into)
}

/// Run a command string through a shell invisibly, capturing stdout and stderr.
///
/// On Windows, uses `powershell -Command` to ensure aliases and batch files are found.
/// On Unix, uses `sh -c`.
pub fn run_hidden_shell(full_command: &str, cwd: Option<&Path>) -> Result<Output> {
    #[cfg(windows)]
    {
        let mut cmd = Command::new("powershell");
        cmd.args(["-NoProfile", "-NonInteractive", "-Command", full_command]);
        if let Some(dir) = cwd {
            cmd.current_dir(dir);
        }
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd.output().map_err(Into::into)
    }

    #[cfg(not(windows))]
    {
        let mut cmd = Command::new("sh");
        cmd.args(["-c", full_command]);
        if let Some(dir) = cwd {
            cmd.current_dir(dir);
        }
        cmd.output().map_err(Into::into)
    }
}

/// Convenience wrapper: run a hidden command and return trimmed stdout on success.
///
/// Returns `OrchestratorError::Launch` if the command exits with non-zero status,
/// including stderr in the error message.
pub fn run_hidden_stdout(program: &str, args: &[&str], cwd: Option<&Path>) -> Result<String> {
    let output = run_hidden(program, args, cwd)?;

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
fn spawn_outside_job_win(
    program: &str,
    args: &[&str],
    work_dir: &Path,
) -> Result<u32> {
    // Default to powershell if no program specified (e.g., "open terminal here")
    let program = if program.is_empty() { "powershell" } else { program };

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
        .map_err(|e| OrchestratorError::Launch(format!("Failed to open terminal: {e}")))?;
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
        const CHARS: &[u8] =
            b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
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

// ─── Environment variable name validation ───────────────────────────

/// Validate that an environment variable name contains only safe characters.
/// Prevents shell injection via env var names in constructed commands.
pub(crate) fn validate_env_var_name(name: &str) -> Result<()> {
    if name.is_empty() {
        return Err(OrchestratorError::Launch(
            "Environment variable name cannot be empty".into(),
        ));
    }
    // Must start with letter or underscore, then alphanumeric/underscore
    let valid = name
        .bytes()
        .enumerate()
        .all(|(i, b)| b == b'_' || b.is_ascii_alphabetic() || (i > 0 && b.is_ascii_digit()));
    if !valid {
        return Err(OrchestratorError::Launch(format!(
            "Invalid environment variable name: {name}"
        )));
    }
    Ok(())
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
        let output = run_hidden("git", &["--version"], None).unwrap();
        assert!(output.status.success());
        let stdout = String::from_utf8_lossy(&output.stdout);
        assert!(stdout.contains("git version"));
    }

    #[test]
    fn test_run_hidden_with_cwd() {
        // Run in a specific directory
        let temp = std::env::temp_dir();
        let output = run_hidden("git", &["--version"], Some(&temp)).unwrap();
        assert!(output.status.success());
    }

    #[test]
    fn test_run_hidden_nonexistent_command() {
        let result = run_hidden("this_command_does_not_exist_xyz", &[], None);
        assert!(result.is_err());
    }

    #[test]
    fn test_run_hidden_stdout_success() {
        let version = run_hidden_stdout("git", &["--version"], None).unwrap();
        assert!(version.contains("git version"));
    }

    #[test]
    fn test_run_hidden_stdout_failure() {
        // git with an invalid subcommand should return non-zero
        let result = run_hidden_stdout("git", &["this-is-not-a-valid-subcommand"], None);
        assert!(result.is_err());
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
}
