import type { ClaudeCleanupPeriod } from "../generated/bindings.js";

/** A user settings file that keeps Claude Code transcripts for a year. */
export const MOCK_CLAUDE_CLEANUP_PERIOD: ClaudeCleanupPeriod = {
  state: "set",
  days: 365,
  file: "C:\\Users\\dev\\.claude\\settings.json",
};

/** The mock settings file after raising it to `days`; a longer value is kept. */
export function mockRaiseClaudeCleanupPeriod(args?: Record<string, unknown>): ClaudeCleanupPeriod {
  const requested = typeof args?.days === "number" ? args.days : 0;
  const current = MOCK_CLAUDE_CLEANUP_PERIOD.days ?? 0;
  return { ...MOCK_CLAUDE_CLEANUP_PERIOD, days: Math.max(current, requested) };
}
