import { DEFAULT_FEATURES } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import { FEATURE_FLAGS, isFeatureFlag } from "@/config/featureFlags";

describe("feature flag registry consistency", () => {
  it("is non-empty", () => {
    expect(FEATURE_FLAGS.length).toBeGreaterThan(0);
  });

  it("is exactly the set of DEFAULT_FEATURES keys", () => {
    expect([...FEATURE_FLAGS].sort()).toEqual(Object.keys(DEFAULT_FEATURES).sort());
  });

  it("every FEATURE_FLAGS entry is a valid DEFAULT_FEATURES key", () => {
    for (const flag of FEATURE_FLAGS) {
      expect(Object.hasOwn(DEFAULT_FEATURES, flag)).toBe(true);
    }
  });

  it("FEATURE_FLAGS is frozen", () => {
    expect(Object.isFrozen(FEATURE_FLAGS)).toBe(true);
  });

  it("isFeatureFlag narrows correctly", () => {
    for (const flag of FEATURE_FLAGS) {
      expect(isFeatureFlag(flag)).toBe(true);
    }
    expect(isFeatureFlag("not-a-real-flag")).toBe(false);
    expect(isFeatureFlag(42)).toBe(false);
    expect(isFeatureFlag(undefined)).toBe(false);
    expect(isFeatureFlag(null)).toBe(false);
  });
});
