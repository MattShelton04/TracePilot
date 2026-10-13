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

describe("AnalyticsDayChart", () => {
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
