import type { ConversationTurn, SessionDetail, ShutdownMetrics } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { defineComponent, h, provide, reactive } from "vue";
import {
  type SessionComparisonContext,
  SessionComparisonKey,
} from "@/composables/useSessionComparison";
import ComparisonCharts from "../ComparisonCharts.vue";
import ComparisonHeader from "../ComparisonHeader.vue";
import ComparisonMetrics from "../ComparisonMetrics.vue";

// ── Mocks ──────────────────────────────────────────────────────────────
vi.mock("@/stores/sessions", () => ({
  useSessionsStore: () => ({ sessions: [], fetchSessions: vi.fn(async () => {}) }),
}));
vi.mock("@/stores/preferences", () => ({
  usePreferencesStore: () => ({
    computeWholesaleCost: false,
    costPerPremiumRequest: 0.04,
  }),
}));

function makeCompStub(overrides: Partial<SessionComparisonContext> = {}): SessionComparisonContext {
  const base = {
    normMode: "raw" as const,
    selectedA: "",
    selectedB: "",
    loading: false,
    error: null as string | null,
    compared: false,
    dataA: {
      detail: null as SessionDetail | null,
      metrics: null as ShutdownMetrics | null,
      turns: [] as ConversationTurn[],
    },
    dataB: {
      detail: null as SessionDetail | null,
      metrics: null as ShutdownMetrics | null,
      turns: [] as ConversationTurn[],
    },
    sessionOptions: [] as Array<{ id: string; summary?: string; repository?: string }>,
    canCompare: false,
    metricsRows: [] as Array<{
      label: string;
      valueA: string;
      valueB: string;
      rawA: number;
      rawB: number;
      delta: string;
      deltaClass: string;
      arrow: string;
    }>,
    tokenBars: [] as Array<{
      label: string;
      valueA: number;
      valueB: number;
      maxVal: number;
      isCacheRow?: boolean;
    }>,
    donutA: [] as Array<{ model: string; tokens: number; percentage: number; color: string }>,
    donutB: [] as Array<{ model: string; tokens: number; percentage: number; color: string }>,
    toolCompRows: [] as Array<{ tool: string; countA: number; countB: number; maxCount: number }>,
    waveA: [] as number[],
    waveB: [] as number[],
    timelineA: [] as number[],
    timelineB: [] as number[],
    runComparison: vi.fn(),
    ...overrides,
  };
  return reactive(base) as unknown as SessionComparisonContext;
}

function hostFor<C>(child: C, comp: SessionComparisonContext) {
  return defineComponent({
    setup() {
      provide(SessionComparisonKey, comp);
      return () => h(child as never);
    },
  });
}

describe("ComparisonHeader", () => {
  it("renders empty-state when not compared", () => {
    const comp = makeCompStub();
    const wrapper = mount(hostFor(ComparisonHeader, comp));
    expect(wrapper.text()).toContain("Select Two Sessions");
  });

  it("invokes runComparison when Compare button clicked and canCompare=true", async () => {
    const comp = makeCompStub({
      selectedA: "a",
      selectedB: "b",
      canCompare: true,
      sessionOptions: [
        { id: "a", summary: "A", isRunning: false },
        { id: "b", summary: "B", isRunning: false },
      ] as never,
    });
    const wrapper = mount(hostFor(ComparisonHeader, comp));
    await wrapper.find(".compare-btn").trigger("click");
    expect(comp.runComparison).toHaveBeenCalled();
  });

  it("renders summary cards when compared=true", () => {
    const comp = makeCompStub({
      compared: true,
      dataA: {
        detail: { id: "s-a", summary: "Session A", eventCount: 10 } as SessionDetail,
        metrics: null,
        turns: [] as ConversationTurn[],
      },
      dataB: {
        detail: { id: "s-b", summary: "Session B", eventCount: 20 } as SessionDetail,
        metrics: null,
        turns: [] as ConversationTurn[],
      },
    });
    const wrapper = mount(hostFor(ComparisonHeader, comp));
    expect(wrapper.text()).toContain("Session A");
    expect(wrapper.text()).toContain("Session B");
  });

  function compared(sourceA: SessionDetail["source"], sourceB: SessionDetail["source"]) {
    const side = (id: string, source: SessionDetail["source"]) => ({
      detail: { id, summary: id, eventCount: 1, source } as SessionDetail,
      metrics:
        source === "claudeCode"
          ? ({} as ShutdownMetrics)
          : ({ shutdownType: "routine" } as ShutdownMetrics),
      turns: [] as ConversationTurn[],
    });
    const comp = makeCompStub({
      compared: true,
      dataA: side("a", sourceA),
      dataB: side("b", sourceB),
    });
    const wrapper = mount(hostFor(ComparisonHeader, comp));
    const chips = (card: string) =>
      wrapper.findAll(`.${card} .summary-meta .badge`).map((b) => b.text());
    return { a: chips("session-a"), b: chips("session-b") };
  }

  it("names each side's source and drops the exit chip a source does not report", () => {
    const { a, b } = compared("claudeCode", "copilot");
    expect(a[0]).toBe("Claude Code");
    expect(b[0]).toBe("Copilot");
    expect(a).not.toContain("Unknown");
    expect(b).toContain("routine");
  });

  it("leaves a Copilot-only comparison without source chips", () => {
    const { a, b } = compared("copilot", "copilot");
    expect([...a, ...b]).not.toContain("Copilot");
    expect(a).toContain("routine");
  });
});

