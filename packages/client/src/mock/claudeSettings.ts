import type { ClaudeCleanupPeriod } from "../generated/bindings.js";

/** A user settings file that keeps Claude Code transcripts for a year. */
export const MOCK_CLAUDE_CLEANUP_PERIOD: ClaudeCleanupPeriod = {
  state: "set",
  days: 365,
  file: "C:\\Users\\dev\\.claude\\settings.json",
};
