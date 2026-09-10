import { describe, expect, it } from "vitest";
import { getDefaultWholesalePrices } from "../src/models.js";
import {
  calculatePricingComparison,
  calculateTokenCost,
  GITHUB_COPILOT_USAGE_PRICING,
  resolveAiCreditUsage,
  resolvePricingEntry,
} from "../src/pricing.js";

// Independently transcribed from the complete Copilot token-rate table, 2026-09-10:
// https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing
// [model, minimum input tokens, input, cached input, cache write, output] in USD/MTok.
const publishedRates: [string, number, number, number, number, number][] = [
  ["gpt-5-mini", 0, 0.25, 0.025, 0, 2],
  ["gpt-5.3-codex", 0, 1.75, 0.175, 0, 14],
  ["gpt-5.4", 0, 2.5, 0.25, 0, 15],
  ["gpt-5.4", 272001, 5, 0.5, 0, 22.5],
  ["gpt-5.4-mini", 0, 0.75, 0.075, 0, 4.5],
  ["gpt-5.4-nano", 0, 0.2, 0.02, 0, 1.25],
  ["gpt-5.5", 0, 5, 0.5, 0, 30],
  ["gpt-5.5", 272001, 10, 1, 0, 45],
  ["gpt-5.6-luna", 0, 0.2, 0.02, 0.25, 1.2],
  ["gpt-5.6-luna", 200001, 0.4, 0.04, 0.5, 1.8],
  ["gpt-5.6-sol", 0, 4, 0.4, 5, 20],
  ["gpt-5.6-sol", 272001, 8, 0.8, 10, 30],
  ["gpt-5.6-terra", 0, 2, 0.2, 2.5, 12],
  ["gpt-5.6-terra", 272001, 4, 0.4, 5, 18],
  ["gpt-6-astra", 0, 10, 1, 12.5, 50],
  ["gpt-6-astra", 272001, 20, 2, 25, 75],
  ["claude-haiku-4.5", 0, 1, 0.1, 1.25, 5],
  ["claude-sonnet-4", 0, 3, 0.3, 3.75, 15],
  ["claude-sonnet-4.6", 0, 3, 0.3, 3.75, 15],
  ["claude-opus-4.7", 0, 5, 0.5, 6.25, 25],
  ["claude-opus-4.8", 0, 5, 0.5, 6.25, 25],
  ["claude-opus-5", 0, 5, 0.5, 6.25, 25],
  ["claude-sonnet-5", 0, 2, 0.2, 2.5, 10],
  ["claude-opus-4.8-fast", 0, 10, 1, 12.5, 50],
  ["claude-fable-5", 0, 10, 1, 12.5, 50],
  ["claude-fable-5.1", 0, 10, 0.25, 12.5, 50],
  ["gemini-3.5-flash", 0, 1.5, 0.15, 0, 9],
  ["gemini-3.6-flash", 0, 0.75, 0.075, 0, 3.75],
  ["gemini-3.7-flash", 0, 0.75, 0.075, 0, 3.75],
  ["gemini-3.8-flash", 0, 0.75, 0.075, 0, 3.75],
  ["mai-code-1-flash", 0, 0.75, 0.075, 0, 4.5],
  ["mai-code-1.1-flash", 0, 0.2, 0.02, 0, 1.2],
  ["grok-4.5", 0, 2, 0.5, 0, 6],
  ["grok-4.5", 200001, 4, 1, 0, 12],
  ["grok-4.6", 0, 2, 0.5, 0, 6],
  ["grok-4.6", 200001, 4, 1, 0, 12],
  ["kimi-k2.7-code", 0, 0.95, 0.19, 0, 4],
  ["kimi-k3", 0, 3, 0.3, 0, 15],
];
const options = { billingProvider: "github-copilot" as const, at: "2026-09-10" };

