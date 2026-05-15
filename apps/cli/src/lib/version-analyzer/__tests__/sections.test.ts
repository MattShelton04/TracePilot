import { describe, expect, it } from "vitest";
import {
  aggregateObservedStats,
  type ReportContext,
  renderExecutiveSummary,
  renderHeader,
  renderInstalledVersions,
  renderRecommendations,
} from "../sections.js";
import type {
  CopilotVersion,
  CoverageReport,
  ReportOptions,
  SessionVersionInfo,
  VersionDiff,
} from "../types.js";

function makeVersion(version: string): CopilotVersion {
  return {
    version,
    path: `/fake/${version}`,
    eventTypes: [
      {
        name: "user.message",
        properties: [],
        requiredFields: [],
        ephemeral: "never",
      },
    ],
    rpcMethods: [],
    agents: [],
  };
}

function makeCoverage(): CoverageReport {
  return {
    schemaVersion: "1.0.42",
    totalSchemaEvents: 10,
    alwaysEphemeralCount: 2,
    persistedEventCount: 8,
    handledCount: 6,
    unhandledPersistedCount: 2,
    coveragePercentage: 75,
    observations: [
      {
        eventType: "tool.execution_start",
        inSchema: true,
        ephemeral: "never",
        handledByTracePilot: false,
        observedLocally: true,
        exampleSessions: [{ sessionId: "abc12345", copilotVersion: "1.0.42" }],
        category: "Tools",
        recommendation: "add typed support",
      },
      {
        eventType: "future.event",
        inSchema: true,
        ephemeral: "optional",
        handledByTracePilot: false,
        observedLocally: false,
        exampleSessions: [],
        category: "Future",
        recommendation: "monitor",
      },
    ],
  };
}

function makeContext(overrides: Partial<ReportContext> = {}): ReportContext {
  const versions = [makeVersion("1.0.41"), makeVersion("1.0.42")];
  const diffs: VersionDiff[] = [];
  const coverage = makeCoverage();
  const sessionInfo: SessionVersionInfo[] = [
    {
      sessionId: "session-1",
      copilotVersion: "1.0.42",
      eventTypesObserved: new Set(["user.message", "tool.execution_start"]),
      eventTypeCounts: new Map([
        ["user.message", 3],
        ["tool.execution_start", 5],
      ]),
      eventFieldCounts: new Map([["tool.execution_start", new Map([["toolName", 5]])]]),
    },
  ];
  const options: ReportOptions = {};
  const empiricalStats = aggregateObservedStats(sessionInfo);
  const latest = versions[versions.length - 1];
  const schemaEvents = new Map(latest.eventTypes.map((e) => [e.name, e]));
  const unknownObserved = [...empiricalStats.keys()].filter((e) => !schemaEvents.has(e));
  return {
    versions,
    diffs,
    coverage,
    sessionInfo,
    options,
    empiricalStats,
    schemaEvents,
    unknownObserved,
    ...overrides,
  };
}

describe("aggregateObservedStats", () => {
  it("aggregates counts and fields across sessions", () => {
    const sessions: SessionVersionInfo[] = [
      {
        sessionId: "s1",
        copilotVersion: "1.0.42",
        eventTypesObserved: new Set(["user.message"]),
        eventTypeCounts: new Map([["user.message", 2]]),
        eventFieldCounts: new Map([["user.message", new Map([["content", 2]])]]),
      },
      {
        sessionId: "s2",
        copilotVersion: "1.0.42",
        eventTypesObserved: new Set(["user.message"]),
        eventTypeCounts: new Map([["user.message", 3]]),
        eventFieldCounts: new Map([["user.message", new Map([["content", 3]])]]),
      },
    ];
    const stats = aggregateObservedStats(sessions);
    const stat = stats.get("user.message");
    expect(stat?.count).toBe(5);
    expect(stat?.sessions).toBe(2);
    expect(stat?.fields.get("content")).toBe(5);
  });
});

describe("renderHeader", () => {
  it("renders the markdown header with version list and session count", () => {
    const ctx = makeContext();
    const lines = renderHeader(ctx);
    expect(lines[0]).toBe("# Copilot CLI Version Analysis Report");
    expect(lines.some((l) => l.includes("Versions analyzed: 1.0.41, 1.0.42"))).toBe(true);
    expect(lines.some((l) => l.includes("Sessions scanned: 1"))).toBe(true);
  });

  it("includes the focus-diff line when fromVersion/toVersion are set", () => {
    const ctx = makeContext({ options: { fromVersion: "1.0.41", toVersion: "1.0.42" } });
    const lines = renderHeader(ctx);
    expect(lines.some((l) => l.includes("Focus diff: 1.0.41 → 1.0.42"))).toBe(true);
  });
});

describe("renderInstalledVersions", () => {
  it("renders a markdown table with one row per version", () => {
    const ctx = makeContext();
    const lines = renderInstalledVersions(ctx);
    expect(lines).toEqual([
      "## 2. Installed Versions",
      "",
      "| Version | Event Types | RPC Methods | Agents |",
      "|---------|------------|-------------|--------|",
      "| 1.0.41 | 1 | 0 | 0 |",
      "| 1.0.42 | 1 | 0 | 0 |",
      "",
    ]);
  });
});

describe("renderExecutiveSummary", () => {
  it("reports coverage percentage and gap", () => {
    const ctx = makeContext();
    const text = renderExecutiveSummary(ctx).join("\n");
    expect(text).toContain("**2 installed Copilot CLI versions**");
    expect(text).toContain("**6/8** persisted event types");
    expect(text).toContain("**Gap:** 2 persisted event types");
  });
});

describe("renderRecommendations", () => {
  it("lists observed-but-unhandled events as the priority bucket", () => {
    const ctx = makeContext();
    const text = renderRecommendations(ctx).join("\n");
    expect(text).toContain("Priority: Add typed support for observed-but-unhandled events");
    expect(text).toContain("`tool.execution_start`");
    expect(text).toContain("Monitor: Schema-defined but not yet observed locally");
    expect(text).toContain("`future.event`");
  });
});
