import { homedir } from "node:os";
import { join, resolve } from "node:path";

const TRACEPILOT_SESSION_DIR_ENV = "TRACEPILOT_SESSION_STATE_DIR";
const COPILOT_SESSION_DIR_ENV = "COPILOT_SESSION_STATE_DIR";

function expandHome(path: string, home: string): string {
  if (path === "~") return home;
  if (path.startsWith("~/") || path.startsWith("~\\")) return join(home, path.slice(2));
  return path;
}

/**
 * Resolve the Copilot session-state directory.
 *
 * Resolution order:
 * 1) TRACEPILOT_SESSION_STATE_DIR env override
 * 2) COPILOT_SESSION_STATE_DIR env override (keeps parity with Copilot CLI)
 * 3) Default: ~/.copilot/session-state
 */
export function getSessionStateDir(): string {
  const home = homedir();
  const override =
    process.env[TRACEPILOT_SESSION_DIR_ENV]?.trim() ||
    process.env[COPILOT_SESSION_DIR_ENV]?.trim();

  if (override) {
    return resolve(expandHome(override, home));
  }

  return join(home, ".copilot", "session-state");
}
