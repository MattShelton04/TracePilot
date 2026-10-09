import type { SessionLiveness, TracePilotConfig, TracePilotConfigPatch } from "@tracepilot/types";

export type { TracePilotConfigPatch } from "@tracepilot/types";

import type {
  GitInfo,
  SessionSource,
  SourceFormatDiagnostics,
  UpdateCheckResult,
  ValidateSessionDirResult,
} from "./generated/bindings.js";
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

/** Atomically merge changed fields into the current persisted configuration. */
export async function updateConfig(patch: TracePilotConfigPatch): Promise<TracePilotConfig> {
  return invoke<TracePilotConfig>("update_config", { patch });
}

/** Validate a session state directory path. */
export async function validateSessionDir(path: string): Promise<ValidateSessionDirResult> {
  if (!isTauri()) return { valid: true, sessionCount: 47, error: null };
  return invoke<ValidateSessionDirResult>("validate_session_dir", { path });
}

/** Validate a Claude Code config folder and count its sessions. */
export async function validateClaudeConfigDir(path: string): Promise<ValidateSessionDirResult> {
  if (!isTauri()) return { valid: true, sessionCount: 3, error: null };
  return invoke<ValidateSessionDirResult>("validate_claude_config_dir", { path });
}

/**
 * Format drift recorded when a source's sessions were indexed: unmapped record
 * and attachment types, and the producer versions seen. Names and counts only.
 */
export async function getSourceFormatDiagnostics(
  source: SessionSource,
): Promise<SourceFormatDiagnostics> {
  return invoke<SourceFormatDiagnostics>("get_source_format_diagnostics", { source });
}

/** Whether a live process owns a session, and what it is doing when the source records it. */
export async function getSessionLiveness(sessionId: string): Promise<SessionLiveness> {
  if (!isTauri()) return { state: "idle" };
  return invoke<SessionLiveness>("get_session_liveness", { sessionId });
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
