import { setupPinia } from "@tracepilot/test-utils";
import type { ConversationTurn, SessionDetail, ShutdownMetrics } from "@tracepilot/types";
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
    expect(labels).toContain("Duration");
    expect(labels).toContain("Turns");
    expect(labels).toContain("Success Rate");
    expect(comp.metricsRows.length).toBe(9);
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
