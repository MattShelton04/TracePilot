import { setupPinia } from "@tracepilot/test-utils";
import type { ShutdownMetrics } from "@tracepilot/types";
import { formatCost, StatCard } from "@tracepilot/ui";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { computed } from "vue";
import { useMetricsTabData } from "@/composables/useMetricsTabData";
import { usePreferencesStore } from "@/stores/preferences";
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
    expect(card("AI Credits")?.props("value")).toBe("—");
    expect(card("Total Tokens")?.props("value")).toBe(withObservedModel ? "0" : "—");
    expect(card("Legacy Premium Requests")?.props("value")).toBe("3.0");
    expect(card("Direct API Estimate")?.props("value")).toBe("—");
    if (withObservedModel) expect(data.modelEntries.value[0]?.aiCredits).toBe(1);
  });
});
