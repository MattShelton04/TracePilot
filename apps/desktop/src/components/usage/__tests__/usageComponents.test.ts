import { enableAutoUnmount, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import UsageBreakdownBars from "../UsageBreakdownBars.vue";
import UsageDistribution from "../UsageDistribution.vue";
import UsageInsightBar from "../UsageInsightBar.vue";
import UsageSparkline from "../UsageSparkline.vue";

enableAutoUnmount(afterEach);
beforeEach(() => localStorage.clear());

const EMPTY = { count: 0, min: null, p25: null, p50: null, p75: null, p90: null, max: null };

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
  });

  it("counts hidden rows past the limit", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ key: `${i}`, label: `l${i}`, value: 1 }));
    const wrapper = mount(UsageBreakdownBars, { props: { rows: many, limit: 2 } });
    expect(wrapper.text()).toContain("+3 more");
  });

  it("falls back to the empty text", () => {
    const wrapper = mount(UsageBreakdownBars, { props: { rows: [], emptyText: "Not recorded" } });
    expect(wrapper.text()).toBe("Not recorded");
  });
});

describe("UsageDistribution", () => {
  it("states the denominator when only some runs reported the metric", () => {
    const wrapper = mount(UsageDistribution, {
      props: {
        title: "Duration",
        distribution: { ...EMPTY, count: 27, p50: 1_000 },
        runs: 100,
        format: "duration",
      },
    });
    expect(wrapper.text()).toContain("27 of 100 runs reported it");
  });

  it("says so when no run reported the metric, and shows dashes", () => {
    const wrapper = mount(UsageDistribution, {
      props: { title: "Tokens", distribution: EMPTY, runs: 10, format: "number" },
    });
    expect(wrapper.text()).toContain("no runs reported this metric");
    expect(wrapper.findAll("dd").every((cell) => cell.text() === "—")).toBe(true);
  });
});

describe("UsageInsightBar", () => {
  const insights = [
    { id: "a", tone: "info" as const, text: "first", actionable: true },
    { id: "b", tone: "warning" as const, text: "second" },
  ];

  it("emits only for actionable insights", async () => {
    const wrapper = mount(UsageInsightBar, { props: { insights, storageKey: "test-bar" } });
    expect(wrapper.findAll(".insight__action")).toHaveLength(1);
    await wrapper.get(".insight__action").trigger("click");
    expect(wrapper.emitted("select")?.[0]).toEqual(["a"]);
  });

  it("stays dismissed once dismissed", async () => {
    const wrapper = mount(UsageInsightBar, { props: { insights, storageKey: "test-bar" } });
    await wrapper.get(".insight-bar__dismiss").trigger("click");
    expect(wrapper.find(".insight-bar").exists()).toBe(false);

    const remounted = mount(UsageInsightBar, { props: { insights, storageKey: "test-bar" } });
    expect(remounted.find(".insight-bar").exists()).toBe(false);
  });

  it("renders nothing without insights", () => {
    const wrapper = mount(UsageInsightBar, { props: { insights: [], storageKey: "empty-bar" } });
    expect(wrapper.find(".insight-bar").exists()).toBe(false);
  });
});
