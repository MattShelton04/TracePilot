//! Centralized process execution for TracePilot.
//!
//! All child-process spawning should go through this module to ensure:
//! - Internal/hidden commands don't flash terminal windows on Windows
//! - User-facing terminal launches are properly detached from the app's job object
//! - Platform-specific terminal detection logic is defined in one place
//!
//! Submodules:
//! - [`hidden`]   — hidden-window spawning (`CREATE_NO_WINDOW`), `run_hidden*`,
//!   `find_executable`, `is_alive`, base64 / win32 encoding helpers.
//! - [`terminal`] — user-facing detached terminal spawning.
//! - [`timeout`]  — wall-clock timeout policy for captured child processes.

use crate::error::{OrchestratorError, Result};

mod encoding;
mod hidden;
mod terminal;
mod timeout;

#[cfg(test)]
mod tests;

#[cfg(test)]
mod tests_async_limits;

// ─── Public API re-exports (byte-for-byte stable) ──────────────────

pub use hidden::{
    find_executable, hidden_command, hidden_std_command, is_alive, run_hidden, run_hidden_stdout,
    run_hidden_stdout_timeout, run_hidden_via_cmd,
};

pub(crate) use timeout::run_async_with_limits;

#[allow(deprecated)]
pub use hidden::run_hidden_shell;

#[cfg(windows)]
pub use encoding::encode_powershell_command;

#[cfg(windows)]
pub use terminal::spawn_outside_job;

pub use terminal::spawn_detached_terminal;

#[cfg(windows)]
pub(crate) use encoding::win32_quote_arg;

#[cfg(any(target_os = "macos", target_os = "linux"))]
pub(crate) use encoding::encode_prompt_utf8_base64;

// ─── Shared helpers (visible to submodules) ────────────────────────

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