describe("ComparisonMetrics", () => {
  it("renders metrics rows and toggles normMode", async () => {
    const comp = makeCompStub({
      compared: true,
      metricsRows: [
        {
          label: "Turns",
          valueA: "5",
          valueB: "7",
          rawA: 5,
          rawB: 7,
          delta: "+2",
          deltaClass: "delta-positive",
          arrow: "↑",
        },
      ],
    });
    const wrapper = mount(hostFor(ComparisonMetrics, comp));
    expect(wrapper.text()).toContain("Turns");
    const btns = wrapper.findAll(".toggle-btn");
    await btns[1]!.trigger("click");
    expect(comp.normMode).toBe("per-turn");
  });

  it("renders token bars and tool-usage empty state", () => {
    const comp = makeCompStub({
      compared: true,
      tokenBars: [
        { label: "Input", valueA: 100, valueB: 200, maxVal: 200 },
        { label: "Output", valueA: 50, valueB: 75, maxVal: 200 },
      ],
    });
    const wrapper = mount(hostFor(ComparisonMetrics, comp));
    expect(wrapper.findAll(".bar-row").length).toBeGreaterThan(0);
    expect(wrapper.text()).toContain("No tool usage data");
  });

  it("renders unknown token values as a dash and recorded zero as zero", () => {
    const comp = makeCompStub({
      compared: true,
      metricsRows: [
        {
          label: "AI Credits",
          valueA: "0",
          valueB: "—",
          rawA: 0,
          rawB: null,
          delta: "—",
          deltaClass: "delta-neutral",
          arrow: "",
        },
      ],
      tokenBars: [{ label: "Input", valueA: 0, valueB: null, maxVal: 1 }],
    });
    const wrapper = mount(hostFor(ComparisonMetrics, comp));
    expect(wrapper.findAll(".bar-value-outside").map((node) => node.text())).toEqual(["0", "—"]);
    expect(wrapper.find(".val-a").text()).toBe("0");
    expect(wrapper.find(".val-b").text()).toBe("—");
    expect(wrapper.find(".delta-col").text()).toBe("—");
    expect(
      wrapper.findAll(".bar-fill").every((node) => node.attributes("style") === "width: 0%;"),
    ).toBe(true);
  });
});

describe("ComparisonCharts", () => {
  it("renders waveform bars and timeline blocks", () => {
    const comp = makeCompStub({
      compared: true,
      dataA: {
        detail: { id: "a" } as SessionDetail,
        metrics: null,
        turns: [{ durationMs: 1000 } as ConversationTurn],
      },
      dataB: {
        detail: { id: "b" } as SessionDetail,
        metrics: null,
        turns: [{ durationMs: 2000 } as ConversationTurn],
      },
      waveA: [50, 80],
      waveB: [40],
      timelineA: [50, 50],
      timelineB: [100],
    });
    const wrapper = mount(hostFor(ComparisonCharts, comp));
    expect(wrapper.findAll(".waveform-bar-a").length).toBe(2);
    expect(wrapper.findAll(".waveform-bar-b").length).toBe(1);
    expect(wrapper.findAll(".mini-tl-block").length).toBe(3);
  });

  it("shows empty state when waveA/waveB are empty", () => {
    const comp = makeCompStub({ compared: true });
    const wrapper = mount(hostFor(ComparisonCharts, comp));
    expect(wrapper.text()).toContain("No turns");
  });
});
