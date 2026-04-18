import { DEFAULT_FEATURES } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import { createFeatureFlagsSlice } from "../featureFlags";

describe("createFeatureFlagsSlice", () => {
  it("seeds featureFlags with a copy of DEFAULT_FEATURES", () => {
    const slice = createFeatureFlagsSlice();
    for (const key of Object.keys(DEFAULT_FEATURES)) {
      expect(slice.featureFlags.value[key]).toBe(
        (DEFAULT_FEATURES as Record<string, boolean>)[key],
      );
    }
    // Mutation must not leak into the shared DEFAULT_FEATURES object.
    slice.featureFlags.value.__synthetic_test_flag = true;
    expect(
      (DEFAULT_FEATURES as Record<string, boolean>).__synthetic_test_flag,
    ).toBeUndefined();
  });

  it("isFeatureEnabled returns false for unknown flags", () => {
    const slice = createFeatureFlagsSlice();
    expect(slice.isFeatureEnabled("definitely_not_a_real_flag" as never)).toBe(false);
  });

  it("toggleFeature flips the stored boolean", () => {
    const slice = createFeatureFlagsSlice();
    slice.featureFlags.value.demoFlag = false;
    slice.toggleFeature("demoFlag" as never);
    expect(slice.featureFlags.value.demoFlag).toBe(true);
    slice.toggleFeature("demoFlag" as never);
    expect(slice.featureFlags.value.demoFlag).toBe(false);
  });
});
