//! `resume_session_in_terminal` — spawn a detached terminal running the CLI's
//! resume command for the given session.
//!
//! The provider says how its source resumes ([`ResumeLaunch`]); this command
//! picks the source's CLI, validates everything that reaches the shell, and
//! opens the terminal.

use std::path::{Path, PathBuf};

use tracepilot_core::provider::{ResumeLaunch, SessionSource};

use crate::config::{SharedConfig, TracePilotConfig};
use crate::error::{BindingsError, CmdResult};
use crate::helpers::{read_config, require_capability, resolve_session};

const ACTION: &str = "Resume in terminal";

/// Open a new terminal window and run the session source's resume command.
///
/// `cli_command` is the Copilot CLI preference. Other sources use their own
/// configured command and ignore it.
#[tauri::command]
#[tracing::instrument(skip(state, cli_command), err, fields(%session_id))]
pub async fn resume_session_in_terminal(
    state: tauri::State<'_, SharedConfig>,
    session_id: String,
    cli_command: Option<String>,
) -> CmdResult<()> {
    // Validate UUID format (also prevents command injection via session_id)
    let sid = crate::validators::validate_session_id(&session_id)?;

    let config = read_config(&state);
    // Live sessions (ADR-0016): start the resumed terminal with `--ui-server`
    // so TracePilot can attach to it and stream it live.
    let live_attach = config.features.copilot_sdk && config.live.launch_attachable;
    let (cli, launch, effective_cwd) = tokio::task::spawn_blocking(move || {
        let session = resolve_session(&config, &sid)?;
        require_capability(&session, |caps| caps.can_resume_in_terminal, ACTION)?;
        let unsupported = || BindingsError::Unsupported {
            session_source: session.locator.source,
            action: ACTION,
        };
        let launch = session
            .provider
            .resume_launch(&session.locator, live_attach)?
            .ok_or_else(unsupported)?;
        let cli = resume_cli(session.locator.source, cli_command, &config);
        // Filesystem checks, so they stay off the async runtime.
        let home = tracepilot_core::utils::home_dir_opt();
        let cwd = effective_cwd(launch.cwd.as_deref(), home);
        Ok::<_, BindingsError>((cli, launch, cwd))
    })
    .await??;

    // Defence-in-depth: the CLI string is interpolated into a shell command
    // below, so any character outside the safe allowlist is rejected at the
    // boundary. See `validators::validate_cli_command` for the rule set.
    crate::validators::validate_cli_command(&cli)?;

    let argv = resume_argv(&cli, &launch);

    #[cfg(windows)]
    {
        let ps_cmd = powershell_script(launch.label, &effective_cwd, &session_id, &argv);
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

/// The CLI that resumes a session of `source`: Copilot's preference (sent by
/// the frontend, as before), or the source's own configured command.
fn resume_cli(
    source: SessionSource,
    requested: Option<String>,
    config: &TracePilotConfig,
) -> String {
    match source {
        SessionSource::Copilot => {
            requested.unwrap_or_else(|| tracepilot_core::constants::DEFAULT_CLI_COMMAND.to_string())
        }
        SessionSource::ClaudeCode => config.sources.claude_code.resume_cli().to_owned(),
    }
}

/// The CLI followed by the provider's arguments. A multi-word CLI command
/// (`gh copilot`) splits on whitespace; the validator has already rejected
/// quotes and shell syntax.
fn resume_argv(cli: &str, launch: &ResumeLaunch) -> Vec<String> {
    let mut argv: Vec<String> = cli.split_whitespace().map(str::to_owned).collect();
    argv.extend(launch.args.iter().cloned());
    argv
}

/// Where the terminal starts: the session's recorded directory, else its
/// nearest existing ancestor, else home.
///
/// The recorded directory comes from the session's own files (ADR 0012), so
/// it is untrusted: only an absolute local path with no control characters
/// is considered (see [`is_plain_local_absolute`]), and nothing touches the
/// filesystem before that check, so a network path never opens a connection.
/// Blocking.
fn effective_cwd(recorded: Option<&Path>, home: Option<PathBuf>) -> PathBuf {
    recorded
        .filter(|path| is_plain_local_absolute(path))
        .and_then(|path| path.ancestors().find(|dir| dir.is_dir()))
        .map(Path::to_path_buf)
        .or_else(|| home.filter(|p| p.is_dir()))
        .unwrap_or_else(|| PathBuf::from("."))
}

fn is_plain_local_absolute(path: &Path) -> bool {
    let Some(text) = path.to_str() else {
        return false;
    };
    path.is_absolute() && has_local_root(path) && !text.chars().any(char::is_control)
}

/// On Windows, an allowlist on the parsed prefix: a drive (`C:\`, `\\?\C:\`)
/// or WSL's local share (`\\wsl.localhost\<distro>`, `\\wsl$\<distro>`).
/// Every other UNC, verbatim-UNC or device prefix is refused, whatever mix of
/// `\` and `/` spells it.
#[cfg(windows)]
fn has_local_root(path: &Path) -> bool {
    use std::path::{Component, Prefix};
    let Some(Component::Prefix(prefix)) = path.components().next() else {
        return false;
    };
    match prefix.kind() {
        Prefix::Disk(_) | Prefix::VerbatimDisk(_) => true,
        Prefix::UNC(server, _) => {
            server.eq_ignore_ascii_case("wsl.localhost") || server.eq_ignore_ascii_case("wsl$")
        }
        _ => false,
    }
}

#[cfg(not(windows))]
fn has_local_root(_path: &Path) -> bool {
    true
}

/// The script the Windows terminal runs. The label and directory sit in
/// single-quoted PowerShell literals, escaped by [`ps_quote`]; the session id
/// is a validated UUID and the command a validated CLI plus fixed arguments.
#[cfg_attr(not(windows), allow(dead_code))]
fn powershell_script(label: &str, cwd: &Path, session_id: &str, argv: &[String]) -> String {
    let label = ps_quote(label);
    format!(
        "$host.UI.RawUI.WindowTitle = '{label} Session (Resume)'; Set-Location -LiteralPath '{}'; Write-Host 'Resuming {label} session...' -ForegroundColor Cyan; Write-Host '  Session: {}' -ForegroundColor White; Write-Host ''; {}",
        ps_quote(&cwd.display().to_string()),
        session_id,
        ps_quote(&argv.join(" "))
    )
}

/// Escape text for a single-quoted PowerShell string. PowerShell also ends
/// such a string at the typographic single quotes, so each of them is
/// doubled as well.
#[cfg_attr(not(windows), allow(dead_code))]
fn ps_quote(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());
    for c in text.chars() {
        if matches!(c, '\'' | '\u{2018}' | '\u{2019}' | '\u{201A}' | '\u{201B}') {
            escaped.push(c);
        }
        escaped.push(c);
    }
    escaped
}

#[cfg(test)]
#[path = "resume_tests.rs"]
mod tests;
