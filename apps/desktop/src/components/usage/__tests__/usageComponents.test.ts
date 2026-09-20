import { enableAutoUnmount, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import UsageBreakdownBars from "../UsageBreakdownBars.vue";
import UsageMetricDistribution from "../UsageMetricDistribution.vue";
import UsageSparkline from "../UsageSparkline.vue";
import UsageStackedBar from "../UsageStackedBar.vue";

enableAutoUnmount(afterEach);
beforeEach(() => localStorage.clear());

describe("UsageSparkline", () => {
  it("renders nothing without data", () => {
    const wrapper = mount(UsageSparkline, { props: { values: [], label: "runs" } });
    expect(wrapper.find("svg").exists()).toBe(false);
  });

  it("draws a flat series mid-height instead of dividing by zero", () => {
    const wrapper = mount(UsageSparkline, { props: { values: [0, 0, 0], label: "runs" } });
    const line = wrapper.get(".usage-sparkline__line").attributes("d");
    expect(line).toContain("11.0");
    expect(line).not.toContain("NaN");
  });

  it("labels itself for screen readers", () => {
    const wrapper = mount(UsageSparkline, { props: { values: [1, 5], label: "Daily runs" } });
    expect(wrapper.get("svg").attributes("aria-label")).toBe("Daily runs");
  });
});

describe("UsageBreakdownBars", () => {
  const rows = [
    { key: "a", label: "alpha", value: 75 },
    { key: "b", label: "beta", value: 25 },
  ];

  it("shows each row's share of the total", () => {
    const wrapper = mount(UsageBreakdownBars, { props: { rows, total: 100 } });
    expect(wrapper.text()).toContain("75%");
    expect(wrapper.text()).toContain("25%");
  });

  it("uses an explicit total rather than the sum when one is given", () => {
    const wrapper = mount(UsageBreakdownBars, { props: { rows, total: 200 } });
    expect(wrapper.text()).toContain("38%");
    expect(wrapper.text()).toContain("13%");
    expect(wrapper.findAll(".breakdown__fill")[0].attributes("style")).toContain("width: 37.5%");
  });

  it("lets readers reveal and collapse categories past the limit", async () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ key: `${i}`, label: `l${i}`, value: 1 }));
    const wrapper = mount(UsageBreakdownBars, { props: { rows: many, limit: 2 } });
    expect(wrapper.findAll(".breakdown__row")).toHaveLength(2);
    await wrapper.get("button").trigger("click");
    expect(wrapper.findAll(".breakdown__row")).toHaveLength(5);
    expect(wrapper.get("button").attributes("aria-expanded")).toBe("true");
    await wrapper.get("button").trigger("click");
    expect(wrapper.findAll(".breakdown__row")).toHaveLength(2);
  });

  it("falls back to the empty text", () => {
    const wrapper = mount(UsageBreakdownBars, { props: { rows: [], emptyText: "Not recorded" } });
    expect(wrapper.text()).toBe("Not recorded");
  });
});

describe("UsageMetricDistribution", () => {
  it("explains percentiles per recorded run and keeps missing bounds unknown", () => {
    const wrapper = mount(UsageMetricDistribution, {
      props: {
        title: "Tool calls per run",
        description: "Reported calls",
        runs: 100,
        data: { count: 27, min: 0, p25: 10, p50: 20, p75: 40, p90: 80, max: 120 },
        format: String,
      },
    });
    expect(wrapper.text()).toContain("Middle 50% of runs10 – 40");
    expect(wrapper.text()).toContain("90% of runs at or below80");
    expect(wrapper.text()).toContain("Based on 27 of 100 runs");
  });
});

describe("UsageStackedBar", () => {
  it("preserves small proportions rather than enlarging them", () => {
    const wrapper = mount(UsageStackedBar, {
      props: {
        total: 1000,
        segments: [
          { key: "complete", label: "Completed", value: 999 },
          { key: "failed", label: "Failed", value: 1 },
        ],
      },
    });
    expect(wrapper.findAll(".stacked__segment")[1].attributes("style")).toContain("width: 0.1%");
    expect(wrapper.text()).toContain("Failed10.1%");
  });
});
