import { makeTurn, makeTurnToolCall } from "@tracepilot/test-utils";
import type { AgentUsageEntry, ShutdownMetrics } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import { agentUsageCoverage, buildAgentUsageRows } from "../agentUsageRows";

const entry = (tokens: number, credits: number): AgentUsageEntry => ({
  totalNanoAiu: credits * 1e9,
  totalApiDurationMs: 1000,
  modelMetrics: {
    luna: {
      requests: { count: 1 },
      totalNanoAiu: credits * 1e9,
      usage: {
        inputTokens: tokens - 10,
        outputTokens: 10,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
    },
  },
});
const snapshot = (agents: Record<string, AgentUsageEntry>): ShutdownMetrics => ({
  totalNanoAiu: 6e9,
  metricsTimestamp: "2026-09-12T10:00:00Z",
  agentUsage: {
    timestamp: "2026-09-12T10:00:00Z",
    eventIndex: 10,
    agents,
    hasInvalidFields: false,
  },
});
const turns = () => [
  makeTurn({
    toolCalls: [
      makeTurnToolCall({
        toolCallId: "outer-call",
        agentId: "outer-id",
        agentDisplayName: "worker",
        isSubagent: true,
        totalTokens: 13818,
      }),
      makeTurnToolCall({
        toolCallId: "inner-call",
        agentId: "inner-id",
        parentToolCallId: "outer-call",
        agentDisplayName: "worker",
        isSubagent: true,
      }),
      makeTurnToolCall({ toolCallId: "read", parentToolCallId: "inner-call" }),
    ],
  }),
];

describe("agent usage identities and exclusive accounting", () => {
  it("ignores shuffled backend ledger/model map order across refreshes", () => {
    const agents = {
      main: entry(100, 1),
      "outer-id": entry(9294, 2),
      "inner-id": entry(4524, 3),
      "unknown-z": entry(100, 0),
      "unknown-a": entry(100, 0),
    };
    agents["outer-id"].modelMetrics = {
      z: { usage: { inputTokens: 100, outputTokens: 20 } },
      a: { usage: { inputTokens: 100, outputTokens: 20 } },
    };
    const first = buildAgentUsageRows(snapshot(agents), turns());
    const reversed = Object.fromEntries(Object.entries(agents).reverse());
    reversed["outer-id"] = {
      ...agents["outer-id"],
      modelMetrics: Object.fromEntries(Object.entries(agents["outer-id"].modelMetrics).reverse()),
    };
    const second = buildAgentUsageRows(snapshot(reversed), turns());
    expect(first.map((row) => row.id)).toEqual([
      "main",
      "outer-id",
      "inner-id",
      "unknown-a",
      "unknown-z",
    ]);
    expect(second.map((row) => [row.id, row.depth, row.modelNames])).toEqual(
      first.map((row) => [row.id, row.depth, row.modelNames]),
    );
  });
  it("joins runtime IDs, preserves duplicate names and computes nested rollups once", () => {
    const rows = buildAgentUsageRows(
      snapshot({ main: entry(100, 1), "outer-id": entry(9294, 2), "inner-id": entry(4524, 3) }),
      turns(),
    );
    expect(rows.map((row) => [row.id, row.parentId, row.depth])).toEqual([
      ["main", null, 0],
      ["outer-id", "main", 1],
      ["inner-id", "outer-id", 2],
    ]);
    expect(rows[1].own.tokens.total).toBe(9294);
    expect(rows[1].branch.tokens.total).toBe(13818);
    expect(rows[0].branch.credits).toBe(6);
    expect(rows.map((row) => row.own.tools)).toEqual([1, 1, 1]);
    expect(rows[1].name).toBe(rows[2].name);
  });
  it("keeps legacy activities unavailable and partial rollups explicit", () => {
    const rows = buildAgentUsageRows(
      snapshot({ main: entry(100, 1), "inner-id": entry(4524, 0) }),
      turns(),
    );
    expect(rows[1].own.credits).toBeNull();
    expect(rows[1].branch).toMatchObject({ credits: 0, partial: true });
    expect(rows[0].branch.tokens.total).toBeNull();
    expect(buildAgentUsageRows({}, turns())[1].own.tokens.total).toBeNull();
  });
  it("retains ledger-only identities and handles malformed cycles without looping", () => {
    const cycle = turns();
    cycle[0].toolCalls[0].parentToolCallId = "inner-call";
    const rows = buildAgentUsageRows(snapshot({ orphan: entry(100, 1) }), cycle);
    expect(new Set(rows.map((row) => row.id)).size).toBe(4);
    expect(rows.find((row) => row.id === "orphan")).toMatchObject({
      parentId: null,
      status: "unlinked",
    });
  });
  it("reconciles exclusive credits, including zero, and refuses stale comparisons", () => {
    const metrics = snapshot({ main: entry(100, 1), worker: entry(100, 0) });
    expect(agentUsageCoverage(metrics)).toMatchObject({
      attributed: 1,
      remainder: 5,
      complete: true,
    });
    metrics.metricsTimestamp = "2026-09-12T10:01:00Z";
    expect(agentUsageCoverage(metrics)).toMatchObject({
      sessionCredits: null,
      remainder: null,
      comparable: false,
    });
    metrics.metricsTimestamp = metrics.agentUsage?.timestamp;
    metrics.totalNanoAiu = 0;
    expect(agentUsageCoverage(metrics).exceedsTotal).toBe(true);
  });
});