describe("September 2026 Copilot pricing snapshot", () => {
  it.each(
    publishedRates,
  )("resolves the published rates for %s at threshold %i", (model, minimumInputTokens, inputPerM, cachedInputPerM, cacheWritePerM, outputPerM) => {
    const entry = resolvePricingEntry(model, { ...options, inputTokens: minimumInputTokens });
    expect(entry?.rates).toEqual({ inputPerM, cachedInputPerM, cacheWritePerM, outputPerM });
    expect(entry?.sourceLabel).toContain("verified 2026-09-10");
    expect(entry?.sourceUrl).toBe(
      "https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing",
    );
  });

  it("covers the complete current table, with no historical rows relabeled as current", () => {
    const currentKeys = GITHUB_COPILOT_USAGE_PRICING.filter((entry) =>
      entry.sourceLabel.includes("verified 2026-09-10"),
    ).map((entry) => `${entry.model}:${entry.minimumInputTokens ?? 0}`);
    expect(currentKeys.sort()).toEqual(publishedRates.map(([id, min]) => `${id}:${min}`).sort());
  });

  it.each([
    "GPT-6 Astra",
    "gpt-6-astra",
    "models/GPT_6_Astra",
  ])("prices Astra alias %s with disjoint standard, cache-read and cache-write input", (model) => {
    const cost = calculateTokenCost(
      model,
      {
        inputTokens: 200_000,
        cacheReadTokens: 100_000,
        cacheWriteTokens: 50_000,
        outputTokens: 10_000,
      },
      options,
    );
    expect(cost.matchedModel).toBe("gpt-6-astra");
    expect(cost.inputCost).toBeCloseTo(0.5);
    expect(cost.cachedInputCost).toBeCloseTo(0.1);
    expect(cost.cacheWriteCost).toBeCloseTo(0.625);
    expect(cost.outputCost).toBeCloseTo(0.5);
    expect(cost.totalCost).toBeCloseTo(1.725);
    expect(cost.aiCredits).toBeCloseTo(172.5);
    expect(resolveAiCreditUsage(1_000_000_000, cost).source).toBe("observed");
    expect(resolveAiCreditUsage(1_000_000_000, cost).credits).toBe(1);
  });

  it.each([
    ["gpt-6-astra", 272000, 10, 20],
    ["gpt-5.6-sol", 272000, 4, 8],
    ["gpt-5.6-terra", 272000, 2, 4],
    ["gpt-5.6-luna", 200000, 0.2, 0.4],
    ["grok-4.5", 200000, 2, 4],
    ["grok-4.6", 200000, 2, 4],
  ] as const)("selects %s tiers using total prompt tokens, including cache hits", (model, boundary, short, long) => {
    for (const [inputTokens, expected] of [
      [boundary, short],
      [boundary + 1, long],
    ]) {
      const cost = calculateTokenCost(
        model,
        { inputTokens, cacheReadTokens: inputTokens },
        options,
      );
      expect(cost.entry?.rates?.inputPerM).toBe(expected);
      expect(cost.inputCost).toBe(0);
    }
  });

  it("preserves July GPT-5.6 estimates while resolving new rates at the snapshot boundary", () => {
    const usage = { inputTokens: 100_000, cacheWriteTokens: 50_000, outputTokens: 10_000 };
    const old = calculateTokenCost("gpt-5.6-sol", usage, { ...options, at: "2026-09-09" });
    const current = calculateTokenCost("gpt-5.6-sol", usage, options);
    expect(old.totalCost).toBeCloseTo(0.55);
    expect(old.entry?.sourceLabel).toContain("verified 2026-07-17");
    expect(current.totalCost).toBeCloseTo(0.65);
    expect(current.cacheWriteCost).toBeCloseTo(0.25);
    expect(
      resolvePricingEntry("gpt-5.6-sol", { ...options, at: "2026-07-17", rateMode: "latest" })
        ?.rates?.inputPerM,
    ).toBe(4);
  });

  it("uses the latest snapshot for undated comparisons instead of June's billing start date", () => {
    const comparison = calculatePricingComparison(
      {
        modelMetrics: { "gpt-6-astra": { usage: { inputTokens: 100_000 } } },
      },
      0.04,
    );
    expect(comparison.usageBasedCopilot.totalCost).toBe(1);
    expect(calculateTokenCost("gpt-6-astra", {}, { ...options, at: "2026-09-09" }).status).toBe(
      "unknown-model",
    );
  });

  it.each([
    "gemini-3.6-flash",
    "gemini-3.7-flash",
    "gemini-3.8-flash",
  ])("does not extrapolate %s promotional rates past the published end date", (model) => {
    expect(resolvePricingEntry(model, { ...options, at: "2026-12-31T23:59:59Z" })).toBeDefined();
    expect(resolvePricingEntry(model, { ...options, at: "2027-01-01" })).toBeUndefined();
    expect(getDefaultWholesalePrices().find((entry) => entry.model === model)?.effectiveTo).toBe(
      "2027-01-01",
    );
  });

  it("keeps retained prices attributed to July and does not invent official legacy multipliers", () => {
    expect(resolvePricingEntry("gemini-3.1-pro", options)?.sourceLabel).toContain(
      "verified 2026-07-17",
    );
    const legacy = { ...options, pricingKind: "legacy-premium-request" as const };
    expect(resolvePricingEntry("gpt-6-astra", legacy)).toBeUndefined();
    expect(resolvePricingEntry("mai-code-1.1-flash", legacy)?.premiumRequests).toBe(0.25);
    expect(resolvePricingEntry("claude-opus-4.8", legacy)?.premiumRequests).toBe(27);
  });
});
