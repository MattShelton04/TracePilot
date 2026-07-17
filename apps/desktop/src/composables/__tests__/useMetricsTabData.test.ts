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
});
