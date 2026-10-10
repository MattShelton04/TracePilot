import { setupPinia } from "@tracepilot/test-utils";
import {
  type ConversationTurn,
  calculateTokenCost,
  type SessionDetail,
  type ShutdownMetrics,
} from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";

// ── Mocks ──────────────────────────────────────────────────────────────
const sessionsStoreMock = {
  sessions: [] as Array<{ id: string; summary?: string; repository?: string }>,
  fetchSessions: vi.fn(async () => {}),
};
vi.mock("@/stores/sessions", () => ({
  useSessionsStore: () => sessionsStoreMock,
}));

const prefsStoreMock = {
  computeWholesaleCost: false,
  costPerPremiumRequest: 0.04,
  computeUsageBasedCostBreakdown: (
    model: string,
    input: number,
    cache: number,
    output: number,
    cacheWrite = 0,
  ) =>
    calculateTokenCost(model, {
      inputTokens: input,
      cacheReadTokens: cache,
      outputTokens: output,
      cacheWriteTokens: cacheWrite,
    }),
  computeWholesaleCostBreakdown: (
    model: string,
    input: number,
    cache: number,
    output: number,
    cacheWrite = 0,
  ) =>
    calculateTokenCost(model, {
      inputTokens: input,
      cacheReadTokens: cache,
      outputTokens: output,
      cacheWriteTokens: cacheWrite,
    }),
};
vi.mock("@/stores/preferences", () => ({
  usePreferencesStore: () => prefsStoreMock,
}));

const clientMock = {
  getSessionDetail: vi.fn(async (id: string) => ({ id, summary: id }) as SessionDetail),
  getShutdownMetrics: vi.fn(async (_id: string) => null as ShutdownMetrics | null),
  getSessionTurns: vi.fn(async (_id: string) => ({
    turns: [] as ConversationTurn[],
  })),
};
vi.mock("@tracepilot/client", () => ({
  getSessionDetail: (...args: unknown[]) => clientMock.getSessionDetail(...(args as [string])),
  getShutdownMetrics: (...args: unknown[]) => clientMock.getShutdownMetrics(...(args as [string])),
  getSessionTurns: (...args: unknown[]) => clientMock.getSessionTurns(...(args as [string])),
}));

// Import AFTER mocks
import {
  donutSegments,
  exitBadgeVariant,
  exitLabel,
  sessionLabel,
  useSessionComparison,
} from "../useSessionComparison";

function mountHook() {
  const TestHost = defineComponent({
    setup() {
      const comp = useSessionComparison();
      return { comp };
    },
    template: "<div />",
  });
  const wrapper = mount(TestHost);
  return { wrapper, comp: wrapper.vm.comp };
}

