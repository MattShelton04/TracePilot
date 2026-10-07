//! `resume_session_in_terminal` — spawn a detached terminal running the CLI's
//! resume command for the given session.

use tracepilot_core::parsing::WORKSPACE_YAML;

use crate::config::SharedConfig;
use crate::error::{BindingsError, CmdResult};
use crate::helpers::{read_config, require_capability, resolve_session};

/// Open a new terminal window and run the configured CLI resume command.
#[tauri::command]
#[tracing::instrument(skip(state, cli_command), err, fields(%session_id))]
pub async fn resume_session_in_terminal(
    state: tauri::State<'_, SharedConfig>,
    session_id: String,
    cli_command: Option<String>,
) -> CmdResult<()> {
    // Validate UUID format (also prevents command injection via session_id)
    let sid = crate::validators::validate_session_id(&session_id)?;

    let cli =
        cli_command.unwrap_or_else(|| tracepilot_core::constants::DEFAULT_CLI_COMMAND.to_string());

    // Defence-in-depth: the CLI string is interpolated into a shell command
    // below, so any character outside the safe allowlist is rejected at the
    // boundary. See `validators::validate_cli_command` for the rule set.
    crate::validators::validate_cli_command(&cli)?;

    // Resolve the session's original working directory from workspace.yaml
    let config = read_config(&state);
    // Live sessions (ADR-0016): start the resumed terminal with `--ui-server`
    // so TracePilot can attach to it and stream it live.
    let attachable = config.features.copilot_sdk && config.live.launch_attachable;
    let session_cwd = tokio::task::spawn_blocking(move || {
        let session = resolve_session(&config, &sid)?;
        require_capability(&session, |caps| caps.can_resume, "Resume")?;
        let workspace_path = session.locator.primary_path.join(WORKSPACE_YAML);
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

    let argv = resume_argv(&cli, &session_id, attachable);

    #[cfg(windows)]
    {
        let cmd = argv.join(" ");
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

    // The terminal shell-quotes the program and each argument separately, so
    // they must not be joined into one string ('copilot --resume …' is not a
    // command).
    #[cfg(not(windows))]
    {
        let (program, args) = argv
            .split_first()
            .ok_or_else(|| BindingsError::Validation("CLI command must not be empty".into()))?;
        let args: Vec<&str> = args.iter().map(String::as_str).collect();
        tracepilot_orchestrator::process::spawn_detached_terminal(
            program,
            &args,
            &effective_cwd,
            None,
        )?;
    }

    Ok(())
}

/// The argv that resumes `session_id`, optionally as an attachable
/// `--ui-server` terminal. A multi-word CLI command (`gh copilot`) splits on
/// whitespace; the validator has already rejected quotes and shell syntax.
fn resume_argv(cli: &str, session_id: &str, attachable: bool) -> Vec<String> {
    let mut argv: Vec<String> = cli.split_whitespace().map(str::to_owned).collect();
    argv.extend(["--resume".to_owned(), session_id.to_owned()]);
    if attachable {
        argv.push("--ui-server".to_owned());
    }
    argv
}

#[cfg(test)]
mod tests {
    use super::resume_argv;

    #[test]
    fn resume_argv_adds_ui_server_only_when_attachable() {
        assert_eq!(
            resume_argv("copilot", "abc", false),
            ["copilot", "--resume", "abc"]
        );
        assert_eq!(
            resume_argv("copilot", "abc", true),
            ["copilot", "--resume", "abc", "--ui-server"]
        );
    }

    #[test]
    fn resume_argv_keeps_program_and_arguments_separate() {
        assert_eq!(
            resume_argv("gh  copilot", "abc", false),
            ["gh", "copilot", "--resume", "abc"]
        );
    }
}
