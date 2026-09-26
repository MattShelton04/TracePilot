//! `resume_session_in_terminal` — spawn a detached terminal running the CLI's
//! resume command for the given session.

use tracepilot_core::parsing::WORKSPACE_YAML;

use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::read_config;

/// Open a new terminal window and run the configured CLI resume command.
#[tauri::command]
#[tracing::instrument(skip(state, cli_command), err, fields(%session_id))]
pub async fn resume_session_in_terminal(
    state: tauri::State<'_, SharedConfig>,
    session_id: String,
    cli_command: Option<String>,
) -> CmdResult<()> {
    // Validate UUID format (also prevents command injection via session_id)
    crate::validators::validate_session_id(&session_id)?;

    let cli =
        cli_command.unwrap_or_else(|| tracepilot_core::constants::DEFAULT_CLI_COMMAND.to_string());

    // Defence-in-depth: the CLI string is interpolated into a shell command
    // below, so any character outside the safe allowlist is rejected at the
    // boundary. See `validators::validate_cli_command` for the rule set.
    crate::validators::validate_cli_command(&cli)?;

    // Resolve the session's original working directory from workspace.yaml
    let config = read_config(&state);
    let session_state_dir = config.session_state_dir();
    // Live sessions (ADR-0016): start the resumed terminal with `--ui-server`
    // so TracePilot can attach to it and stream it live.
    let attachable = config.features.copilot_sdk && config.live.launch_attachable;
    let sid = session_id.clone();
    let session_cwd = tokio::task::spawn_blocking(move || {
        let session_path = tracepilot_core::session::discovery::resolve_session_path_direct(
            &sid,
            &session_state_dir,
        )?;
        let workspace_path = session_path.join(WORKSPACE_YAML);
        let metadata = tracepilot_core::parsing::workspace::parse_workspace_yaml(&workspace_path)?;
        Ok::<Option<std::path::PathBuf>, BindingsError>(metadata.cwd.map(std::path::PathBuf::from))
    })
    .await??;

    // Find a valid directory for the terminal: session CWD > its closest ancestor > home
    let effective_cwd = session_cwd
        .as_ref()
        .and_then(|p| {
            if p.is_dir() {
                return Some(p.clone());
            }
            let mut ancestor = p.parent();
            while let Some(dir) = ancestor {
                if dir.is_dir() {
                    return Some(dir.to_path_buf());
                }
                ancestor = dir.parent();
            }
            None
        })
        .or_else(|| tracepilot_core::utils::home_dir_opt().filter(|p| p.is_dir()))
        .unwrap_or_else(|| std::path::PathBuf::from("."));

    let cmd = resume_command(&cli, &session_id, attachable);

    #[cfg(windows)]
    {
        let escaped_cwd = effective_cwd.display().to_string().replace('\'', "''");
        let ps_cmd = format!(
            "$host.UI.RawUI.WindowTitle = 'Copilot Session (Resume)'; Set-Location -LiteralPath '{}'; Write-Host 'Resuming Copilot session...' -ForegroundColor Cyan; Write-Host '  Session: {}' -ForegroundColor White; Write-Host ''; {}",
            escaped_cwd,
            session_id,
            cmd.replace('\'', "''")
        );

        let encoded = tracepilot_orchestrator::process::encode_powershell_command(&ps_cmd);
        tracepilot_orchestrator::process::spawn_detached_terminal(
            "powershell",
            &["-NoExit", "-EncodedCommand", &encoded],
            &effective_cwd,
            None,
        )?;
    }

    #[cfg(not(windows))]
    {
        tracepilot_orchestrator::process::spawn_detached_terminal(&cmd, &[], &effective_cwd, None)?;
    }

    Ok(())
}

/// The CLI command that resumes `session_id`, optionally as an attachable
/// `--ui-server` terminal.
fn resume_command(cli: &str, session_id: &str, attachable: bool) -> String {
    if attachable {
        format!("{cli} --resume {session_id} --ui-server")
    } else {
        format!("{cli} --resume {session_id}")
    }
}

#[cfg(test)]
mod tests {
    use super::resume_command;

    #[test]
    fn resume_command_adds_ui_server_only_when_attachable() {
        assert_eq!(
            resume_command("copilot", "abc", false),
            "copilot --resume abc"
        );
        assert_eq!(
            resume_command("copilot", "abc", true),
            "copilot --resume abc --ui-server"
        );
    }
}