describe("useSessionComparison", () => {
  beforeEach(() => {
    setupPinia();
    sessionsStoreMock.sessions = [];
    sessionsStoreMock.fetchSessions = vi.fn(async () => {});
    clientMock.getSessionDetail = vi.fn(
      async (id: string) => ({ id, summary: id }) as SessionDetail,
    );
    clientMock.getShutdownMetrics = vi.fn(async (_id: string) => null);
    clientMock.getSessionTurns = vi.fn(async (_id: string) => ({ turns: [] }));
  });

  it("initializes with default state and empty computed collections", () => {
    const { comp } = mountHook();
    expect(comp.normMode).toBe("raw");
    expect(comp.selectedA).toBe("");
    expect(comp.compared).toBe(false);
    expect(comp.canCompare).toBeFalsy();
    expect(comp.metricsRows).toEqual([]);
    expect(comp.tokenBars).toEqual([]);
  });

  it("canCompare gates on two distinct non-empty selections and !loading", () => {
    const { comp } = mountHook();
    comp.selectedA = "s1";
    comp.selectedB = "s1";
    expect(comp.canCompare).toBeFalsy();
    comp.selectedB = "s2";
    expect(comp.canCompare).toBeTruthy();
    comp.loading = true;
    expect(comp.canCompare).toBeFalsy();
  });

  it("runComparison fetches both sides and flips compared=true", async () => {
    const { comp } = mountHook();
    comp.selectedA = "a";
    comp.selectedB = "b";
    await comp.runComparison();
    expect(clientMock.getSessionDetail).toHaveBeenCalledWith("a");
    expect(clientMock.getSessionDetail).toHaveBeenCalledWith("b");
    expect(comp.compared).toBe(true);
    expect(comp.loading).toBe(false);
    expect(comp.error).toBe(null);
  });

  it("runComparison surfaces errors via error + leaves compared=false", async () => {
    clientMock.getSessionDetail = vi.fn(async (_id: string) => {
      throw new Error("boom");
    });
    const { comp } = mountHook();
    comp.selectedA = "a";
    comp.selectedB = "b";
    await comp.runComparison();
    expect(comp.compared).toBe(false);
    expect(comp.error).toContain("boom");
  });

  it("metricsRows produces a row per metric once compared", async () => {
    const { comp } = mountHook();
    comp.selectedA = "a";
    comp.selectedB = "b";
    await comp.runComparison();
    const labels = comp.metricsRows.map((r) => r.label);
    expect(labels).toContain("Session Span");
    expect(comp.metricsRows.find((r) => r.label === "Session Span")?.hint).toMatch(/Wall-clock/);
    expect(labels).toContain("Turns");
    expect(labels).toContain("AI Credits");
    expect(labels).toContain("Success Rate");
    expect(comp.metricsRows.length).toBe(8);
  });

  it("shows unavailable telemetry without a token distribution or comparison delta", () => {
    const { comp } = mountHook();
    comp.compared = true;
    comp.dataA.metrics = { modelMetrics: { model: { usage: { inputTokens: 100 } } } };
    comp.dataB.metrics = null;

    expect(comp.metricsRows.find((row) => row.label === "Total Tokens")).toMatchObject({
      valueA: "—",
      valueB: "—",
      rawA: null,
      rawB: null,
      delta: "—",
      deltaClass: "delta-neutral",
      arrow: "",
    });
    expect(comp.metricsRows.find((row) => row.label === "AI Credits")).toMatchObject({
      valueA: "—",
      valueB: "—",
      rawA: null,
      rawB: null,
      delta: "—",
    });
    expect(comp.tokenBars.find((row) => row.label === "Input")).toMatchObject({
      valueA: 100,
      valueB: null,
    });
    expect(comp.tokenBars.find((row) => row.label === "Output")).toMatchObject({
      valueA: null,
      valueB: null,
    });
    expect(comp.donutA).toEqual([]);
  });

  it("keeps recorded zero values distinct from an unavailable comparison side", () => {
    const { comp } = mountHook();
    comp.compared = true;
    comp.dataA.metrics = {
      totalNanoAiu: 0,
      modelMetrics: { model: { usage: { inputTokens: 0, outputTokens: 0 } } },
    };
    expect(comp.metricsRows.find((row) => row.label === "Total Tokens")).toMatchObject({
      valueA: "0",
      valueB: "—",
      rawA: 0,
      rawB: null,
      delta: "—",
    });
    expect(comp.metricsRows.find((row) => row.label === "AI Credits")).toMatchObject({
      valueA: "0 AIC",
      valueB: "—",
      rawA: 0,
      rawB: null,
      delta: "—",
    });
    expect(comp.tokenBars.find((row) => row.label === "Input")).toMatchObject({
      valueA: 0,
      valueB: null,
    });
  });

  it("keeps empty backend-shaped maps and observed-model-only credit totals unavailable", () => {
    const { comp } = mountHook();
    comp.compared = true;
    comp.dataA.metrics = { modelMetrics: {}, totalPremiumRequests: 3 };
    comp.dataB.metrics = {
      modelMetrics: {
        model: { totalNanoAiu: 1_000_000_000, usage: { inputTokens: 0, outputTokens: 0 } },
      },
    };
    expect(comp.metricsRows.find((row) => row.label === "Total Tokens")).toMatchObject({
      valueA: "—",
      valueB: "0",
      rawA: null,
      rawB: 0,
      delta: "—",
    });
    expect(comp.metricsRows.find((row) => row.label === "AI Credits")).toMatchObject({
      valueA: "—",
      valueB: "—",
      rawA: null,
      rawB: null,
      delta: "—",
    });
  });

  it("preserves complete metrics, observed credits, deltas and both normalization modes", () => {
    const { comp } = mountHook();
    const turn: ConversationTurn = {
      turnIndex: 0,
      toolCalls: [],
      assistantMessages: [],
      isComplete: true,
    };
    comp.compared = true;
    Object.assign(comp.dataA, {
      detail: {
        id: "a",
        hasPlan: false,
        hasCheckpoints: false,
        createdAt: "2026-10-01T00:00:00Z",
        updatedAt: "2026-10-01T00:02:00Z",
      },
      metrics: {
        totalNanoAiu: 2_000_000_000,
        modelMetrics: {
          model: { usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 30 } },
        },
      },
      turns: [turn, turn],
    });
    Object.assign(comp.dataB, {
      detail: {
        id: "b",
        hasPlan: false,
        hasCheckpoints: false,
        createdAt: "2026-10-01T00:00:00Z",
        updatedAt: "2026-10-01T00:04:00Z",
      },
      metrics: {
        totalNanoAiu: 4_000_000_000,
        modelMetrics: {
          model: { usage: { inputTokens: 200, outputTokens: 40, cacheReadTokens: 60 } },
        },
      },
      turns: [turn, turn, turn, turn],
    });
    expect(comp.metricsRows.find((row) => row.label === "Total Tokens")).toMatchObject({
      rawA: 120,
      rawB: 240,
      delta: "↑ 100%",
    });
    expect(comp.metricsRows.find((row) => row.label === "AI Credits")).toMatchObject({
      rawA: 2,
      rawB: 4,
      delta: "↑ 100%",
    });
    expect(comp.donutA[0]).toMatchObject({ tokens: 120, percentage: 1 });
    for (const mode of ["per-turn", "per-minute"] as const) {
      comp.normMode = mode;
      expect(comp.metricsRows.find((row) => row.label.startsWith("Total Tokens"))).toMatchObject({
        rawA: 60,
        rawB: 60,
        delta: "—",
      });
      expect(comp.metricsRows.find((row) => row.label.startsWith("AI Credits"))).toMatchObject({
        rawA: 1,
        rawB: 1,
        delta: "—",
      });
    }
  });
});

