import { describe, expect, it } from "vitest";
import {
  createPricingSlice,
  DEFAULT_WHOLESALE_PRICES,
  mergeWholesalePricesWithDefaults,
} from "../pricing";

describe("bundled pricing defaults", () => {
  it("seeds modelWholesalePrices with a copy of DEFAULT_WHOLESALE_PRICES", () => {
    const slice = createPricingSlice();
    expect(slice.modelWholesalePrices.value.length).toBe(DEFAULT_WHOLESALE_PRICES.length);
    // Mutating the slice must not mutate the shared defaults array.
    slice.modelWholesalePrices.value.push({
      model: "synthetic-test-model",
      inputPerM: 1,
      cachedInputPerM: 0.1,
      outputPerM: 2,
      premiumRequests: 1,
    });

    expect(
      DEFAULT_WHOLESALE_PRICES.find((p) => p.model === "synthetic-test-model"),
    ).toBeUndefined();
  });

  it("backfills new context tiers without overwriting saved model defaults", () => {
    const savedDefault = {
      model: "gpt-5.4",
      pricingTier: "default" as const,
      inputPerM: 1,
      cachedInputPerM: 0.1,
      outputPerM: 2,
      premiumRequests: 1,
    };
    const merged = mergeWholesalePricesWithDefaults([savedDefault]);
    expect(
      merged.find((price) => price.model === "gpt-5.4" && price.pricingTier === "default"),
    ).toMatchObject(savedDefault);
    expect(
      merged.find((price) => price.model === "gpt-5.4" && price.pricingTier === "long-context"),
    ).toMatchObject({ minimumInputTokens: 272001, inputPerM: 5 });
  });

  it("preserves intentionally removed bundled models across default merges", () => {
    const merged = mergeWholesalePricesWithDefaults([], ["gpt-5.4"]);
    expect(merged.some((price) => price.model === "gpt-5.4")).toBe(false);
    expect(merged.some((price) => price.model === "gpt-5.5")).toBe(true);
  });

  it("backfills Astra tiers and keeps saved direct-API overrides separate from Copilot rates", () => {
    const saved = {
      model: "gpt-5.6-sol",
      inputPerM: 99,
      cachedInputPerM: 9,
      outputPerM: 199,
      premiumRequests: 1,
    };
    const slice = createPricingSlice();
    slice.modelWholesalePrices.value = mergeWholesalePricesWithDefaults([saved]);
    const astra = slice.modelWholesalePrices.value.filter((price) => price.model === "gpt-6-astra");
    expect(astra.map((price) => price.cacheWritePerM)).toEqual([12.5, 25]);
    expect(slice.getWholesalePrice("gpt-5.6-sol")).toMatchObject(saved);
    expect(slice.computeUsageBasedCost("gpt-5.6-sol", 100_000, 0, 0, 0, "2026-09-10")).toBe(0.4);
    expect(
      slice.computeUsageBasedCost("GPT-6 Astra", 200_000, 100_000, 10_000, 50_000),
    ).toBeCloseTo(1.725);
    expect(
      slice.computeCostComparison({
        modelMetrics: { "gpt-6-astra": { usage: { inputTokens: 100_000 } } },
      }).usageBasedCopilot.totalCost,
    ).toBe(1);
  });

  it("backfills new models and preserves saved overrides and removals", () => {
    const saved = {
      model: "gpt-6-sol",
      inputPerM: 99,
      cachedInputPerM: 9,
      outputPerM: 199,
      premiumRequests: 1,
    };
    const merged = mergeWholesalePricesWithDefaults([saved], ["grok-4.7"]);
    expect(
      merged.find((price) => price.model === "gpt-6-sol" && price.pricingTier === "default"),
    ).toMatchObject(saved);
    expect(
      merged.find((price) => price.model === "gpt-6-sol" && price.pricingTier === "long-context"),
    ).toMatchObject({ inputPerM: 4, cacheWritePerM: 5 });
    expect(merged.find((price) => price.model === "claude-opus-5.5")).toMatchObject({
      inputPerM: 4,
      cachedInputPerM: 0.2,
      cacheWritePerM: 5,
    });
    expect(merged.filter((price) => price.model === "gpt-6-luna")).toHaveLength(2);
    expect(merged.some((price) => price.model === "grok-4.7")).toBe(false);
  });

  it("backfills October models while preserving saved overrides, removals and delisted prices", () => {
    const saved = {
      model: "claude-opus-4.7",
      inputPerM: 99,
      cachedInputPerM: 9,
      outputPerM: 199,
      premiumRequests: 15,
    };
    const merged = mergeWholesalePricesWithDefaults([saved], ["gemini-3.5-flash"]);
    expect(merged.find((price) => price.model === saved.model)).toMatchObject(saved);
    expect(merged.some((price) => price.model === "gemini-3.5-flash")).toBe(false);
    expect(merged.filter((price) => price.model === "gpt-6.1-sol")).toMatchObject([
      { inputPerM: 2, cachedInputPerM: 0.1, cacheWritePerM: 2.5, outputPerM: 10 },
      {
        minimumInputTokens: 272001,
        inputPerM: 4,
        cachedInputPerM: 0.2,
        cacheWritePerM: 5,
        outputPerM: 15,
      },
    ]);
    expect(merged.find((price) => price.model === "claude-sonnet-5.5")).toMatchObject({
      inputPerM: 2,
      cachedInputPerM: 0.1,
      cacheWritePerM: 2.5,
      outputPerM: 10,
    });
    expect(merged.filter((price) => price.model === "claude-haiku-5.5")).toMatchObject([
      { inputPerM: 0.1, cachedInputPerM: 0.01, cacheWritePerM: 0.125, outputPerM: 0.5 },
      {
        minimumInputTokens: 100001,
        inputPerM: 0.5,
        cachedInputPerM: 0.05,
        cacheWritePerM: 0.625,
        outputPerM: 2.5,
      },
    ]);
    expect(merged.find((price) => price.model === "gemini-3.6-flash")?.effectiveTo).toBe(
      "2027-01-01",
    );
    expect(merged.find((price) => price.model === "kimi-k2.7-code")?.sourceLabel).toContain(
      "verified 2026-09-27",
    );
    const slice = createPricingSlice();
    slice.modelWholesalePrices.value = merged;
    expect(slice.computeUsageBasedCost(saved.model, 100_000, 0, 0)).toBe(0.5);
    expect(slice.computeUsageBasedCost("Claude Sonnet 5.5", 100_000, 0, 0)).toBe(0.2);
    expect(slice.computeUsageBasedCost("GPT-6.1 Sol", 100_000, 100_000, 0)).toBeCloseTo(0.01);
    expect(slice.computeUsageBasedCost("Claude Haiku 5.5", 100_000, 100_000, 0)).toBeCloseTo(0.001);
    expect(slice.computeUsageBasedCost("Claude Haiku 5.5", 100_001, 100_001, 0)).toBeCloseTo(
      0.00500005,
    );
  });

  it("preserves saved Sonnet cache rates while using refreshed Copilot rates and honoring Haiku removal", () => {
    const saved = {
      model: "claude-sonnet-5.5",
      inputPerM: 2,
      cachedInputPerM: 0.2,
      cacheWritePerM: 2.5,
      outputPerM: 10,
      premiumRequests: 1,
    };
    const slice = createPricingSlice();
    slice.modelWholesalePrices.value = mergeWholesalePricesWithDefaults(
      [saved],
      ["claude-haiku-5.5"],
    );
    expect(
      slice.modelWholesalePrices.value.some((price) => price.model === "claude-haiku-5.5"),
    ).toBe(false);
    expect(slice.getWholesalePrice(saved.model)).toMatchObject(saved);
    expect(slice.computeWholesaleCost(saved.model, 100_000, 100_000, 0)).toBeCloseTo(0.02);
    expect(slice.computeUsageBasedCost(saved.model, 100_000, 100_000, 0)).toBeCloseTo(0.01);
    expect(
      slice.computeUsageBasedCost(saved.model, 100_000, 100_000, 0, 0, "2026-10-09"),
    ).toBeCloseTo(0.02);
  });
});
