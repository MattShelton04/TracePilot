//! Cross-crate constants.
//!
//! This module is the single source of truth for:
//!   * the default Copilot CLI command name
//!   * the default model IDs used by sessions and subagents
//!   * the Windows `CREATE_NO_WINDOW` process-creation flag
//!
//! If you find yourself hard-coding `"copilot"`, `"claude-haiku-4.5"`,
//! or `0x08000000` anywhere in the workspace: import from here instead.
//! See `docs/tech-debt-plan-revised-2026-04.md` Phase 1B.3.

/// Default executable name for the Copilot CLI. Used by launcher,
/// bridge discovery, task orchestrator, and templates. Overridden by
/// user preferences via `TracePilotConfig.cli_command`.
pub const DEFAULT_CLI_COMMAND: &str = "copilot";

/// Default executable name for Git.
pub const DEFAULT_GIT_COMMAND: &str = "git";

/// Default executable name for the GitHub CLI.
pub const DEFAULT_GH_COMMAND: &str = "gh";

/// Default model ID used by the task orchestrator itself (the session
/// that plans and dispatches subagents). Matches the frontend
/// `DEFAULT_MODEL` hard-coded in `stores/orchestrator.ts`.
pub const DEFAULT_ORCHESTRATOR_MODEL: &str = "claude-haiku-4.5";

/// Back-compat alias. Prefer [`DEFAULT_ORCHESTRATOR_MODEL`] for new code.
pub const DEFAULT_MODEL_ID: &str = DEFAULT_ORCHESTRATOR_MODEL;

/// Default model ID used when launching a subagent task. Intentionally
/// different from [`DEFAULT_ORCHESTRATOR_MODEL`]: subagents get a more
/// capable model because they do the actual work.
pub const DEFAULT_SUBAGENT_MODEL: &str = "claude-sonnet-4.6";

/// Windows `CREATE_NO_WINDOW` process-creation flag.
///
/// Set on every child process the desktop app spawns that does not need
/// a visible console, to prevent flashing `conhost.exe` windows. See
/// `tracepilot-orchestrator::process` for usage and the `store_memory`
/// note on Windows CMD flash.
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;
