import { setupPinia } from "@tracepilot/test-utils";
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { resetAnalyticsDashboardViews } from "@/composables/useAnalyticsDashboardViews";
import type { DayRow } from "@/utils/analyticsDashboard";
import CodeChangesPanel from "../CodeChangesPanel.vue";

/** `count` zero days from Jan 1, with `added` lines on the given day indices. */
function days(count: number, added: Record<number, number>): DayRow[] {
  return Array.from({ length: count }, (_, i) => {
    const day = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
    return {
      from: day,
      to: day,
      values: [added[i] ?? 0, 0],
      runs: 0,
      errors: 0,
      rateLimits: 0,
    };
  });
}

describe("CodeChangesPanel", () => {
  beforeEach(() => {
    setupPinia();
    resetAnalyticsDashboardViews();
  });

  it("names the busiest drawn column when days merge into bins", async () => {
    // 240 days draw as 2-day columns: Jan 11–12 (120) outgrows Feb 20 (100).
    const wrapper = mount(CodeChangesPanel, {
      props: { rows: days(240, { 10: 60, 11: 60, 50: 100 }), rangeText: "all time" },
    });
    await flushPromises();
    const text = wrapper.text();
    expect(text).toContain("Changes per 2 days");
    expect(text).toContain("Busiest Jan 11 – Jan 12 (+120 / −0)");
    expect(text).toContain("Average 73 lines per active day");
  });

  it("keeps single days when every day has its own column", async () => {
    const wrapper = mount(CodeChangesPanel, {
      props: { rows: days(30, { 10: 60, 11: 60, 20: 100 }), rangeText: "the past 30 days" },
    });
    await flushPromises();
    const text = wrapper.text();
    expect(text).toContain("Changes per day");
    expect(text).toContain("Busiest Jan 21 (+100 / −0)");
  });
});
