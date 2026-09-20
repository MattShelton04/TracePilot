import { enableAutoUnmount, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nextTick } from "vue";
import UsageBreakdownBars from "../UsageBreakdownBars.vue";
import UsageInsightBar from "../UsageInsightBar.vue";
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

describe("UsageInsightBar", () => {
  const insights = [
    { id: "unused", text: "6 enabled skills unused in 90 days", tone: "warning" as const },
    { id: "missing", text: "2 skills are not installed here", tone: "accent" as const },
  ];

  const mountBar = (props: Record<string, unknown> = {}) =>
    mount(UsageInsightBar, { props: { insights, storageKey: "test:insights", ...props } });

  it("renders nothing when there is nothing worth saying", () => {
    expect(mountBar({ insights: [] }).find(".insight").exists()).toBe(false);
  });

  it("hands the filter decision back to the caller rather than acting itself", async () => {
    const wrapper = mountBar();
    await wrapper.get(".insight__action").trigger("click");
    expect(wrapper.emitted("act")).toEqual([["unused"]]);
  });

  it("dismisses one insight without hiding the others", async () => {
    const wrapper = mountBar();
    await wrapper.get(".insight__dismiss").trigger("click");
    const remaining = wrapper.findAll(".insight");
    expect(remaining).toHaveLength(1);
    expect(remaining[0].text()).toContain("not installed here");
  });

  it("remembers a dismissal across mounts, per insight", async () => {
    const first = mountBar();
    await first.get(".insight__dismiss").trigger("click");
    expect(JSON.parse(localStorage.getItem("test:insights")!)).toEqual(["unused"]);

    const second = mountBar();
    await nextTick();
    expect(second.findAll(".insight")).toHaveLength(1);
  });

  it("renders every insight when stored dismissals are unreadable", async () => {
    localStorage.setItem("test:insights", "not json");
    const wrapper = mountBar();
    await nextTick();
    expect(wrapper.findAll(".insight")).toHaveLength(2);
  });

  it("labels each dismiss button with what it hides", () => {
    expect(mountBar().get(".insight__dismiss").attributes("aria-label")).toBe(
      "Dismiss: 6 enabled skills unused in 90 days",
    );
  });
});
