import type {
  GitInfo,
  TracePilotConfig,
  UpdateCheckResult,
  ValidateSessionDirResult,
} from "@tracepilot/types";

import { invoke } from "./internal/core.js";
import { isTauri } from "./invoke.js";

// ── Setup / Configuration Commands ────────────────────────────

/** Check if TracePilot config.toml exists (determines if setup is needed). */
export async function checkConfigExists(): Promise<boolean> {
  if (!isTauri()) return true; // In dev mode, skip setup
  return invoke<boolean>("check_config_exists");
}

/** Get the current TracePilot configuration. */
export async function getConfig(): Promise<TracePilotConfig> {
  return invoke<TracePilotConfig>("get_config");
}

/** Save TracePilot configuration (creates/updates config.toml). */
export async function saveConfig(config: TracePilotConfig): Promise<void> {
  return invoke<void>("save_config", { config });
}

/** Validate a session state directory path. */
export async function validateSessionDir(path: string): Promise<ValidateSessionDirResult> {
  if (!isTauri()) return { valid: true, sessionCount: 47 };
  return invoke<ValidateSessionDirResult>("validate_session_dir", { path });
}

/** Check if a session is currently running (has an inuse.*.lock file). */
export async function isSessionRunning(sessionId: string): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("is_session_running", { sessionId });
}

/** Check GitHub for a newer TracePilot release. Opt-in only. */
export async function checkForUpdates(): Promise<UpdateCheckResult> {
  return invoke<UpdateCheckResult>("check_for_updates");
}

/** Returns the install type: "source" | "installed" | "portable". */
export async function getInstallType(): Promise<string> {
  return invoke<string>("get_install_type");
}

/** Get git info (commit hash, branch) for the running instance. */
export async function getGitInfo(): Promise<GitInfo> {
  return invoke<GitInfo>("get_git_info");
}
