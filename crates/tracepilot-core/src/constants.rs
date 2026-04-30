//! Cross-crate constants.
//!
//! This module is the single source of truth for:
//!   * the default Copilot CLI command name
//!   * the Windows `CREATE_NO_WINDOW` process-creation flag
//!
//! If you find yourself hard-coding `"copilot"` or `0x08000000` anywhere in
//! the workspace: import from here instead.
//! See `docs/tech-debt-plan-revised-2026-04.md` Phase 1B.3.

/// Default executable name for the Copilot CLI. Used by launcher, bridge
/// discovery, and templates. Overridden by user preferences via
/// `TracePilotConfig.cli_command`.
pub const DEFAULT_CLI_COMMAND: &str = "copilot";

/// Default executable name for Git.
pub const DEFAULT_GIT_COMMAND: &str = "git";

/// Default executable name for the GitHub CLI.
pub const DEFAULT_GH_COMMAND: &str = "gh";

/// Windows `CREATE_NO_WINDOW` process-creation flag.
///
/// Set on every child process the desktop app spawns that does not need
/// a visible console, to prevent flashing `conhost.exe` windows. See
/// `tracepilot-orchestrator::process` for usage and the `store_memory`
/// note on Windows CMD flash.
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;
