import { describe, expect, it } from "vitest";
import { getDefaultWholesalePrices, getModelById } from "../src/models.js";
import {
  calculatePricingComparison,
  calculateTokenCost,
  GITHUB_ANNUAL_LEGACY_MULTIPLIERS,
  GITHUB_COPILOT_USAGE_PRICING,
  resolveAiCreditUsage,
  resolvePricingEntry,
} from "../src/pricing.js";

// Independently transcribed from the complete Copilot token-rate table, 2026-11-27:
// https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing
// [model, minimum input tokens, input, cached input, cache write, output] in USD/MTok.
const publishedRates: [string, number, number, number, number, number][] = [
  ["gpt-5.3-codex", 0, 1.75, 0.175, 0, 14],
  ["gpt-5.4-nano", 0, 0.2, 0.02, 0, 1.25],
  ["gpt-5.6-luna", 0, 0.2, 0.02, 0.25, 1.2],
  ["gpt-5.6-luna", 200001, 0.4, 0.04, 0.5, 1.8],
  ["gpt-5.6-sol", 0, 4, 0.4, 5, 20],
  ["gpt-5.6-sol", 272001, 8, 0.8, 10, 30],
  ["gpt-6-astra", 0, 10, 1, 12.5, 50],
  ["gpt-6-astra", 272001, 20, 2, 25, 75],
  ["gpt-6-luna", 0, 0.1, 0.01, 0.125, 0.5],
  ["gpt-6-luna", 272001, 0.2, 0.02, 0.25, 0.75],
  ["gpt-6-sol", 0, 2, 0.2, 2.5, 10],
  ["gpt-6-sol", 272001, 4, 0.4, 5, 15],
  ["gpt-6.1-sol", 0, 2, 0.1, 2.5, 10],
  ["gpt-6.1-sol", 272001, 4, 0.2, 5, 15],
  ["gpt-6.1-terra", 0, 1, 0.05, 1.25, 5],
  ["gpt-6.1-terra", 272001, 2, 0.1, 2.5, 7.5],
  ["gpt-6.2-astra", 0, 8, 0.4, 10, 40],
  ["gpt-6.2-astra", 272001, 16, 0.8, 20, 60],
  ["gpt-6.2-sol", 0, 2, 0.1, 2.5, 10],
  ["gpt-6.2-sol", 272001, 4, 0.2, 5, 15],
  ["claude-haiku-4.5", 0, 1, 0.1, 1.25, 5],
  ["claude-haiku-5.5", 0, 0.1, 0.01, 0.125, 0.5],
  ["claude-haiku-5.5", 100001, 0.5, 0.05, 0.625, 2.5],
  ["claude-sonnet-4", 0, 3, 0.3, 3.75, 15],
  ["claude-sonnet-4.6", 0, 3, 0.3, 3.75, 15],
  ["claude-opus-4.8", 0, 5, 0.5, 6.25, 25],
  ["claude-opus-5.5", 0, 4, 0.2, 5, 20],
  ["claude-sonnet-5", 0, 2, 0.2, 2.5, 10],
  ["claude-sonnet-5.5", 0, 2, 0.1, 2.5, 10],
  ["claude-opus-4.8-fast", 0, 10, 1, 12.5, 50],
  ["claude-fable-5", 0, 10, 1, 12.5, 50],
  ["claude-fable-5.1", 0, 10, 0.25, 12.5, 50],
  ["claude-fable-5.2", 0, 8, 0.2, 10, 40],
  ["gemini-3.8-flash", 0, 0.75, 0.075, 0, 3.75],
  ["gemini-4-argon", 0, 2, 0.1, 0, 10],
  ["gemini-4-carbon", 0, 2, 0.1, 0, 10],
  ["gemini-4-hydrogen", 0, 1.5, 0.075, 0, 7.5],
  ["gemini-4-neon", 0, 3, 0.15, 0, 15],
  ["grok-4.5", 0, 2, 0.5, 0, 6],
  ["grok-4.5", 200001, 4, 1, 0, 12],
  ["grok-4.6", 0, 2, 0.5, 0, 6],
  ["grok-4.6", 200001, 4, 1, 0, 12],
  ["grok-4.7", 0, 2, 0.5, 0, 6],
  ["grok-4.7", 200001, 4, 1, 0, 12],
  ["mai-code-1.1-flash", 0, 0.2, 0.02, 0, 1.2],
  ["mai-code-2", 0, 0.5, 0.025, 0, 2.5],
  ["mai-code-2-flash", 0, 0.05, 0.005, 0, 0.25],
  ["kimi-k3", 0, 3, 0.3, 0, 15],
];
// Independently transcribed from the complete annual legacy multiplier table, 2026-11-27:
// https://docs.github.com/en/copilot/reference/copilot-billing/request-based-billing-legacy/model-multipliers-for-annual-plans
const publishedAnnualMultipliers: [string, number][] = [
  ["claude-haiku-4.5", 0.33],
  ["claude-opus-4.8", 27],
  ["claude-sonnet-4.6", 9],
  ["gpt-5.3-codex", 6],
  ["mai-code-1.1-flash", 0.25],
  ["mai-code-2", 1],
  ["mai-code-2-flash", 0.33],
];
const options = { billingProvider: "github-copilot" as const, at: "2026-11-27" };

