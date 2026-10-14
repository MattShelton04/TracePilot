import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import type { DayRow, DaySeries } from "@/utils/analyticsDashboard";
import AnalyticsDayChart from "../AnalyticsDayChart.vue";

const series: DaySeries[] = [
  { key: "copilot", label: "Copilot", color: "red" },
  { key: "claudeCode", label: "Claude Code", color: "blue" },
];

function day(date: string, values: number[]): DayRow {
  return { from: date, to: date, values, runs: 0, errors: 0, rateLimits: 0 };
}

/** The flex-grow factors of each column's visible segments, bottom first. */
function segmentGrowth(wrapper: ReturnType<typeof mount>): number[][] {
  return wrapper.findAll(".day-chart__stack").map((stack) =>
    stack
      .findAll("i")
      .filter((segment) => !segment.attributes("style")?.includes("display: none"))
      .map((segment) => Number((segment.element as HTMLElement).style.flexGrow)),
  );
}

describe("AnalyticsDayChart", () => {
  it("fills each bar's stack when the column totals less than 1", () => {
    // A stack is sized to its column's total; its segments share that height.
    // Flex items whose grow factors sum below 1 take only that fraction of the
    // free space, so a $0.60 day drew just 60% of its bar. The factors must
    // add up to the whole stack, keeping each series' share.
    const wrapper = mount(AnalyticsDayChart, {
      props: {
        series,
        rows: [
          day("2026-10-01", [0.36, 0.24]),
          day("2026-10-02", [0.31, 0]),
          day("2026-10-03", [3, 1]),
        ],
        format: String,
        label: "Cost per day",
      },
    });
    const columns = segmentGrowth(wrapper);
    expect(columns).toHaveLength(3);
    for (const grow of columns) {
      expect(grow.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    }
    expect(columns[0][0] / columns[0][1]).toBeCloseTo(0.36 / 0.24, 9);
    expect(columns[1]).toEqual([1]);
    expect(columns[2]).toEqual([0.75, 0.25]);
  });

  it("puts each hover dot on its stacked line in lines mode", async () => {
    // The busiest day totals 4, so the axis tops out at 4: Copilot's line sits
    // at 50% of the plot and Claude Code's, stacked on it, at 100%.
    const wrapper = mount(AnalyticsDayChart, {
      props: {
        series,
        rows: [day("2026-10-01", [1, 0]), day("2026-10-02", [2, 2])],
        mode: "lines",
        format: String,
        label: "Cost per day",
      },
    });
    await wrapper.get('[role="img"]').trigger("keydown", { key: "End" });
    const tops = wrapper.findAll(".day-chart__dot").map((dot) => dot.attributes("style"));
    expect(tops).toHaveLength(2);
    expect(tops[0]).toContain("top: 50%");
    expect(tops[1]).toContain("top: 0%");

    // A series with nothing on the day gets no dot.
    await wrapper.get('[role="img"]').trigger("keydown", { key: "Home" });
    const first = wrapper.findAll(".day-chart__dot");
    expect(first).toHaveLength(1);
    expect(first[0].attributes("style")).toContain("top: 75%");
  });
});
