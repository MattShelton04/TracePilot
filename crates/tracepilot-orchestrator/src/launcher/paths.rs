//! Path canonicalisation + explorer/terminal open helpers.

use crate::error::{OrchestratorError, Result};
use std::process::Command;

/// Canonicalize a user-supplied path and reject attack shapes.
///
/// Performs symlink-following canonicalization, then:
///   - Errors if the path does not exist.
///   - Errors if the input contains a NUL byte (defence in depth).
///   - On Windows, rejects raw UNC network paths (`\\server\share`) and
///     strips the verbatim `\\?\` prefix that `std::fs::canonicalize`
///     always prepends, so the returned path is safe to pass to tools
///     that don't grok verbatim form (explorer.exe, older PowerShell,
///     git-for-windows worktree).
///
/// Returns the canonical absolute path suitable for passing to a child
/// process launched via `Command::arg` or embedded into a shell script
/// with appropriate quoting.
///
/// NOTE: This helper does *not* enforce containment within a configured
/// jail root. For the launch / explorer / terminal sites the policy is
/// "path must exist on the local filesystem and must not be a network
/// share"; callers that need stricter jailing must add their own root
/// check against the returned canonical path.
pub(crate) fn canonicalize_user_path(path: &str) -> Result<std::path::PathBuf> {
    if path.as_bytes().contains(&0) {
        return Err(OrchestratorError::Launch("Path contains a NUL byte".into()));
    }

    let canonical = tracepilot_core::utils::fs::canonicalize(path).map_err(|e| {
        OrchestratorError::launch_ctx(
            format!("Path does not exist or is not accessible: {path}"),
            e,
        )
    })?;

    #[cfg(windows)]
    {
        let s = canonical.to_string_lossy();
        // `canonicalize` on Windows always returns a verbatim path
        // (`\\?\C:\...` or `\\?\UNC\server\share`). Reject the UNC form
        // explicitly; refusing network paths is a deliberate policy choice
        // (Phase 1A.2 — see docs/tech-debt-plan-revised-2026-04.md).
        if s.starts_with(r"\\?\UNC\") {
            return Err(OrchestratorError::Launch(format!(
                "Network (UNC) paths are not permitted: {path}"
            )));
        }
    }

    Ok(canonical)
}

/// Open a path in the system file explorer.
pub fn open_in_explorer(path: &str) -> Result<()> {
    let canonical = canonicalize_user_path(path)?;

    #[cfg(windows)]
    Command::new("explorer")
        .arg(&canonical)
        .spawn()
        .map_err(|e| OrchestratorError::launch_ctx("Failed to open explorer", e))?;

    #[cfg(target_os = "macos")]
    Command::new("open")
        .arg(&canonical)
        .spawn()
        .map_err(|e| OrchestratorError::launch_ctx("Failed to open Finder", e))?;

    #[cfg(target_os = "linux")]
    Command::new("xdg-open")
        .arg(&canonical)
        .spawn()
        .map_err(|e| OrchestratorError::launch_ctx("Failed to open file manager", e))?;

    Ok(())
}

/// Open a new terminal window at the given directory.
pub fn open_in_terminal(path: &str) -> Result<()> {
    let canonical = canonicalize_user_path(path)?;

    // Empty program = just open a terminal at the directory
    crate::process::spawn_detached_terminal("", &[], &canonical, None)?;
    Ok(())
}
