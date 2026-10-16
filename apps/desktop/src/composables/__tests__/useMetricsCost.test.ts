import { setupPinia } from "@tracepilot/test-utils";
import type { ShutdownMetrics } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { computed } from "vue";
import MetricsCost from "@/components/metrics/MetricsCost.vue";
import { useMetricsCost } from "@/composables/useMetricsCost";
import { useMetricsTabData } from "@/composables/useMetricsTabData";
import { usePreferencesStore } from "@/stores/preferences";

beforeEach(() => setupPinia());

function costOf(metrics: ShutdownMetrics, source: "copilot" | "claudeCode" = "copilot") {
  const prefs = usePreferencesStore();
  const metricsRef = computed(() => metrics);
  const data = useMetricsTabData(metricsRef, prefs);
  const { summary, split } = useMetricsCost({
    metrics: metricsRef,
    source,
    credits: source === "copilot",
    aiCreditUsage: data.aiCreditUsage,
    modelEntries: data.modelEntries,
    prefs,
  });
  const summaryValue = summary.value;
  if (!summaryValue) throw new Error("no summary");
  const wrapper = mount(MetricsCost, {
    props: { cost: summaryValue, split: split.value, models: [], credits: source === "copilot" },
  });
  return { summary: summaryValue, wrapper };
}

describe("useMetricsCost", () => {
  it("keeps unrecorded AI Credits unavailable", () => {
    const { summary } = costOf({ totalPremiumRequests: 3, modelMetrics: {} });
    expect(summary.value).toBe("—");
    expect(summary.basis).toBe("Not recorded");
  });

  it("shows a USD estimate with its basis and coverage for Claude Code", () => {
    const { summary, wrapper } = costOf(
      {
        costAmount: 0.5,
        costUnit: "usd",
        costBasis: "tracepilotEstimate",
        coverage: { partial: true, snapshotLine: 9, recordedCalls: 2, tailCalls: 1 },
      },
      "claudeCode",
    );
    expect(summary).toMatchObject({ value: "$0.50", basis: "TracePilot estimate", partial: true });
    expect(wrapper.text()).toContain("Partial");
    expect(wrapper.text()).toContain("Last cost snapshot plus 1 call it does not cover");
    expect(wrapper.text()).not.toMatch(/AI Credits|AIC/);
  });

  it("labels totals from a usage checkpoint and the credits no model row covers", () => {
    const segment = {
      startTimestamp: "2026-10-04T01:39:40.867Z",
      endTimestamp: "2026-10-04T01:39:48.905+00:00",
      tokens: 0,
      totalRequests: 1,
      premiumRequests: 1,
      apiDurationMs: 0,
      totalNanoAiu: 291_646_800,
    };
    const model = { "mai-code-1.1-flash": { totalNanoAiu: 291_646_800 } };
    const unattributed = (w: ReturnType<typeof mount>) =>
      w.find('[data-testid="unattributed-credits"]');

    const running = costOf({
      totalNanoAiu: 707_673_600,
      totalPremiumRequests: 2,
      metricsTimestamp: "2026-10-04T01:40:14.141Z",
      sessionSegments: [segment],
      modelMetrics: model,
    });
    expect(running.summary.credits).toBe("0.708 AIC");
    expect(running.summary.coverage).toContain("latest usage checkpoint");
    expect(unattributed(running.wrapper).text()).toBe(
      "0.416 AIC since the last shutdown not yet attributed to a model.",
    );

    const ended = costOf({
      totalNanoAiu: 291_646_800,
      metricsTimestamp: "2026-10-04T01:39:48.905Z",
      sessionSegments: [segment],
      modelMetrics: model,
    });
    expect(ended.summary.coverage).toContain("at the last shutdown");
    expect(unattributed(ended.wrapper).exists()).toBe(false);

    // Before the first shutdown, every credit is unattributed.
    const firstRun = costOf({
      totalNanoAiu: 291_646_800,
      metricsTimestamp: "2026-10-04T01:39:48.877Z",
    });
    expect(firstRun.summary.credits).toBe("0.292 AIC");
    expect(unattributed(firstRun.wrapper).text()).toBe("0.292 AIC not yet attributed to a model.");
  });
});
