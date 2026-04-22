//! `--ui-server` (external-TCP) mode helpers: foreground-session accessors on
//! [`BridgeManager`] plus the free `launch_ui_server` function that spawns a
//! visible terminal running `copilot --ui-server` for the user to attach to.
//!
//! The Windows spawner uses `CREATE_NO_WINDOW` (via `crate::process::hidden_command`
//! / `spawn_detached_terminal`) to prevent a CMD flash — see repo memory on
//! Windows detached-terminal conventions.

use super::BridgeManager;
use crate::bridge::BridgeError;

impl BridgeManager {
    /// Get the foreground session ID from a `copilot --ui-server` instance.
    #[cfg(feature = "copilot-sdk")]
    pub async fn get_foreground_session(&self) -> Result<Option<String>, BridgeError> {
        let client = self.require_client()?;
        let resp = client
            .get_foreground_session_id()
            .await
            .map_err(|e| BridgeError::Sdk(e.to_string()))?;
        Ok(resp.session_id)
    }

    #[cfg(not(feature = "copilot-sdk"))]
    pub async fn get_foreground_session(&self) -> Result<Option<String>, BridgeError> {
        Err(BridgeError::NotAvailable)
    }

    /// Set the foreground session ID (switches which session the TUI displays).
    #[cfg(feature = "copilot-sdk")]
    pub async fn set_foreground_session(&self, session_id: &str) -> Result<(), BridgeError> {
        let client = self.require_client()?;
        client
            .set_foreground_session_id(session_id)
            .await
            .map_err(|e| BridgeError::Sdk(e.to_string()))?;
        Ok(())
    }

    #[cfg(not(feature = "copilot-sdk"))]
    pub async fn set_foreground_session(&self, _session_id: &str) -> Result<(), BridgeError> {
        Err(BridgeError::NotAvailable)
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
