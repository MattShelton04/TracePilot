import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import MetricsKpis from "@/components/metrics/MetricsKpis.vue";
import type { MetricsCostSummary } from "@/composables/useMetricsCost";
import type { MetricsTokenBreakdown } from "@/utils/metricsTokenBreakdown";

const cost: MetricsCostSummary = {
  value: "$1.00",
  usd: 1,
  credits: null,
  basis: "Observed",
  estimate: false,
  partial: false,
  lowerBound: false,
  coverage: "All model calls",
  unattributed: null,
};

const tokens: MetricsTokenBreakdown = {
  input: 1_000,
  output: 200,
  cacheRead: 600,
  cacheWrite: 100,
  uncached: 300,
  notCached: 400,
  reasoning: null,
  total: 1_200,
  cacheRatio: 0.6,
  inconsistent: false,
};

const HOUR = 3_600_000;

function modelTimeNote(apiMs: number, wallMs: number) {
  const wrapper = mount(MetricsKpis, {
    props: { cost, tokens, requests: 4, turns: 2, apiMs, wallMs },
  });
  const card = wrapper.findAll(".kpi").find((kpi) => kpi.text().includes("Model time"));
  return card?.find(".kpi-note").text();
}

describe("MetricsKpis model time", () => {
  it("never calls a tiny but real share of wall time 0%", () => {
    // 12.5s of model time over a 34-hour session is about 0.01%.
    expect(modelTimeNote(12_500, 34 * HOUR)).toBe("<0.1% of 34h 0m wall time");
  });

  it("keeps one decimal once the share reaches 0.1%", () => {
    expect(modelTimeNote(0.1 * HOUR, 100 * HOUR)).toBe("0.1% of 100h 0m wall time");
    expect(modelTimeNote(HOUR, 4 * HOUR)).toBe("25% of 4h 0m wall time");
  });
});
