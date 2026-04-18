/**
 * Feature flags preferences slice.
 *
 * Owns the `featureFlags` record + reader/toggle helpers. Defaults come from
 * `DEFAULT_FEATURES` so newly-added flags automatically appear with their
 * compiled-in default without requiring a config migration.
 */

import { DEFAULT_FEATURES } from "@tracepilot/types";
import { ref } from "vue";
import type { FeatureFlag } from "@/config/featureFlags";

export function createFeatureFlagsSlice() {
  const featureFlags = ref<Record<string, boolean>>({ ...DEFAULT_FEATURES });

  /** Check if a feature flag is enabled. */
  function isFeatureEnabled(flag: FeatureFlag): boolean {
    return featureFlags.value[flag] ?? false;
  }

  /** Toggle a feature flag on or off. */
  function toggleFeature(flag: FeatureFlag): void {
    featureFlags.value[flag] = !featureFlags.value[flag];
  }

  return { featureFlags, isFeatureEnabled, toggleFeature };
}

export type FeatureFlagsSlice = ReturnType<typeof createFeatureFlagsSlice>;
