import { setupPinia } from "@tracepilot/test-utils";
import type { ShutdownMetrics } from "@tracepilot/types";
import { formatCost, StatCard } from "@tracepilot/ui";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { computed } from "vue";
import { useMetricsTabData } from "@/composables/useMetricsTabData";
import { usePreferencesStore } from "@/stores/preferences";
import { sessionCostEstimate } from "@/utils/sourceCost";
import MetricsStatCards from "../MetricsStatCards.vue";

describe("MetricsStatCards direct API fallback", () => {
  beforeEach(() => setupPinia());
  it.each([null, 0, 1.5])("distinguishes unavailable from recorded cost %s", (cost) => {
    const wrapper = mount(MetricsStatCards, {
      props: {
        metrics: {},
        totalRequests: 0,
        copilotCost: 0,
        totalWholesaleCost: cost,
        totalTokens: null,
        aiCreditUsage: { credits: null, usdEquivalent: null, source: "unavailable" },
      },
    });
    const card = wrapper
      .findAllComponents(StatCard)
      .find((item) => item.props("label") === "Direct API Estimate");
    expect(card?.props("value")).toBe(cost == null ? "—" : formatCost(cost));
  });

  it.each([
    false,
    true,
  ])("keeps headline credits unavailable with backend-empty or observed-model-only data (observed model: %s)", (withObservedModel) => {
    const metrics: ShutdownMetrics = {
      totalPremiumRequests: 3,
      modelMetrics: withObservedModel
        ? {
            model: { totalNanoAiu: 1_000_000_000, usage: { inputTokens: 0, outputTokens: 0 } },
          }
        : {},
    };
    const data = useMetricsTabData(
      computed(() => metrics),
      usePreferencesStore(),
    );
    const wrapper = mount(MetricsStatCards, {
      props: {
        metrics,
        totalRequests: data.totalRequests.value,
        copilotCost: data.copilotCost.value,
        totalWholesaleCost: data.totalWholesaleCost.value,
        totalTokens: data.tokenBreakdown.value.total,
        aiCreditUsage: data.aiCreditUsage.value,
      },
    });
    const cards = wrapper.findAllComponents(StatCard);
    const card = (label: string) => cards.find((item) => item.props("label") === label);
    expect(card("Cost")?.props("value")).toBe("—");
    expect(card("AI Credits")?.props("value")).toBe("—");
    expect(card("Total Tokens")?.props("value")).toBe(withObservedModel ? "0" : "—");
    expect(card("Legacy Premium Requests")?.props("value")).toBe("3.0");
    expect(card("Direct API Estimate")?.props("value")).toBe("—");
    if (withObservedModel) expect(data.modelEntries.value[0]?.aiCredits).toBe(1);
  });
});

describe("MetricsStatCards source cost", () => {
  it("shows the labelled USD estimate and partial coverage instead of AI Credits", () => {
    const metrics: ShutdownMetrics = {
      totalApiDurationMs: 48_000,
      costAmount: 0.5,
      costUnit: "usd",
      costBasis: "tracepilotEstimate",
      coverage: { partial: true, snapshotLine: 9, recordedCalls: 2, tailCalls: 1 },
    };
    const wrapper = mount(MetricsStatCards, {
      props: {
        metrics,
        totalRequests: 2,
        copilotCost: 0,
        totalWholesaleCost: null,
        totalTokens: 300,
        aiCreditUsage: { credits: null, usdEquivalent: null, source: "unavailable" },
        sourceCost: sessionCostEstimate("claudeCode", metrics),
      },
    });
    const labels = wrapper.findAllComponents(StatCard).map((card) => card.props("label"));
    expect(labels).toEqual(["Est. Cost (USD)", "Total Tokens", "Recorded Requests", "API Time"]);
    const cost = wrapper.findAllComponents(StatCard)[0];
    expect(cost.props("value")).toBe("$0.50");
    expect(cost.props("trend")).toBe("TracePilot estimate");
    const legend = wrapper.get('[data-testid="source-cost-legend"]').text();
    expect(legend).toContain("Partial");
    expect(legend).toContain("Last cost snapshot plus 1 call it does not cover, at API rates.");
    expect(wrapper.text()).not.toMatch(/AI Credits|Premium|Legacy/);
  });

  it("says where the API duration comes from", () => {
    const tooltip = (snapshotLine: number | null) => {
      const metrics: ShutdownMetrics = {
        totalApiDurationMs: 3_000,
        costUnit: "usd",
        coverage: { partial: true, snapshotLine, recordedCalls: 2, tailCalls: 2 },
      };
      const wrapper = mount(MetricsStatCards, {
        props: {
          metrics,
          totalRequests: 2,
          copilotCost: 0,
          totalWholesaleCost: null,
          totalTokens: 300,
          aiCreditUsage: { credits: null, usdEquivalent: null, source: "unavailable" },
          sourceCost: sessionCostEstimate("claudeCode", metrics),
        },
      });
      const card = wrapper
        .findAllComponents(StatCard)
        .find((item) => item.props("label") === "API Time");
      expect(card?.props("value")).toBe("3s");
      return card?.props("tooltip");
    };
    expect(tooltip(9)).toContain("Reported with the last cost snapshot.");
    expect(tooltip(null)).toContain("Estimated from transcript timestamps.");
    expect(tooltip(null)).toContain("longer than the session span");
  });

  it("labels totals from a usage checkpoint and the credits no model row covers", () => {
    const legend = (metrics: ShutdownMetrics) => {
      const data = useMetricsTabData(
        computed(() => metrics),
        usePreferencesStore(),
      );
      const wrapper = mount(MetricsStatCards, {
        props: {
          metrics,
          totalRequests: data.totalRequests.value,
          copilotCost: data.copilotCost.value,
          totalWholesaleCost: data.totalWholesaleCost.value,
          totalTokens: data.tokenBreakdown.value.total,
          aiCreditUsage: data.aiCreditUsage.value,
        },
      });
      const card = wrapper
        .findAllComponents(StatCard)
        .find((item) => item.props("label") === "AI Credits");
      return { credits: card?.props("value"), wrapper };
    };
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

    const running = legend({
      totalNanoAiu: 707_673_600,
      totalPremiumRequests: 2,
      metricsTimestamp: "2026-10-04T01:40:14.141Z",
      sessionSegments: [segment],
      modelMetrics: model,
    });
    expect(running.credits).toBe("0.708 AIC");
    expect(running.wrapper.find('[data-testid="usage-checkpoint"]').exists()).toBe(true);
    expect(running.wrapper.find('[data-testid="unattributed-credits"]').text()).toContain(
      "0.416 AIC since the last shutdown not yet attributed to a model",
    );
    expect(running.wrapper.text()).not.toContain("Shutdown ");

    const ended = legend({
      totalNanoAiu: 291_646_800,
      metricsTimestamp: "2026-10-04T01:39:48.905Z",
      sessionSegments: [segment],
      modelMetrics: model,
    });
    expect(ended.wrapper.find('[data-testid="usage-checkpoint"]').exists()).toBe(false);
    expect(ended.wrapper.text()).toContain("Shutdown ");
  });
});
