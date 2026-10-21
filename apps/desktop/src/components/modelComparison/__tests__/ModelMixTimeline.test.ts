import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { defineComponent, h, provide, reactive } from "vue";
import type { ModelComparisonContext, ModelRow } from "@/composables/useModelComparison";
import { ModelComparisonKey } from "@/composables/useModelComparison";
import ModelMixTimeline from "../charts/ModelMixTimeline.vue";

const row = {
  id: "copilot:alpha",
  label: "alpha",
  model: "alpha",
  source: "copilot",
  color: "var(--chart-info)",
  tokens: 150,
  usdEquivalent: 1,
  billedInAiCredits: true,
} as ModelRow;

const usage = (date: string, inputTokens: number) => ({
  date,
  model: "alpha",
  source: "copilot" as const,
  inputTokens,
  outputTokens: 0,
});

function mountTimeline(dateRange: { fromDate?: string; toDate?: string }, days: string[]) {
  const ctx = reactive({
    store: { dateRange },
    data: { modelUsageByDay: days.map((date) => usage(date, 50)) },
    modelRows: [row],
  }) as unknown as ModelComparisonContext;
  const Host = defineComponent({
    setup() {
      provide(ModelComparisonKey, ctx);
      return () => h(ModelMixTimeline);
    },
  });
  return mount(Host);
}

/** One transparent hit target per bucket. */
const bucketCount = (wrapper: ReturnType<typeof mount>) =>
  wrapper.findAll('rect[fill="transparent"]').length;

describe("ModelMixTimeline", () => {
  it("draws every day of the selected range, quiet ones included", () => {
    const wrapper = mountTimeline({ fromDate: "2026-10-01", toDate: "2026-10-21" }, [
      "2026-10-07",
      "2026-10-16",
    ]);
    expect(bucketCount(wrapper)).toBe(21);
    expect(wrapper.text()).toContain("Daily totals for the selected range.");
  });

  it("keeps All time to the active days", () => {
    const wrapper = mountTimeline({}, ["2026-10-07", "2026-10-16"]);
    expect(bucketCount(wrapper)).toBe(10);
  });

  it("still needs two active days, however long the range", () => {
    const wrapper = mountTimeline({ fromDate: "2026-10-15", toDate: "2026-10-21" }, ["2026-10-20"]);
    expect(bucketCount(wrapper)).toBe(0);
    expect(wrapper.text()).toContain("Needs activity on at least 2 days to show a trend.");
  });
});
