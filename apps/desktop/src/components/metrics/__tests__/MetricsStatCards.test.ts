import { formatCost, StatCard } from "@tracepilot/ui";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import MetricsStatCards from "../MetricsStatCards.vue";

describe("MetricsStatCards direct API fallback", () => {
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
});
