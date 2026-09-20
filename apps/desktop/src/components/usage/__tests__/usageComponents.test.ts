import { enableAutoUnmount, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import UsageBreakdownBars from "../UsageBreakdownBars.vue";
import UsageSparkline from "../UsageSparkline.vue";

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
