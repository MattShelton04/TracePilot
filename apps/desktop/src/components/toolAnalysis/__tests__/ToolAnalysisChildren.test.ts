import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";

vi.mock("@tracepilot/ui", () => {
  const passthrough = (name: string) =>
    defineComponent({
      name,
      inheritAttrs: false,
      setup(_, { slots, attrs }) {
        return () => h("div", { class: name.toLowerCase(), ...attrs }, slots.default?.());
      },
    });
  return {
    PageShell: passthrough("PageShell"),
    LoadingOverlay: passthrough("LoadingOverlay"),
    ErrorState: passthrough("ErrorState"),
    StatCard: passthrough("StatCard"),
    ChartTooltip: passthrough("ChartTooltip"),
    getChartColors: () => ({
      primary: "#000",
      secondary: "#000",
      success: "#0a0",
      warning: "#aa0",
      danger: "#a00",
      info: "#00a",
      cyan: "#0aa",
      orange: "#a50",
      lime: "#5a0",
    }),
    getDesignToken: () => "#000",
    getAgentColors: () => ({}),
    getSemanticColors: () => ({}),
    getStatusColors: () => ({}),
    useChartTooltip: () => ({
      tooltip: {
        visible: false,
        pinned: false,
        x: 0,
        y: 0,
        content: "",
        chartId: "",
        highlightIndex: -1,
      },
      positionTooltip: vi.fn(),
      dismissTooltip: vi.fn(),
      onChartMouseMove: vi.fn(),
      onChartClick: vi.fn(),
      onBarMouseEnter: vi.fn(),
      findNearestIndex: (values: number[], target: number) => {
        if (values.length === 0) return -1;
        let bestIdx = 0;
        let bestDist = Math.abs(target - values[0]);
        for (let i = 1; i < values.length; i++) {
          const d = Math.abs(target - values[i]);
          if (d < bestDist) {
            bestDist = d;
            bestIdx = i;
          }
        }
        return bestIdx;
      },
    }),
  };
});

import type { ToolUsageEntry } from "@tracepilot/types";
import ToolFrequencyList from "../ToolFrequencyList.vue";
import ToolSuccessFailureChart from "../ToolSuccessFailureChart.vue";
import ToolUsageHeatmap from "../ToolUsageHeatmap.vue";
import ToolUsageList from "../ToolUsageList.vue";

const tools: ToolUsageEntry[] = [
  {
    name: "powershell",
    callCount: 10,
    successRate: 0.8,
    avgDurationMs: 1200,
    totalDurationMs: 12000,
  },
  {
    name: "edit",
    callCount: 4,
    successRate: 1.0,
    avgDurationMs: 200,
    totalDurationMs: 800,
  },
];

describe("ToolUsageList", () => {
  it("renders a row per tool with formatted invocation counts", () => {
    const wrapper = mount(ToolUsageList, { props: { tools } });
    expect(wrapper.find(".tool-usage-list").exists()).toBe(true);
    const rows = wrapper.findAll("tbody tr");
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain("powershell");
    expect(rows[0].text()).toContain("10");
    wrapper.unmount();
  });
});

describe("ToolSuccessFailureChart", () => {
  it("renders an SVG with one success rect per tool", () => {
    const wrapper = mount(ToolSuccessFailureChart, {
      props: { tools, maxInvocations: 10 },
    });
    expect(wrapper.find(".tool-success-failure").exists()).toBe(true);
    const svg = wrapper.find("svg");
    expect(svg.exists()).toBe(true);
    // 2 success rects + 1 failure rect (only powershell has failures) + 1 overlay
    expect(svg.findAll("rect").length).toBeGreaterThanOrEqual(3);
    expect(wrapper.text()).toContain("powershell");
    expect(wrapper.text()).toContain("Success");
  });

  it("renders nothing when there are no tools", () => {
    const wrapper = mount(ToolSuccessFailureChart, {
      props: { tools: [], maxInvocations: 1 },
    });
    expect(wrapper.find("svg").exists()).toBe(false);
  });
});

describe("ToolFrequencyList", () => {
  it("renders a frequency row per tool sized against maxInvocations", () => {
    const wrapper = mount(ToolFrequencyList, {
      props: { tools, maxInvocations: 10 },
    });
    expect(wrapper.find(".tool-frequency").exists()).toBe(true);
    const rows = wrapper.findAll(".tool-frequency__row");
    expect(rows).toHaveLength(2);
    const firstBar = rows[0].find<HTMLElement>(".tool-frequency__bar").element;
    expect(firstBar.style.width).toBe("100%");
    const secondBar = rows[1].find<HTMLElement>(".tool-frequency__bar").element;
    expect(secondBar.style.width).toBe("40%");
  });
});

describe("ToolUsageHeatmap", () => {
  it("renders a 7×24 grid plus an hour-label row from UTC heatmap entries", () => {
    const wrapper = mount(ToolUsageHeatmap, {
      props: {
        entries: [
          { day: 0, hour: 0, count: 3 },
          { day: 1, hour: 12, count: 1 },
        ],
      },
    });
    expect(wrapper.find(".tool-heatmap").exists()).toBe(true);
    // 7 day rows + 1 hour-label row
    expect(wrapper.findAll(".tool-heatmap__row")).toHaveLength(8);
    // 5 legend swatches
    expect(wrapper.findAll(".tool-heatmap__cell--legend")).toHaveLength(5);
    // Each day row has 24 cells (plus 5 legend cells)
    const cells = wrapper.findAll(".tool-heatmap__cell");
    expect(cells.length).toBe(7 * 24 + 5);
  });

  it("renders without crashing when given an empty heatmap", () => {
    const wrapper = mount(ToolUsageHeatmap, { props: { entries: [] } });
    expect(wrapper.find(".tool-heatmap").exists()).toBe(true);
  });
});
