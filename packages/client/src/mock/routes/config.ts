import type { SessionLiveness } from "@tracepilot/types";
import type { GitInfo, UpdateCheckResult } from "../../generated/bindings.js";
import { MOCK_CLAUDE_CLEANUP_PERIOD, mockRaiseClaudeCleanupPeriod } from "../claudeSettings.js";
import { MOCK_COPILOT_FORMAT_DIAGNOSTICS } from "../formatDiagnostics.js";
import type { MockRoutes } from "./route.js";

/**
 * Commands from `config.ts`. The config itself (`get_config`, `save_config`,
 * `update_config`) is stateful and lives in `internal/mockConfig.ts`.
 */
export const CONFIG_ROUTES: MockRoutes = {
  check_config_exists: () => true,
  validate_session_dir: () => ({ valid: true, sessionCount: 47, error: null, missing: false }),
  validate_claude_config_dir: () => ({ valid: true, sessionCount: 3, error: null, missing: false }),
  get_claude_cleanup_period: () => MOCK_CLAUDE_CLEANUP_PERIOD,
  raise_claude_cleanup_period: (args) => mockRaiseClaudeCleanupPeriod(args),
  get_source_format_diagnostics: () => MOCK_COPILOT_FORMAT_DIAGNOSTICS,
  get_session_liveness: (): SessionLiveness => ({ state: "idle" }),
  check_for_updates: (): UpdateCheckResult => ({
    currentVersion: "0.1.0",
    latestVersion: "0.1.0",
    hasUpdate: false,
    releaseUrl: null,
    publishedAt: null,
    releaseNotes: null,
  }),
  get_install_type: () => "source",
  get_git_info: (): GitInfo => ({ commitHash: "abc1234", branch: "main" }),
};
