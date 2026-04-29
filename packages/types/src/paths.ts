/**
 * Shared TypeScript constants for user-facing path placeholders and common
 * external command names. Absolute runtime defaults are resolved by Rust,
 * because only the backend has reliable access to the user's home directory.
 */

export const COPILOT_HOME_PLACEHOLDER = "~/.copilot";
export const COPILOT_SESSION_STATE_DIR_PLACEHOLDER = `${COPILOT_HOME_PLACEHOLDER}/session-state`;
export const TRACEPILOT_HOME_PLACEHOLDER = `${COPILOT_HOME_PLACEHOLDER}/tracepilot`;
export const TRACEPILOT_INDEX_DB_PLACEHOLDER = `${TRACEPILOT_HOME_PLACEHOLDER}/index.db`;
export const TRACEPILOT_BACKUPS_PLACEHOLDER = `${TRACEPILOT_HOME_PLACEHOLDER}/backups`;

export const DEFAULT_GIT_COMMAND = "git";
export const DEFAULT_GH_COMMAND = "gh";
