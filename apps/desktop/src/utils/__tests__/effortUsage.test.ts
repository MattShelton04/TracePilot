import type { EffortUsageEntry } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import { effortCoverage, effortRows } from "../effortUsage";

function entry(overrides: Partial<EffortUsageEntry>): EffortUsageEntry {
  return {
    sessions: 0,
    userTurns: 0,
    agentTurns: 0,
    toolCalls: 0,
    wallMs: 0,
    observedUserTurns: 0,
    requests: 0,
    reasoningTokens: 0,
    outputTokens: 0,
    apiDurationMs: 0,
    nanoAiu: 0,
    subagentRequests: 0,
    subagentNanoAiu: 0,
    ...overrides,
  };
}

describe("effortRows", () => {
  it("averages event figures over all user turns and recorded ones over observed turns", () => {
    const [row] = effortRows([
      entry({
        model: "gpt-5.6-luna",
        reasoningEffort: "high",
        userTurns: 4,
        agentTurns: 24,
        wallMs: 400_000,
        observedUserTurns: 2,
        reasoningTokens: 3_000,
        apiDurationMs: 60_000,
        nanoAiu: 5_000_000_000,
      }),
    ]);
    expect(row.requestsPerTurn).toBe(6);
    expect(row.wallMsPerTurn).toBe(100_000);
    expect(row.reasoningTokensPerTurn).toBe(1_500);
    expect(row.apiMsPerTurn).toBe(30_000);
    expect(row.creditsPerTurn).toBe(2.5);
  });

  it("leaves recorded figures empty without request records", () => {
    const [row] = effortRows([entry({ model: "claude-sonnet-4.6", userTurns: 3, agentTurns: 9 })]);
    expect(row.effort).toBe("default");
    expect(row.reasoningTokensPerTurn).toBeNull();
    expect(row.creditsPerTurn).toBeNull();
  });

  it("groups by model, busiest first, with efforts lowest first", () => {
    const rows = effortRows([
      entry({ model: "a", reasoningEffort: "xhigh", userTurns: 1 }),
      entry({ model: "b", reasoningEffort: "high", userTurns: 5 }),
      entry({ model: "a", reasoningEffort: "medium", userTurns: 1 }),
      entry({ model: "b", reasoningEffort: "low", userTurns: 1 }),
    ]);
    expect(rows.map((r) => `${r.model}:${r.effort}`)).toEqual([
      "b:low",
      "b:high",
      "a:medium",
      "a:xhigh",
    ]);
  });
});

describe("effortCoverage", () => {
  it("counts observed user turns against all of them", () => {
    expect(
      effortCoverage([
        entry({ userTurns: 3, observedUserTurns: 1 }),
        entry({ userTurns: 2, observedUserTurns: 2 }),
      ]),
    ).toEqual({ observed: 3, total: 5 });
  });
});
