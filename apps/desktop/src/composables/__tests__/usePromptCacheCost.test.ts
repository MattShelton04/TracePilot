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