describe("session comparison across billing units", () => {
  beforeEach(() => setupPinia());

  const copilot = { totalNanoAiu: 2_000_000_000, modelMetrics: {} } as ShutdownMetrics;
  const claude = (amount: number) =>
    ({
      costAmount: amount,
      costUnit: "usd",
      costBasis: "providerEstimate",
      modelMetrics: {},
    }) as ShutdownMetrics;

  function compare(a: [string, ShutdownMetrics], b: [string, ShutdownMetrics]) {
    const { comp } = mountHook();
    comp.compared = true;
    comp.dataA.detail = { id: "a", source: a[0] } as SessionDetail;
    comp.dataA.metrics = a[1];
    comp.dataB.detail = { id: "b", source: b[0] } as SessionDetail;
    comp.dataB.metrics = b[1];
    return comp.metricsRows;
  }

  it("compares AI Credits and USD in USD, at $0.01 per credit", () => {
    const rows = compare(["copilot", copilot], ["claudeCode", claude(4.2)]);
    const cost = rows.find((row) => row.label === "Cost (USD)");
    expect(cost).toMatchObject({ valueA: "$0.02", valueB: "$4.20", rawA: 0.02, rawB: 4.2 });
    expect(cost?.delta).not.toBe("—");
    expect(rows.some((row) => row.label === "AI Credits")).toBe(false);
  });

  it("compares two USD-priced sessions with a delta", () => {
    const rows = compare(["claudeCode", claude(2)], ["claudeCode", claude(4)]);
    const cost = rows.find((row) => row.label === "Estimated Cost");
    expect(cost).toMatchObject({ valueA: "$2.00", valueB: "$4.00" });
    expect(cost?.delta).not.toBe("Different units");
    expect(cost?.delta).not.toBe("—");
  });
});

describe("helpers", () => {
  it("sessionLabel prefers summary then id then Unknown", () => {
    expect(sessionLabel(null)).toBe("Unknown");
    expect(sessionLabel({ id: "x" } as SessionDetail)).toBe("x");
    expect(sessionLabel({ id: "x", summary: "Sum" } as SessionDetail)).toBe("Sum");
  });

  it("exitBadgeVariant maps shutdown type to variant", () => {
    expect(exitBadgeVariant(null)).toBe("neutral");
    expect(exitBadgeVariant({ shutdownType: "clean_exit" } as ShutdownMetrics)).toBe("success");
    expect(exitBadgeVariant({ shutdownType: "forced_kill" } as ShutdownMetrics)).toBe("danger");
    expect(exitBadgeVariant({ shutdownType: "other" } as ShutdownMetrics)).toBe("warning");
  });

  it("exitLabel hides the chip for sources that do not report an exit", () => {
    expect(exitLabel(null, "claudeCode")).toBeNull();
    expect(exitLabel(null, "copilot")).toBe("Unknown");
    expect(exitLabel({ shutdownType: "routine" } as ShutdownMetrics, "claudeCode")).toBe("routine");
  });

  it("exitLabel returns shutdownType or Unknown", () => {
    expect(exitLabel(null)).toBe("Unknown");
    expect(exitLabel({ shutdownType: "completed" } as ShutdownMetrics)).toBe("completed");
  });

  it("donutSegments returns cumulative offsets for each segment", () => {
    const segs = donutSegments([
      { model: "a", tokens: 10, percentage: 0.5, color: "#111" },
      { model: "b", tokens: 10, percentage: 0.5, color: "#222" },
    ]);
    expect(segs).toHaveLength(2);
    expect(segs[0]!.offset).toBe(0);
    expect(segs[1]!.offset).toBeCloseTo(segs[0]!.length);
  });
});
