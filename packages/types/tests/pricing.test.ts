import { describe, expect, it } from "vitest";
import type { ModelPriceEntry } from "../src/config.js";
import {
  calculateObservedAiuCost,
  calculatePricingComparison,
  calculateTokenCost,
  GITHUB_COPILOT_USAGE_PRICING,
  GITHUB_USAGE_BILLING_EFFECTIVE_FROM,
  modelPriceEntriesToPricingRegistry,
  normalizeModelName,
  PROVIDER_WHOLESALE_PRICING,
  resolvePricingEntry,
} from "../src/pricing.js";
import type { ShutdownMetrics } from "../src/session.js";

describe("pricing registry", () => {
  it("normalizes documentation names and event slugs consistently", () => {
    expect(normalizeModelName("GPT-5.2 Codex")).toBe("gpt-5.2-codex");
    expect(normalizeModelName("models/Claude Sonnet 4.6")).toBe("claude-sonnet-4.6");
  });

  it("matches model aliases without substring-only fallback", () => {
    const match = resolvePricingEntry("Claude Sonnet 4.6", {
      billingProvider: "github-copilot",
      pricingKind: "usage-token-rate",
      at: GITHUB_USAGE_BILLING_EFFECTIVE_FROM,
    });
    expect(match?.model).toBe("claude-sonnet-4.6");

    const unknown = resolvePricingEntry("not-claude-sonnet-4.6-but-contains-it", {
      billingProvider: "github-copilot",
      pricingKind: "usage-token-rate",
      at: GITHUB_USAGE_BILLING_EFFECTIVE_FROM,
    });
    expect(unknown).toBeUndefined();
  });

  it("honors effective dates for session-time lookup", () => {
    expect(
      resolvePricingEntry("gpt-5.4", {
        billingProvider: "github-copilot",
        pricingKind: "usage-token-rate",
        at: "2026-05-31",
      }),
    ).toBeUndefined();
    expect(
      resolvePricingEntry("gpt-5.4", {
        billingProvider: "github-copilot",
        pricingKind: "usage-token-rate",
        at: "2026-06-01",
      })?.rates?.outputPerM,
    ).toBe(15);
  });

  it("derives provider defaults from the same published rates as GitHub usage pricing", () => {
    for (const usageEntry of GITHUB_COPILOT_USAGE_PRICING) {
      const providerEntry = PROVIDER_WHOLESALE_PRICING.find(
        (entry) => entry.model === usageEntry.model,
      );
      expect(providerEntry?.rates).toEqual(usageEntry.rates);
      expect(providerEntry?.sourceLabel).toContain("mirrors GitHub's published token rates");
    }
  });

  it("calculates usage-based token cost with cache reads and cache writes", () => {
    const cost = calculateTokenCost(
      "claude-sonnet-4.6",
      {
        inputTokens: 1_000_000,
        cacheReadTokens: 400_000,
        cacheWriteTokens: 100_000,
        outputTokens: 200_000,
      },
      {
        billingProvider: "github-copilot",
        pricingKind: "usage-token-rate",
        at: "2026-06-01",
      },
    );
    expect(cost.status).toBe("priced");
    expect(cost.inputCost).toBeCloseTo(1.8);
    expect(cost.cachedInputCost).toBeCloseTo(0.12);
    expect(cost.cacheWriteCost).toBeCloseTo(0.375);
    expect(cost.outputCost).toBeCloseTo(3);
    expect(cost.totalCost).toBeCloseTo(5.295);
  });

  it("treats missing token fields as zero", () => {
    const cost = calculateTokenCost(
      "gpt-5.5",
      {},
      {
        billingProvider: "github-copilot",
        pricingKind: "usage-token-rate",
        at: "2026-06-01",
      },
    );
    expect(cost.status).toBe("priced");
    expect(cost.totalCost).toBe(0);
  });

  it("returns structured unknown state for unknown models", () => {
    const cost = calculateTokenCost(
      "unknown-frontier-model",
      { inputTokens: 100 },
      {
        billingProvider: "github-copilot",
        pricingKind: "usage-token-rate",
        at: "2026-06-01",
      },
    );
    expect(cost.status).toBe("unknown-model");
    expect(cost.totalCost).toBeNull();
  });

  it("lets user provider overrides take precedence over bundled wholesale rates", () => {
    const override: ModelPriceEntry = {
      model: "gpt-5.5",
      inputPerM: 1,
      cachedInputPerM: 0.5,
      cacheWritePerM: 0,
      outputPerM: 2,
      premiumRequests: 1,
    };
    const cost = calculateTokenCost(
      "GPT-5.5",
      { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      {
        billingProvider: "provider-wholesale",
        pricingKind: "usage-token-rate",
        userOverrides: modelPriceEntriesToPricingRegistry([override]),
      },
    );
    expect(cost.entry?.status).toBe("user-override");
    expect(cost.totalCost).toBe(3);
  });

  it("compares legacy premium requests with usage-based preview", () => {
    const metrics: ShutdownMetrics = {
      totalPremiumRequests: 10,
      modelMetrics: {
        "gpt-5.5": {
          requests: { count: 1, cost: 10 },
          usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
        },
      },
    };
    const comparison = calculatePricingComparison(metrics, 0.04, [], "2026-06-01");
    expect(comparison.legacyCopilotCost).toBeCloseTo(0.4);
    expect(comparison.usageBasedCopilot.totalCost).toBeCloseTo(35);
    expect(comparison.june2026PreviewDelta).toBeCloseTo(34.6);
  });

  it("converts observed nano AIU telemetry with explicit nano units", () => {
    expect(calculateObservedAiuCost(1_000_000_000)).toBe(0.01);
  });
});