describe("November 2026 Copilot pricing snapshot", () => {
  it.each(
    publishedRates,
  )("resolves the published rates for %s at threshold %i", (model, minimumInputTokens, inputPerM, cachedInputPerM, cacheWritePerM, outputPerM) => {
    const entry = resolvePricingEntry(model, { ...options, inputTokens: minimumInputTokens });
    expect(entry?.rates).toEqual({ inputPerM, cachedInputPerM, cacheWritePerM, outputPerM });
    expect(entry?.sourceLabel).toContain("verified 2026-11-27");
    expect(entry?.sourceUrl).toBe(
      "https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing",
    );
  });

  it("covers the complete current table, with no historical rows relabeled as current", () => {
    const currentKeys = GITHUB_COPILOT_USAGE_PRICING.filter((entry) =>
      entry.sourceLabel.includes("verified 2026-11-27"),
    ).map((entry) => `${entry.model}:${entry.minimumInputTokens ?? 0}`);
    expect(currentKeys.sort()).toEqual(publishedRates.map(([id, min]) => `${id}:${min}`).sort());
  });

  it.each(
    publishedAnnualMultipliers,
  )("resolves the published annual legacy multiplier for %s", (model, premiumRequests) => {
    const entry = resolvePricingEntry(model, {
      ...options,
      pricingKind: "legacy-premium-request",
    });
    expect(entry?.premiumRequests).toBe(premiumRequests);
    expect(entry?.sourceLabel).toContain("verified 2026-11-27");
    expect(entry?.sourceUrl).toBe(
      "https://docs.github.com/en/copilot/reference/copilot-billing/request-based-billing-legacy/model-multipliers-for-annual-plans",
    );
  });

  it("covers the complete current annual table without relabeling retained multipliers", () => {
    const current = GITHUB_ANNUAL_LEGACY_MULTIPLIERS.filter((entry) =>
      entry.sourceLabel.includes("verified 2026-11-27"),
    ).map((entry) => [entry.model, entry.premiumRequests]);
    expect(current.sort()).toEqual([...publishedAnnualMultipliers].sort());
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
    ["gpt-6-sol", 272000, 2, 4],
    ["gpt-6.1-sol", 272000, 2, 4],
    ["gpt-6-luna", 272000, 0.1, 0.2],
    ["gpt-5.6-sol", 272000, 4, 8],
    ["gpt-5.6-terra", 272000, 2, 4],
    ["gpt-5.6-luna", 200000, 0.2, 0.4],
    ["grok-4.5", 200000, 2, 4],
    ["grok-4.6", 200000, 2, 4],
    ["grok-4.7", 200000, 2, 4],
    ["claude-haiku-5.5", 100000, 0.1, 0.5],
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

  it.each([
    ["gpt-6-sol", 272000, 0.489],
    ["gpt-6-sol", 272001, 0.928004],
    ["gpt-6.1-sol", 272000, 0.479],
    ["gpt-6.1-sol", 272001, 0.908004],
    ["gpt-6-luna", 272000, 0.02445],
    ["gpt-6-luna", 272001, 0.0464002],
  ] as const)("charges the entire %s request at the selected tier with %i input tokens", (model, inputTokens, expected) => {
    const cost = calculateTokenCost(
      model,
      { inputTokens, cacheReadTokens: 100000, cacheWriteTokens: 50000, outputTokens: 10000 },
      options,
    );
    expect(cost.totalCost).toBeCloseTo(expected, 8);
    expect(cost.aiCredits).toBeCloseTo(expected * 100, 6);
  });

  it("keeps Opus 5.5 at its published flat rate even for large prompts", () => {
    const cost = calculateTokenCost("claude-opus-5.5", { inputTokens: 1_000_000 }, options);
    expect(cost.totalCost).toBe(4);
    expect(cost.entry?.pricingTier).toBe("default");
  });

  it.each([
    [100000, 0.011125],
    [100001, 0.0556255],
  ])("charges the entire Haiku 5.5 request at the selected tier with %i input tokens", (inputTokens, expected) => {
    const cost = calculateTokenCost(
      "Claude Haiku 5.5",
      { inputTokens, cacheReadTokens: 50000, cacheWriteTokens: 25000, outputTokens: 10000 },
      options,
    );
    expect(cost.totalCost).toBeCloseTo(expected, 8);
    expect(cost.aiCredits).toBeCloseTo(expected * 100, 6);
  });

  it("starts Haiku 5.5 estimates at the verified boundary without an official legacy multiplier", () => {
    expect(
      resolvePricingEntry("claude-haiku-5.5", { ...options, at: "2026-10-09" }),
    ).toBeUndefined();
    expect(resolvePricingEntry("claude-haiku-5.5", options)?.effectiveFrom).toBe("2026-10-10");
    expect(
      resolvePricingEntry("claude-haiku-5.5", {
        ...options,
        pricingKind: "legacy-premium-request",
      }),
    ).toBeUndefined();
  });

  it("preserves Sonnet 5.5's prior cache rate for dated estimates and uses the new rate by default", () => {
    const usage = { inputTokens: 1_000_000, cacheReadTokens: 1_000_000 };
    const old = calculateTokenCost("claude-sonnet-5.5", usage, { ...options, at: "2026-10-09" });
    expect(old.totalCost).toBe(0.2);
    expect(old.entry?.sourceLabel).toContain("verified 2026-10-04");
    expect(old.entry?.effectiveTo).toBe("2026-10-10");
    for (const at of ["2026-10-10", options.at, undefined]) {
      const current = calculateTokenCost("claude-sonnet-5.5", usage, { ...options, at });
      expect(current.totalCost).toBe(0.1);
      expect(current.entry?.effectiveFrom).toBe("2026-10-10");
    }
    expect(
      getDefaultWholesalePrices().filter((entry) => entry.model === "claude-sonnet-5.5"),
    ).toHaveLength(1);
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
    ["gemini-3.6-flash", "2027-01-01"],
    ["gemini-3.7-flash", "2027-01-01"],
    ["gemini-3.8-flash", "2027-01-01"],
    ["gemini-4-argon", "2026-12-01"],
    ["gemini-4-carbon", "2026-12-01"],
    ["mai-code-2", "2027-05-17"],
    ["mai-code-2-flash", "2027-05-17"],
  ])("does not extrapolate %s promotional rates past the published end date", (model, end) => {
    const lastSecond = new Date(Date.parse(end) - 1000).toISOString();
    expect(resolvePricingEntry(model, { ...options, at: lastSecond })).toBeDefined();
    expect(resolvePricingEntry(model, { ...options, at: end })).toBeUndefined();
    expect(getDefaultWholesalePrices().find((entry) => entry.model === model)?.effectiveTo).toBe(
      end,
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
    for (const model of ["claude-opus-5.5", "gpt-6-sol", "gpt-6-luna", "grok-4.7"]) {
      expect(resolvePricingEntry(model, legacy)).toBeUndefined();
      expect(resolvePricingEntry(model, { ...options, at: "2026-09-26" })).toBeUndefined();
    }
    expect(resolvePricingEntry("mai-code-1-flash", options)?.sourceLabel).toContain(
      "verified 2026-09-10",
    );
    expect(resolvePricingEntry("mai-code-1-flash", legacy)?.sourceLabel).toContain(
      "verified 2026-09-10",
    );
  });

  it.each([
    ["claude-opus-4.7", 5, 0.5, 6.25, 25, undefined],
    ["gemini-3.5-flash", 1.5, 0.15, 0, 9, undefined],
    ["gemini-3.6-flash", 0.75, 0.075, 0, 3.75, "2027-01-01"],
    ["kimi-k2.7-code", 0.95, 0.19, 0, 4, undefined],
  ] as const)("preserves delisted %s rates, identity and provenance for dated and undated estimates", (model, inputPerM, cachedInputPerM, cacheWritePerM, outputPerM, effectiveTo) => {
    expect(getModelById(model)).toBeDefined();
    for (const at of ["2026-09-27", options.at, undefined]) {
      const entry = resolvePricingEntry(model, { ...options, at });
      expect(entry?.rates).toEqual({ inputPerM, cachedInputPerM, cacheWritePerM, outputPerM });
      expect(entry?.sourceLabel).toContain("verified 2026-09-27");
      expect(entry?.sourceLabel).toContain("absent from the 2026-10-04 Copilot table");
      expect(entry?.effectiveTo).toBe(effectiveTo);
    }
    const defaults = getDefaultWholesalePrices().find((entry) => entry.model === model);
    expect(defaults?.sourceLabel).toContain("verified 2026-09-27");
    expect(defaults?.effectiveTo).toBe(effectiveTo);
  });

  it.each([
    ["Claude Opus 4.7", 27],
    ["Gemini 3.5 Flash", 14],
  ] as const)("retains delisted annual multiplier for %s without claiming a new verification", (model, premiumRequests) => {
    for (const at of ["2026-09-27", options.at, undefined]) {
      const entry = resolvePricingEntry(model, {
        ...options,
        at,
        pricingKind: "legacy-premium-request",
      });
      expect(entry?.premiumRequests).toBe(premiumRequests);
      expect(entry?.sourceLabel).toContain("verified 2026-09-27");
      expect(entry?.sourceLabel).toContain("absent from the 2026-10-04 Copilot table");
      expect(entry?.effectiveTo).toBeUndefined();
    }
  });

  it.each([
    "gpt-6.1-terra",
    "gpt-6.2-astra",
    "gpt-6.2-sol",
    "claude-fable-5.2",
    "gemini-4-argon",
    "gemini-4-carbon",
    "gemini-4-hydrogen",
    "gemini-4-neon",
  ])("starts new %s Copilot estimates at the November boundary without inventing legacy rates", (model) => {
    expect(getModelById(model)).toBeDefined();
    expect(resolvePricingEntry(model, { ...options, at: "2026-11-26" })).toBeUndefined();
    expect(resolvePricingEntry(model, options)?.effectiveFrom).toBe("2026-11-27");
    expect(resolvePricingEntry(model, { billingProvider: "github-copilot" })).toBeDefined();
    expect(
      resolvePricingEntry(model, { ...options, pricingKind: "legacy-premium-request" }),
    ).toBeUndefined();
  });

  it.each([
    "gpt-5-mini",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.5",
    "gpt-5.6-terra",
    "claude-opus-5",
    "gemini-3.7-flash",
  ])("retains %s, delisted from the November table, for dated and undated estimates", (model) => {
    for (const at of ["2026-10-10", options.at, undefined]) {
      const entry = resolvePricingEntry(model, { ...options, at });
      expect(entry?.sourceLabel).toContain("absent from the 2026-11-27 Copilot table");
    }
  });

  it.each([
    "claude-sonnet-5.5",
    "gpt-6.1-sol",
  ])("starts new %s Copilot estimates at the verified boundary without inventing legacy rates", (model) => {
    expect(resolvePricingEntry(model, { ...options, at: "2026-10-03" })).toBeUndefined();
    expect(resolvePricingEntry(model, { ...options, at: "2026-10-04" })?.effectiveFrom).toBe(
      "2026-10-04",
    );
    expect(resolvePricingEntry(model, { billingProvider: "github-copilot" })).toBeDefined();
    expect(
      resolvePricingEntry(model, { ...options, pricingKind: "legacy-premium-request" }),
    ).toBeUndefined();
  });

  it.each([
    ["Claude Opus 5.5", "claude-opus-5.5", 2.47],
    ["models/GPT_6_Sol", "gpt-6-sol", 1.245],
    ["GPT-6 Luna", "gpt-6-luna", 0.06225],
    ["grok-4.7", "grok-4.7", 0.75],
    ["Claude Sonnet 5.5", "claude-sonnet-5.5", 1.235],
    ["models/GPT_6.1_Sol", "gpt-6.1-sol", 1.235],
    ["Claude Haiku 5.5", "claude-haiku-5.5", 0.31125],
    ["models/Claude_Haiku_5.5", "claude-haiku-5.5", 0.31125],
    ["Claude Fable 5.2", "claude-fable-5.2", 4.92],
    ["models/GPT_6.2_Astra", "gpt-6.2-astra", 4.94],
    ["GPT-6.1 Terra", "gpt-6.1-terra", 0.6175],
    ["MAI Code 2", "mai-code-2", 0.2775],
  ])("prices %s with separate ordinary input, cache reads, writes and output", (alias, id, total) => {
    const cost = calculateTokenCost(
      alias,
      {
        inputTokens: 200_000,
        cacheReadTokens: 100_000,
        cacheWriteTokens: 50_000,
        outputTokens: 100_000,
      },
      options,
    );
    expect(cost.matchedModel).toBe(id);
    expect(cost.totalCost).toBeCloseTo(total);
    expect(cost.aiCredits).toBeCloseTo(total * 100);
  });
});
