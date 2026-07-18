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
  events: [
    {
      turn: 1,
      timestamp: "2026-01-01T00:00:00Z",
      kind: "userMessage",
      label: "User message",
      preview: "hello",
    },
  ],
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
    expect(wrapper.findAll(".context-chart__anchor")).toHaveLength(1);
    expect(wrapper.text()).toContain("System prompt");
    expect(wrapper.text()).toContain("Conversation");
    expect(
      wrapper.findAll(".context-chart__legend .context-chart__button")[2].attributes("aria-label"),
    ).toContain("Accumulated messages, reasoning, tool arguments, and returned tool results.");
    expect(wrapper.text()).not.toContain("Session gaps balanced");
    expect(wrapper.find(".context-chart__tooltip").exists()).toBe(false);
    const turnTicks = wrapper
      .findAll(".context-chart__axes text")
      .filter((node) => ["1", "2"].includes(node.text()));
    expect(turnTicks).toHaveLength(2);
  });

  it("toggles layers without mutating timeline data", async () => {
    const wrapper = mount(ContextWindowChart, { props: { timeline } });
    const firstToggle = wrapper.find(".context-chart__legend .context-chart__button");
    await firstToggle.trigger("click");
    expect(firstToggle.attributes("aria-pressed")).toBe("false");
    expect(timeline.points[0].systemTokens).toBe(10);
  });

  it("shows an unclipped hover-only layer explanation and dismisses it on click", async () => {
    const wrapper = mount(ContextWindowChart, {
      props: { timeline },
      attachTo: document.body,
    });
    const firstToggle = wrapper.find(".context-chart__legend .context-chart__button");
    Object.defineProperty(firstToggle.element, "getBoundingClientRect", {
      value: () => ({ left: 20, bottom: 40, width: 100 }),
    });

    await firstToggle.trigger("mouseenter");
    expect(document.body.querySelector(".context-chart__layer-tooltip")?.textContent).toContain(
      "Persistent Copilot instructions",
    );

    await firstToggle.trigger("click");
    expect(document.body.querySelector(".context-chart__layer-tooltip")).toBeNull();
    wrapper.unmount();
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
      value: () => ({ left: 0, top: 0, width: 900, height: 390 }),
    });
    await svg.trigger("mousemove", { clientX: 400, clientY: 200 });
    expect(wrapper.find(".context-chart__tooltip").text()).toContain("Turn 1");
    expect(wrapper.find(".context-chart__tooltip").attributes("transform")).toMatch(
      /^translate\(410 15[12]\./,
    );
    await svg.trigger("click", { clientX: 66, clientY: 200 });
    expect(wrapper.emitted("selectPoint")?.[0]).toEqual([timeline.points[0]]);
  });

  it("keeps the selected turn tooltip visible while another turn is hovered", async () => {
    const wrapper = mount(ContextWindowChart, {
      props: { timeline, selectedPoint: timeline.points[0] },
    });
    const svg = wrapper.find("svg");
    Object.defineProperty(svg.element, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, width: 900, height: 390 }),
    });

    await svg.trigger("mousemove", { clientX: 830, clientY: 200 });

    expect(wrapper.find(".context-chart__tooltip").text()).toContain("Turn 1");
  });

  it("clears a locked turn when the same graph point is clicked again", async () => {
    const wrapper = mount(ContextWindowChart, {
      props: { timeline, selectedPoint: timeline.points[0] },
    });
    const svg = wrapper.find("svg");
    Object.defineProperty(svg.element, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, width: 900, height: 390 }),
    });

    await svg.trigger("click", { clientX: 66, clientY: 200 });

    expect(wrapper.emitted("clearSelection")).toHaveLength(1);
  });

  it("exposes zoom and pan controls", async () => {
    const wrapper = mount(ContextWindowChart, { props: { timeline } });
    await wrapper.find('button[aria-label="Zoom in"]').trigger("click");
    expect(wrapper.text()).toContain("1.5×");
    expect(wrapper.text()).toContain("Viewing");
  });

  it("emits selectable special points and message overlays", async () => {
    const wrapper = mount(ContextWindowChart, { props: { timeline } });
    const specialPoints = wrapper.findAll('[aria-label^="Select"]');
    expect(specialPoints.length).toBeGreaterThan(0);
    await specialPoints[0].trigger("click");
    expect(wrapper.emitted("selectPoint")).toBeTruthy();
    await wrapper.find('[aria-label="User message at turn 1"]').trigger("click");
    expect(wrapper.emitted("selectEvent")?.[0]).toEqual([timeline.events[0]]);
  });
});
