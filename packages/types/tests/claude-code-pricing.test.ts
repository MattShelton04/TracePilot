import { describe, expect, it } from "vitest";
import {
  CLAUDE_CODE_PRICING,
  calculateClaudeCodeTokenCost,
  claudeCodeModelFamily,
  modelDisplayName,
} from "../src/claude-code-pricing.js";
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
      expect(cost.entry?.sourceLabel).toContain("verified 2026-10-11");
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
    expect(resolvePricingEntry("claude-sonnet-5.5")?.rates?.cachedInputPerM).toBe(0.1);
    expect(
      calculateClaudeCodeTokenCost("claude-sonnet-5-5", {
        inputTokens: 100,
        cacheReadTokens: 100,
        outputTokens: 0,
      }).totalCost,
    ).toBe(0.00001);
    expect(resolvePricingEntry("claude-opus-5-5")).toBeUndefined();
  });

  it("prices Claude Haiku 5.5 by prompt length, counting cache reads and writes", () => {
    // Over 100,000 prompt tokens (input including cache) the whole request
    // moves to the higher tier.
    const usage = (inputTokens: number) => ({
      inputTokens,
      cacheReadTokens: 60_000,
      cacheWriteTokens: 1_000,
      cacheWriteByTtl: { "300": 1_000 },
      outputTokens: 100,
    });
    for (const id of ["claude-haiku-5-5", "claude-haiku-5.5", "claude-haiku-5-5-20261001"]) {
      const short = calculateClaudeCodeTokenCost(id, usage(100_000));
      expect(short.matchedModel).toBe("claude-haiku-5.5");
      expect(short.totalCost).toBeCloseTo(
        (39_000 * 0.1 + 60_000 * 0.01 + 1_000 * 0.125 + 100 * 0.5) / 1e6,
        12,
      );
      const long = calculateClaudeCodeTokenCost(id, usage(100_001));
      expect(long.entry?.minimumInputTokens).toBe(100_001);
      expect(long.totalCost).toBeCloseTo(
        (39_001 * 0.5 + 60_000 * 0.05 + 1_000 * 0.625 + 100 * 2.5) / 1e6,
        12,
      );
    }
  });

  it("prices the historical Haiku native alias and keeps estimates out of AI Credits", () => {
    const cost = calculateClaudeCodeTokenCost("claude-3-5-haiku-20241022", {
      inputTokens: 10,
      outputTokens: 5,
    });
    expect(cost.totalCost).toBeCloseTo((10 * 0.8 + 5 * 4) / 1e6, 12);
    expect(cost.aiCredits).toBeNull();
  });
});

describe("modelDisplayName", () => {
  it("names a known Claude Code id by its family and leaves the rest as recorded", () => {
    expect(modelDisplayName("claude-opus-5-5", "claudeCode")).toBe("claude-opus-5.5");
    expect(modelDisplayName("claude-opus-5-5-fast", "claudeCode")).toBe("claude-opus-5-5-fast");
    expect(modelDisplayName("claude-opus-5-5", "copilot")).toBe("claude-opus-5-5");
    expect(modelDisplayName("gpt-5", undefined)).toBe("gpt-5");
  });
});

describe("claudeCodeModelFamily", () => {
  it("names native and dated ids by their registry family, as Copilot does", () => {
    expect(claudeCodeModelFamily("claude-opus-4-5-20251101")).toBe("claude-opus-4.5");
    expect(claudeCodeModelFamily("claude-haiku-4-5-20251001")).toBe("claude-haiku-4.5");
    expect(claudeCodeModelFamily("claude-opus-5-5")).toBe("claude-opus-5.5");
    expect(claudeCodeModelFamily("claude-3-5-haiku")).toBe("claude-haiku-3.5");
    expect(claudeCodeModelFamily("claude-haiku-5-5")).toBe("claude-haiku-5.5");
    expect(claudeCodeModelFamily("claude-haiku-5-5-20261001")).toBe("claude-haiku-5.5");
    expect(claudeCodeModelFamily("claude-mythos-5-1")).toBe("claude-mythos-5.1");
    expect(claudeCodeModelFamily("claude-mythos-5")).toBe("claude-mythos-5");
    expect(modelDisplayName("claude-haiku-5-5", "claudeCode")).toBe("claude-haiku-5.5");
  });
  it("leaves unknown models and variants unnamed", () => {
    expect(claudeCodeModelFamily("claude-unpublished-9")).toBeNull();
    expect(claudeCodeModelFamily("claude-opus-5-5-fast")).toBeNull();
  });
});
