import type { ContextTimeline } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ContextWindowChart from "@/components/context/ContextWindowChart.vue";

const timeline: ContextTimeline = {
  turnCount: 2,
  observedPointCount: 1,
  estimatedPointCount: 2,
  compactionStartCount: 1,
  compactionCompleteCount: 1,
  pairedCompactionCount: 1,
  methodology: "test",
  points: [
    {
      turn: 1,
      phase: "turn",
      timestamp: null,
      systemTokens: 10,
      toolDefinitionTokens: 20,
      conversationTokens: 70,
      totalTokens: 100,
      source: "estimated",
    },
    {
      turn: 2,
      phase: "preCompaction",
      timestamp: null,
      systemTokens: 10,
      toolDefinitionTokens: 20,
      conversationTokens: 120,
      totalTokens: 150,
      source: "observed",
    },
    {
      turn: 2,
      phase: "postCompaction",
      timestamp: null,
      systemTokens: 10,
      toolDefinitionTokens: 20,
      conversationTokens: 10,
      totalTokens: 40,
      source: "estimated",
    },
  ],
  compactions: [
    {
      startTurn: 2,
      completeTurn: 2,
      timestamp: null,
      success: true,
      checkpointNumber: 1,
      beforeTokens: 150,
      afterTokens: 40,
      tokensRemoved: 110,
      afterSource: "estimated",
      summaryTokens: 10,
    },
  ],
  topToolCalls: [],
  toolTypes: [],
};

describe("ContextWindowChart", () => {
  it("renders all context layers and observed anchors", () => {
    const wrapper = mount(ContextWindowChart, { props: { timeline } });
    expect(wrapper.findAll(".context-chart__area")).toHaveLength(3);
    expect(wrapper.findAll(".context-chart__anchor")).toHaveLength(3);
    expect(wrapper.text()).toContain("System prompt");
    expect(wrapper.text()).toContain("Conversation");
  });

  it("toggles layers without mutating timeline data", async () => {
    const wrapper = mount(ContextWindowChart, { props: { timeline } });
    const firstToggle = wrapper.find(".context-chart__legend .context-chart__button");
    await firstToggle.trigger("click");
    expect(firstToggle.attributes("aria-pressed")).toBe("false");
    expect(timeline.points[0].systemTokens).toBe(10);
  });

  it("emits a compaction selection from its marker", async () => {
    const wrapper = mount(ContextWindowChart, { props: { timeline } });
    await wrapper.find(".context-chart__marker-hit").trigger("click");
    expect(wrapper.emitted("selectCompaction")?.[0]).toEqual([timeline.compactions[0]]);
  });

  it("previews a turn on hover and locks it on click", async () => {
    const wrapper = mount(ContextWindowChart, { props: { timeline } });
    const svg = wrapper.find("svg");
    Object.defineProperty(svg.element, "getBoundingClientRect", {
      value: () => ({ left: 0, width: 900 }),
    });
    await svg.trigger("mousemove", { clientX: 66 });
    expect(wrapper.find(".context-chart__tooltip").text()).toContain("Turn 1");
    expect(wrapper.find(".context-chart__tooltip").text()).toContain("Click to lock");
    await svg.trigger("click", { clientX: 66 });
    expect(wrapper.emitted("selectPoint")?.[0]).toEqual([timeline.points[0]]);
  });

  it("exposes zoom and pan controls", async () => {
    const wrapper = mount(ContextWindowChart, { props: { timeline } });
    await wrapper.find('button[aria-label="Zoom in"]').trigger("click");
    expect(wrapper.text()).toContain("1.6×");
    expect(wrapper.find('.context-chart__pan input[type="range"]').exists()).toBe(true);
  });
});
