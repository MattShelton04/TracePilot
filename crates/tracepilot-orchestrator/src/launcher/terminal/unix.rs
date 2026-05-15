//! macOS / Linux terminal spawn.
//!
//! The actual terminal emulator selection (Terminal.app via AppleScript,
//! gnome-terminal, konsole, …) lives in
//! [`crate::process::spawn_detached_terminal`]; this module is responsible
//! for assembling the shell command line that the emulator will run.

use crate::error::Result;

use super::SessionPlan;

/// Spawn the Copilot session in a detached terminal window.
pub(super) fn spawn(plan: &SessionPlan<'_>) -> Result<u32> {
    let SessionPlan {
        config,
        work_dir,
        copilot_cmd,
    } = plan;

    let checkout_prefix = if !config.create_worktree {
        config
            .branch
            .as_deref()
            .map(|b| {
                let escaped = b.replace('\'', "''");
                format!("git checkout '{escaped}' && ")
            })
            .unwrap_or_default()
    } else {
        String::new()
    };

    // Base64 chars are safe in POSIX single-quoted strings and AppleScript
    // double-quoted strings; the shell decodes the prompt at runtime.
    let interactive_suffix = config
        .prompt
        .as_deref()
        .map(|p| {
            format!(
                " --interactive \"$(echo '{}' | base64 -d)\"",
                crate::process::encode_prompt_utf8_base64(p)
            )
        })
        .unwrap_or_default();
    let full_cmd = format!("{checkout_prefix}{copilot_cmd}{interactive_suffix}");
    let envs = &config.env_vars;
    let envs_ref = if envs.is_empty() { None } else { Some(envs) };
    crate::process::spawn_detached_terminal(&full_cmd, &[], work_dir, envs_ref)
}
