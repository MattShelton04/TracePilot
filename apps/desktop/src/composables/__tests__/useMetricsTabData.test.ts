import { setupPinia } from "@tracepilot/test-utils";
import type { ShutdownMetrics } from "@tracepilot/types";
import { beforeEach, describe, expect, it } from "vitest";
import { computed } from "vue";
import { useMetricsTabData } from "@/composables/useMetricsTabData";
import { usePreferencesStore } from "@/stores/preferences";

describe("useMetricsTabData", () => {
  beforeEach(() => {
    setupPinia();
  });

  it("sorts models with equal token totals deterministically", () => {
    const data = { usage: { inputTokens: 10, outputTokens: 2 } };
    const result = useMetricsTabData(
      computed(() => ({ modelMetrics: { z: data, a: data } })),
      usePreferencesStore(),
    );
    expect(result.modelEntries.value.map((row) => row.name)).toEqual(["a", "z"]);
  });

  it("prefers observed session and model AIC over token estimates", () => {
    const metrics: ShutdownMetrics = {
      totalNanoAiu: 2_500_000_000,
      modelMetrics: {
        "gpt-5.5": {
          totalNanoAiu: 2_500_000_000,
          usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
        },
      },
    };
    const result = useMetricsTabData(
      computed(() => metrics),
      usePreferencesStore(),
    );

    expect(result.aiCreditUsage.value).toMatchObject({
      credits: 2.5,
      source: "observed",
    });
    expect(result.modelEntries.value[0]).toMatchObject({
      aiCredits: 2.5,
      aiCreditSource: "observed",
    });
  });

  it("leaves AIC unavailable for legacy sessions with no token telemetry", () => {
    const metrics: ShutdownMetrics = {
      totalPremiumRequests: 4,
      modelMetrics: {
        "legacy-model": {
          requests: { count: 2, cost: 4 },
        },
      },
    };
    const result = useMetricsTabData(
      computed(() => metrics),
      usePreferencesStore(),
    );

    expect(result.aiCreditUsage.value).toEqual({
      credits: null,
      usdEquivalent: null,
      source: "unavailable",
    });
    expect(result.modelEntries.value[0]?.aiCreditSource).toBe("unavailable");
    expect(result.copilotCost.value).toBeGreaterThan(0);
  });

  it("does not estimate session or model credits from incomplete token coverage", () => {
    const result = useMetricsTabData(
      computed(() => ({ modelMetrics: { "gpt-5.5": { usage: { inputTokens: 100 } } } })),
      usePreferencesStore(),
    );
    expect(result.tokenBreakdown.value.total).toBeNull();
    expect(result.aiCreditUsage.value).toMatchObject({ credits: null, source: "unavailable" });
    expect(result.modelEntries.value[0]).toMatchObject({
      aiCredits: null,
      aiCreditSource: "unavailable",
      directApiCost: null,
    });
    expect(result.totalWholesaleCost.value).toBeNull();
  });

  it("does not present a priced subtotal as the session-wide direct API estimate", () => {
    const complete = { usage: { inputTokens: 100, outputTokens: 20 } };
    for (const [name, unknown] of [
      ["gpt-5.4", { usage: { inputTokens: 10 } }],
      ["gpt-5.4", {}],
      ["unknown-model", complete],
    ] as const) {
      const result = useMetricsTabData(
        computed(() => ({ modelMetrics: { "gpt-5.5": complete, [name]: unknown } })),
        usePreferencesStore(),
      );
      expect(
        result.modelEntries.value.find((row) => row.name === "gpt-5.5")?.directApiCost,
      ).toBeGreaterThan(0);
      expect(result.modelEntries.value.find((row) => row.name === name)?.directApiCost).toBeNull();
      expect(result.totalWholesaleCost.value).toBeNull();
    }
  });

  it("preserves complete priced sums and recorded zero direct API estimates", () => {
    const prefs = usePreferencesStore();
    const result = useMetricsTabData(
      computed(() => ({
        modelMetrics: {
          "gpt-5.5": { usage: { inputTokens: 100, outputTokens: 20 } },
          "gpt-5.4": { usage: { inputTokens: 50, outputTokens: 10 } },
        },
      })),
      prefs,
    );
    expect(result.totalWholesaleCost.value).toBeCloseTo(
      (prefs.computeWholesaleCostBreakdown("gpt-5.5", 100, 0, 20).totalCost ?? 0) +
        (prefs.computeWholesaleCostBreakdown("gpt-5.4", 50, 0, 10).totalCost ?? 0),
    );
    const zero = useMetricsTabData(
      computed(() => ({
        modelMetrics: { "gpt-5.5": { usage: { inputTokens: 0, outputTokens: 0 } } },
      })),
      prefs,
    );
    expect(zero.modelEntries.value[0]?.directApiCost).toBe(0);
    expect(zero.totalWholesaleCost.value).toBe(0);
    expect(
      useMetricsTabData(
        computed(() => ({ modelMetrics: {} })),
        prefs,
      ).totalWholesaleCost.value,
    ).toBeNull();
  });

  it("preserves complete estimates alongside an unpriced model with explicit zero counts", () => {
    const prefs = usePreferencesStore();
    const result = useMetricsTabData(
      computed(() => ({
        modelMetrics: {
          "gpt-5.5": { usage: { inputTokens: 100, outputTokens: 20 } },
          unknown: { usage: { inputTokens: 0, outputTokens: 0 } },
        },
      })),
      prefs,
    );
    const zero = result.modelEntries.value.find((row) => row.name === "unknown");
    expect(zero).toMatchObject({ aiCredits: 0, directApiCost: 0 });
    expect(result.totalWholesaleCost.value).toBeCloseTo(
      prefs.computeWholesaleCostBreakdown("gpt-5.5", 100, 0, 20).totalCost ?? 0,
    );
    expect(result.aiCreditUsage.value).toMatchObject({ source: "estimated-token-usage" });
    expect(result.aiCreditUsage.value.credits).toBeGreaterThan(0);
  });

  it.each([
    false,
    true,
  ])("leaves the direct estimate unavailable for an observed charge with zero tokens (other usage: %s)", (withOtherUsage) => {
    const result = useMetricsTabData(
      computed(() => ({
        modelMetrics: {
          model: { totalNanoAiu: 1_000_000_000, usage: { inputTokens: 0, outputTokens: 0 } },
          ...(withOtherUsage
            ? { "gpt-5.5": { usage: { inputTokens: 100, outputTokens: 20 } } }
            : {}),
        },
      })),
      usePreferencesStore(),
    );
    expect(result.modelEntries.value.find((row) => row.name === "model")).toMatchObject({
      aiCredits: 1,
      aiCreditSource: "observed",
      directApiCost: null,
    });
    expect(result.totalWholesaleCost.value).toBeNull();
    expect(result.aiCreditUsage.value).toMatchObject({ credits: null, source: "unavailable" });
    if (withOtherUsage) {
      expect(
        result.modelEntries.value.find((row) => row.name === "gpt-5.5")?.directApiCost,
      ).toBeGreaterThan(0);
    }
  });
});
