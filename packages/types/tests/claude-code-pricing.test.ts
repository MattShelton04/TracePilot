import { describe, expect, it } from "vitest";
import { CLAUDE_CODE_PRICING, calculateClaudeCodeTokenCost } from "../src/claude-code-pricing.js";
import { PRICING_REGISTRY, resolvePricingEntry } from "../src/pricing.js";

describe("isolated Claude Code pricing", () => {
  it("prices native and dated aliases with both TTL rates and inclusive input", () => {
    const usage = {
      inputTokens: 130,
      cacheReadTokens: 100,
      cacheWriteTokens: 20,
      cacheWriteByTtl: { "300": 5, "3600": 15 },
      outputTokens: 5,
    };
    for (const id of ["claude-opus-5-5", "claude-opus-5.5", "claude-opus-5-5-20260922"]) {
      const cost = calculateClaudeCodeTokenCost(id, usage);
      expect(cost.totalCost).toBeCloseTo((10 * 4 + 100 * 0.2 + 5 * 5 + 15 * 8 + 5 * 20) / 1e6, 12);
      expect(cost.entry?.sourceLabel).toContain("verified 2026-10-08");
      expect(cost.entry?.billingProvider).toBe("provider-wholesale");
    }
  });
  it("keeps unknown models, variants and unknown or incomplete TTLs unpriced", () => {
    for (const id of ["claude-unpublished-9", "claude-opus-5-5-fast", "gpt-6-sol"]) {
      expect(
        calculateClaudeCodeTokenCost(id, { inputTokens: 10, outputTokens: 5 }).totalCost,
      ).toBeNull();
    }
    for (const split of [undefined, { "3600": 10 }, { "60": 20 }]) {
      expect(
        calculateClaudeCodeTokenCost("claude-opus-5-5", {
          inputTokens: 30,
          outputTokens: 5,
          cacheWriteTokens: 20,
          cacheWriteByTtl: split,
        }).totalCost,
      ).toBeNull();
    }
  });
  it("requires an explicit Claude lookup and leaves the Copilot defaults intact", () => {
    expect(CLAUDE_CODE_PRICING.every((entry) => !PRICING_REGISTRY.includes(entry))).toBe(true);
    expect(resolvePricingEntry("claude-sonnet-5.5")?.rates?.cachedInputPerM).toBe(0.2);
    expect(
      calculateClaudeCodeTokenCost("claude-sonnet-5-5", {
        inputTokens: 100,
        cacheReadTokens: 100,
        outputTokens: 0,
      }).totalCost,
    ).toBe(0.00001);
    expect(resolvePricingEntry("claude-opus-5-5")).toBeUndefined();
  });
});
