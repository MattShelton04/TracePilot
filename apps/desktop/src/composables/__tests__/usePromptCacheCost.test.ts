import { setupPinia } from "@tracepilot/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePromptCacheCost } from "@/composables/usePromptCacheCost";
import { usePreferencesStore } from "@/stores/preferences";
import { makeWindow } from "@/utils/__tests__/promptCacheFixtures";

beforeEach(() => setupPinia());

describe("usePromptCacheCost", () => {
  it("prices repeated prefixes once without combining token sizes across pricing tiers", () => {
    const pricing = vi.spyOn(usePreferencesStore(), "computeUsageBasedCostBreakdown");
    const { totalMissCredits, missCredits } = usePromptCacheCost();
    const windows = Array.from({ length: 2400 }, (_, i) =>
      makeWindow({ outcome: "expired", prefixTokens: i % 2 ? 100000 : 400000 }),
    );
    const expected =
      1200 *
      ((missCredits("gpt-5.6-luna", 100000) ?? 0) + (missCredits("gpt-5.6-luna", 400000) ?? 0));
    pricing.mockClear();
    expect(totalMissCredits(windows)).toBeCloseTo(expected);
    expect(pricing).toHaveBeenCalledTimes(4);
    pricing.mockRestore();
  });
  it("prices a miss as cache writes minus cache reads", () => {
    const { missCredits } = usePromptCacheCost();
    // gpt-5.6-luna: $0.25/M cache write, $0.02/M cache read; 1 AIC = $0.01.
    expect(missCredits("gpt-5.6-luna", 100_000)).toBeCloseTo(2.3);
  });

  it("returns null for unpriced models and empty prefixes", () => {
    const { missCredits } = usePromptCacheCost();
    expect(missCredits("not-a-model", 100_000)).toBeNull();
    expect(missCredits("gpt-5.6-luna", 0)).toBeNull();
    expect(missCredits(null, 100_000)).toBeNull();
  });

  it("only counts expired and model-changed windows", () => {
    const { windowMissCredits, totalMissCredits } = usePromptCacheCost();
    const expired = makeWindow({ outcome: "expired", prefixTokens: 100_000 });
    const warm = makeWindow({ prefixTokens: 100_000 });
    expect(windowMissCredits(warm)).toBeNull();
    expect(totalMissCredits([warm])).toBeNull();
    expect(totalMissCredits([warm, expired, { ...expired, outcome: "modelChanged" }])).toBeCloseTo(
      4.6,
    );
  });
});

describe("usePromptCacheCost for sources priced in USD", () => {
  const miss = makeWindow({
    outcome: "expired",
    model: "claude-opus-4-6",
    prefixTokens: 1_000_000,
    ttlSeconds: 3600,
  });

  it("prices a miss as a write at the recorded TTL tier minus a cache read", () => {
    const { windowMissCost, totalMissCost, formatMissCost } = usePromptCacheCost("claudeCode");
    const hourly = windowMissCost(miss);
    const fiveMinute = windowMissCost({ ...miss, ttlSeconds: 300 });
    expect(hourly).toBeGreaterThan(fiveMinute ?? Number.POSITIVE_INFINITY);
    expect(fiveMinute).toBeGreaterThan(0);
    expect(totalMissCost([miss, makeWindow()])).toBeCloseTo(hourly ?? Number.NaN);
    expect(formatMissCost(hourly ?? 0)).toMatch(/^\$\d/);
  });

  it("leaves a miss without a 5m or 1h tier unpriced", () => {
    const { windowMissCost, totalMissCost } = usePromptCacheCost("claudeCode");
    expect(windowMissCost({ ...miss, ttlSeconds: null })).toBeNull();
    expect(windowMissCost({ ...miss, ttlSeconds: 1800 })).toBeNull();
    expect(totalMissCost([{ ...miss, ttlSeconds: null }])).toBeNull();
  });

  it("keeps Copilot misses in AI Credits", () => {
    const { windowMissCost, windowMissCredits, formatMissCost } = usePromptCacheCost("copilot");
    const window = makeWindow({ outcome: "expired", prefixTokens: 100_000 });
    expect(windowMissCost(window)).toBe(windowMissCredits(window));
    expect(formatMissCost(2.3)).not.toContain("$");
  });
});
