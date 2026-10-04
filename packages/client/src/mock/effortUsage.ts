import type { SessionEffortUsage } from "@tracepilot/types";

// A session that moved from high to medium effort, with request records.
export const MOCK_EFFORT_USAGE: SessionEffortUsage = {
  hasRequestData: true,
  entries: [
    {
      model: "gpt-5.6-luna",
      reasoningEffort: "high",
      sessions: 0,
      userTurns: 4,
      agentTurns: 26,
      toolCalls: 31,
      wallMs: 498_000,
      observedUserTurns: 4,
      requests: 26,
      reasoningTokens: 6_040,
      outputTokens: 15_800,
      apiDurationMs: 148_000,
      nanoAiu: 24_600_000_000,
      subagentRequests: 9,
      subagentNanoAiu: 2_100_000_000,
    },
    {
      model: "gpt-5.6-luna",
      reasoningEffort: "medium",
      sessions: 0,
      userTurns: 2,
      agentTurns: 7,
      toolCalls: 8,
      wallMs: 121_000,
      observedUserTurns: 2,
      requests: 7,
      reasoningTokens: 330,
      outputTokens: 1_100,
      apiDurationMs: 18_400,
      nanoAiu: 760_000_000,
      subagentRequests: 0,
      subagentNanoAiu: 0,
    },
  ],
};
