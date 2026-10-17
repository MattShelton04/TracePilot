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
    isStale: false,
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
    donutA: [] as Array<{
      model: string;
      label: string;
      tokens: number;
      percentage: number;
      color: string;
    }>,
    donutB: [] as Array<{
      model: string;
      label: string;
      tokens: number;
      percentage: number;
      color: string;
    }>,
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

  it("searches each side's sessions by project and words, and tells same-named ones apart by date", async () => {
    const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
    const comp = makeCompStub({
      sessionOptions: [
        { id: "r1", summary: "Nightly run", repository: "org/app", updatedAt: hoursAgo(2) },
        { id: "r2", summary: "Nightly run", repository: "org/app", updatedAt: hoursAgo(50) },
        {
          id: "cc",
          summary: "Fix login bug",
          source: "claudeCode",
          repository: null,
          cwd: "C:\\synthetic\\harbor",
          updatedAt: hoursAgo(5),
        },
      ] as never,
    });
    const wrapper = mount(hostFor(ComparisonHeader, comp), { attachTo: document.body });
    const pickerA = wrapper.get<HTMLInputElement>('[role="combobox"][aria-label="Session A"]');
    const pickerB = wrapper.get<HTMLInputElement>('[role="combobox"][aria-label="Session B"]');

    pickerA.element.focus();
    await pickerA.setValue("nightly");
    const metas = wrapper.findAll('[role="option"]').map((o) => o.text());
    expect(metas).toEqual([expect.stringContaining("2h ago"), expect.stringContaining("2d ago")]);

    await pickerA.setValue("harbor");
    expect(wrapper.findAll('[role="option"]').map((o) => o.text())).toEqual([
      expect.stringContaining("Fix login bug"),
    ]);
    await pickerA.trigger("keydown", { key: "ArrowDown" });
    await pickerA.trigger("keydown", { key: "Enter" });
    expect(comp.selectedA).toBe("cc");
    expect(pickerA.element.value).toBe("Fix login bug — harbor");

    pickerB.element.focus();
    await pickerB.setValue("run nightly");
    await pickerB.trigger("keydown", { key: "ArrowDown" });
    await pickerB.trigger("keydown", { key: "ArrowDown" });
    await pickerB.trigger("keydown", { key: "Enter" });
    expect(comp.selectedB).toBe("r2");
    wrapper.unmount();
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
    expect(a).not.toContain("No exit record");
    expect(b).toContain("Ended normally");
  });

  it("leaves a Copilot-only comparison without source chips", () => {
    const { a, b } = compared("copilot", "copilot");
    expect([...a, ...b]).not.toContain("Copilot");
    expect(a).toContain("Ended normally");
  });

  it("counts a single turn and event in the singular", () => {
    const side = (id: string, turns: number, events: number) => ({
      detail: { id, summary: id, eventCount: events } as SessionDetail,
      metrics: null,
      turns: Array.from({ length: turns }, (_, i) => ({ turnIndex: i }) as ConversationTurn),
    });
    const comp = makeCompStub({ compared: true, dataA: side("a", 1, 1), dataB: side("b", 2, 0) });
    const header = mount(hostFor(ComparisonHeader, comp));
    const chips = (card: string) =>
      header.findAll(`.${card} .summary-meta .badge`).map((b) => b.text());
    expect(chips("session-a")).toEqual(expect.arrayContaining(["1 turn", "1 event"]));
    expect(chips("session-b")).toEqual(expect.arrayContaining(["2 turns", "0 events"]));

    const charts = mount(hostFor(ComparisonCharts, comp));
    expect(charts.findAll(".timeline-label").map((l) => l.text())).toEqual([
      "Session A — — (1 turn)",
      "Session B — — (2 turns)",
    ]);
  });

  it("says when the results no longer match the picked sessions", () => {
    const side = (id: string) => ({
      detail: { id, summary: id, eventCount: 1 } as SessionDetail,
      metrics: null,
      turns: [] as ConversationTurn[],
    });
    const fresh = mount(
      hostFor(
        ComparisonHeader,
        makeCompStub({ compared: true, dataA: side("a"), dataB: side("b") }),
      ),
    );
    expect(fresh.text()).not.toContain("Selection changed.");

    const stale = mount(
      hostFor(
        ComparisonHeader,
        makeCompStub({ compared: true, isStale: true, dataA: side("a"), dataB: side("b") }),
      ),
    );
    expect(stale.get('[role="status"]').text()).toContain("Click Compare to update them");
    expect(stale.findAll(".session-name").map((n) => n.text())).toEqual(["a", "b"]);
  });

  it("draws the empty state's icon with Lucide, not an emoji", () => {
    const wrapper = mount(hostFor(ComparisonHeader, makeCompStub()));
    expect(wrapper.find(".lucide-columns-2, svg").exists()).toBe(true);
    expect(wrapper.text()).not.toMatch(/\p{Extended_Pictographic}/u);
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

  it("labels each bar and block with the turn number the app shows", () => {
    const comp = makeCompStub({
      compared: true,
      dataA: {
        detail: { id: "a" } as SessionDetail,
        metrics: null,
        turns: [
          { turnIndex: 0, durationMs: 1000 },
          { turnIndex: 1, durationMs: 3000 },
        ] as ConversationTurn[],
      },
      dataB: {
        detail: { id: "b" } as SessionDetail,
        metrics: null,
        turns: [{ turnIndex: 0, durationMs: 2000 }] as ConversationTurn[],
      },
      waveA: [50, 80],
      waveB: [40],
      timelineA: [25, 75],
      timelineB: [100],
    });
    const wrapper = mount(hostFor(ComparisonCharts, comp));
    const titles = (selector: string) =>
      wrapper.findAll(selector).map((el) => el.attributes("title"));
    expect(titles(".waveform-bar-a")).toEqual(["Turn 0", "Turn 1"]);
    expect(titles(".waveform-bar-b")).toEqual(["Turn 0"]);
    expect(titles(".mini-tl-block")).toEqual(["Turn 0: 1s", "Turn 1: 3s", "Turn 0: 2s"]);
  });

  it("shows empty state when waveA/waveB are empty", () => {
    const comp = makeCompStub({ compared: true });
    const wrapper = mount(hostFor(ComparisonCharts, comp));
    expect(wrapper.text()).toContain("No turns");
  });
});
