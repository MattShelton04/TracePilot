import {
  agentCatalog as catalog,
  agentDefinition as definition,
  agentUsage as usage,
} from "@tracepilot/client/mock";
import type { AgentUsageSummary } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import { buildAgentEntries, filterAndSortEntries } from "../entries";
import { buildAgentInsights } from "../insights";
import { rangeBounds, rangeDays } from "../range";

function summary(agents: ReturnType<typeof usage>[]): AgentUsageSummary {
  return {
    totalRuns: agents.reduce((sum, a) => sum + a.runs, 0),
    totalSessions: 1,
    failedRuns: 0,
    cancelledRuns: 0,
    incompleteRuns: 0,
    maxDepth: 0,
    peakParallelism: 1,
    runsWithCredits: 0,
    totalOwnNanoAiu: 0,
    agents,
    mainAgentSelections: [],
  };
}

const NOW = new Date("2026-09-19T12:00:00Z");

describe("buildAgentEntries", () => {
  it("attaches usage to the most local definition and keeps session-only agents", () => {
    const builtin = definition("explore", { scope: "builtin", id: "/pkg/explore.agent.yaml" });
    const project = definition("explore", {
      scope: "project",
      id: "/repo/.github/agents/explore.agent.md",
    });
    const entries = buildAgentEntries(
      catalog([builtin, project]),
      summary([usage("explore"), usage("general-purpose"), usage("old-helper")]),
      "30d",
      NOW,
    );

    expect(entries.find((e) => e.key === project.id)?.usage?.name).toBe("explore");
    expect(entries.find((e) => e.key === builtin.id)?.usage).toBeNull();
    const embedded = entries.find((e) => e.name === "general-purpose");
    expect(embedded?.kind).toBe("embedded");
    expect(embedded?.scope).toBe("builtin");
    expect(entries.find((e) => e.name === "old-helper")?.kind).toBe("unresolved");
  });

  it("matches usage by file stem and applies overrides and disabled lists case-insensitively", () => {
    const reviewer = definition("Team Reviewer", { fileStem: "reviewer" });
    const entries = buildAgentEntries(
      catalog([reviewer], {
        overrides: { REVIEWER: { model: "gpt-5.4", effortLevel: null, contextTier: null } },
        disabled: ["reviewer"],
      }),
      summary([usage("reviewer")]),
      "30d",
      NOW,
    );
    expect(entries[0].usage?.name).toBe("reviewer");
    expect(entries[0].override?.model).toBe("gpt-5.4");
    expect(entries[0].flags).toEqual(expect.arrayContaining(["overridden", "disabled"]));
  });

  it("computes flags from their documented thresholds", () => {
    const entries = buildAgentEntries(
      catalog([
        definition("idle"),
        definition("fresh", { modifiedAt: "2026-09-10T00:00:00Z" }),
        definition("explore", { scope: "builtin" }),
      ]),
      summary([
        usage("flaky", { runs: 20, failed: 2, cancelled: 1 }),
        usage("tiny", { runs: 5, failed: 4 }),
        usage("slowpoke", {
          previousMedianDurationMs: 1000,
          durationMs: { count: 12, min: 1, p25: 1, p50: 2000, p75: 3000, p90: 3500, max: 4000 },
        }),
        usage("blip", {
          previousMedianDurationMs: 1000,
          durationMs: { count: 5, min: 1, p25: 1, p50: 2000, p75: 3000, p90: 3500, max: 4000 },
        }),
        usage("drift", { mismatchRuns: 2 }),
      ]),
      "30d",
      NOW,
    );
    const flags = (name: string) => entries.find((e) => e.name === name)?.flags;
    expect(flags("idle")).toEqual(["unused"]);
    expect(flags("fresh"), "created inside the range").toEqual([]);
    expect(flags("explore"), "built-ins are never unused").toEqual([]);
    expect(flags("flaky")).toEqual(["failing"]);
    expect(flags("tiny"), "fewer than 20 runs").toEqual([]);
    expect(flags("slowpoke")).toEqual(["slow"]);
    expect(flags("blip"), "too few timed runs to call a trend").toEqual([]);
    expect(flags("drift")).toEqual(["mismatch"]);
  });
});

describe("filterAndSortEntries", () => {
  const entries = buildAgentEntries(
    catalog([definition("alpha"), definition("beta", { scope: "project" })]),
    summary([
      usage("alpha", {
        runs: 5,
        durationMs: { count: 1, min: 1, p25: 1, p50: 900, p75: 1, p90: 1, max: 1 },
      }),
      usage("beta", { runs: 50 }),
    ]),
    "all",
    NOW,
  );

  it("filters by scope and search and sorts entries without data last", () => {
    const base = {
      scope: "all" as const,
      flags: new Set<never>(),
      search: "",
      sort: "runs" as const,
    };
    expect(filterAndSortEntries(entries, base).map((e) => e.name)).toEqual(["beta", "alpha"]);
    expect(filterAndSortEntries(entries, { ...base, scope: "project" }).map((e) => e.name)).toEqual(
      ["beta"],
    );
    expect(filterAndSortEntries(entries, { ...base, search: "ALP" }).map((e) => e.name)).toEqual([
      "alpha",
    ]);
    expect(filterAndSortEntries(entries, { ...base, sort: "duration" }).map((e) => e.name)).toEqual(
      ["alpha", "beta"],
    );
  });
});

describe("buildAgentInsights", () => {
  it("reports only actionable observations, each with its filter", () => {
    const entries = buildAgentEntries(
      catalog([definition("idle")]),
      summary([
        usage("explore", { runs: 2411 }),
        usage("drift", { mismatchRuns: 3 }),
        usage("ghost"),
      ]),
      "30d",
      NOW,
    );
    const insights = buildAgentInsights(entries);
    expect(insights.map((i) => i.id)).toEqual(["mismatch", "unused", "unresolved"]);
    expect(insights.every((insight) => insight.filter)).toBe(true);
    expect(insights.find((i) => i.id === "unresolved")?.filter).toEqual({ scope: "unresolved" });
  });
});

describe("range helpers", () => {
  it("produce inclusive UTC bounds and zero-fill days", () => {
    expect(rangeBounds("30d", NOW)).toEqual({ fromDate: "2026-08-21", toDate: "2026-09-19" });
    expect(rangeBounds("all", NOW)).toEqual({ fromDate: null, toDate: null });
    expect(rangeDays("30d", null, NOW)).toHaveLength(30);
    expect(rangeDays("all", "2026-09-17T08:00:00Z", NOW)).toEqual([
      "2026-09-17",
      "2026-09-18",
      "2026-09-19",
    ]);
  });
});
