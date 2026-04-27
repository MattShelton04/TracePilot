//! `--ui-server` (external-TCP) mode helpers: foreground-session accessors on
//! [`BridgeManager`] plus the free `launch_ui_server` function that spawns a
//! visible terminal running `copilot --ui-server` for the user to attach to.
//!
//! The Windows spawner uses `CREATE_NO_WINDOW` (via `crate::process::hidden_command`
//! / `spawn_detached_terminal`) to prevent a CMD flash — see repo memory on
//! Windows detached-terminal conventions.

use super::BridgeManager;
use crate::bridge::{BridgeError, detect_ui_servers};
use std::time::Duration;

const STOP_TIMEOUT: Duration = Duration::from_secs(5);
const STOP_MAX_BYTES: u64 = 64 * 1024;

impl BridgeManager {
    /// Get the foreground session ID from a `copilot --ui-server` instance.
    pub async fn get_foreground_session(&self) -> Result<Option<String>, BridgeError> {
        let client = self.require_client()?;
        let resp = client
            .get_foreground_session_id()
            .await
            .map_err(|e| BridgeError::Sdk(e.to_string()))?;
        Ok(resp.session_id)
    }

    /// Set the foreground session ID (switches which session the TUI displays).
    pub async fn set_foreground_session(&self, session_id: &str) -> Result<(), BridgeError> {
        let client = self.require_client()?;
        client
            .set_foreground_session_id(session_id)
            .await
            .map_err(|e| BridgeError::Sdk(e.to_string()))?;
        Ok(())
    }
}

/// Launch a `copilot --ui-server` process in a new terminal window.
///
/// This is independent of the SDK client — it simply spawns the CLI
/// binary with `--ui-server` so the user gets a visible terminal with
/// the Copilot TUI that TracePilot can then connect to via TCP.
pub fn launch_ui_server(working_dir: Option<&str>) -> Result<u32, BridgeError> {
    // Resolve copilot binary path via PATH
    let copilot_path =
        crate::process::find_executable(tracepilot_core::constants::DEFAULT_CLI_COMMAND)
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|| tracepilot_core::constants::DEFAULT_CLI_COMMAND.to_string());

    let work_dir = working_dir
        .map(std::path::PathBuf::from)
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_else(|| std::path::PathBuf::from("."));

    #[cfg(windows)]
    {
        let ps_cmd = format!(
            "$host.UI.RawUI.WindowTitle = 'TracePilot \u{2022} Copilot CLI Server'; \
             Write-Host 'Starting Copilot CLI UI Server...' -ForegroundColor Cyan; \
             Write-Host '  Working directory: {}' -ForegroundColor White; \
             Write-Host '  Connect from TracePilot Settings > Detect & Connect' -ForegroundColor DarkGray; \
             Write-Host ''; \
             & '{}' --ui-server",
            work_dir.display().to_string().replace('\'', "''"),
            copilot_path.replace('\'', "''"),
        );
        let encoded = crate::process::encode_powershell_command(&ps_cmd);
        crate::process::spawn_detached_terminal(
            "powershell",
            &["-NoExit", "-EncodedCommand", &encoded],
            &work_dir,
            None,
        )
        .map_err(|e| BridgeError::Sdk(format!("Failed to launch UI server: {e}")))
    }

    #[cfg(target_os = "macos")]
    {
        let cmd = format!("{} --ui-server", copilot_path);
        crate::process::spawn_detached_terminal(&cmd, &[], &work_dir, None)
            .map_err(|e| BridgeError::Sdk(format!("Failed to launch UI server: {e}")))
    }

    #[cfg(target_os = "linux")]
    {
        let cmd = format!("{} --ui-server", copilot_path);
        crate::process::spawn_detached_terminal(&cmd, &[], &work_dir, None)
            .map_err(|e| BridgeError::Sdk(format!("Failed to launch UI server: {e}")))
    }
}

/// Stop a detected `copilot --ui-server` process by PID.
///
/// The PID must be present in the current detection result so TracePilot cannot
/// be used as a generic process killer.
pub async fn stop_ui_server(pid: u32) -> Result<(), BridgeError> {
    let detected = detect_ui_servers().await;
    if !detected.iter().any(|server| server.pid == pid) {
        return Err(BridgeError::Sdk(format!(
            "Refusing to stop PID {pid}: it is not a detected copilot --ui-server process"
        )));
    }

    #[cfg(windows)]
    let cmd = {
        let mut cmd = crate::process::hidden_command("powershell");
        let script = format!(
            "$p = Get-CimInstance Win32_Process -Filter \"ProcessId = {pid}\"; \
             if (-not $p -or $p.Name -notmatch 'copilot' -or $p.CommandLine -notmatch '(ui-server|--server)') {{ \
               throw 'PID {pid} is no longer a copilot --ui-server process' \
             }}; \
             Stop-Process -Id {pid} -ErrorAction Stop"
        );
        cmd.args(["-NoProfile", "-NonInteractive", "-Command", &script]);
        cmd
    };

    #[cfg(not(windows))]
    let cmd = {
        let mut cmd = crate::process::hidden_command("kill");
        cmd.args(["-TERM", &pid.to_string()]);
        cmd
    };

    let (_stdout, stderr, status) =
        crate::process::run_async_with_limits(cmd, STOP_TIMEOUT, STOP_MAX_BYTES)
            .await
            .map_err(|e| BridgeError::Sdk(format!("Failed to stop UI server PID {pid}: {e}")))?;

    if status.success() {
        Ok(())
    } else {
        Err(BridgeError::Sdk(format!(
            "Failed to stop UI server PID {pid}: {}",
            String::from_utf8_lossy(&stderr).trim()
        )))
    }
}
