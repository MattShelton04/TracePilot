/**
 * usePromptCacheCost — estimated extra cost of prompt-cache misses.
 *
 * After a miss the cached prefix is re-sent and written to the cache again
 * (Copilot CLI reports the frontier as cache writes). The extra cost is the
 * difference between billing those tokens as cache writes (or plain input
 * when a model has no write rate) and billing them as cache reads. Prices come
 * from the pricing registry, so the figure is always an estimate.
 */
import type { CacheWindow } from "@tracepilot/types";
import { usePreferencesStore } from "@/stores/preferences";

/** Outcomes where the cached prefix could not be reused. */
export function isCacheMiss(window: CacheWindow): boolean {
  return window.outcome === "expired" || window.outcome === "modelChanged";
}

export function usePromptCacheCost() {
  const prefs = usePreferencesStore();

  /** Extra AI Credits for re-sending `tokens` of prefix on `model`, or null if unpriced. */
  function missCredits(model: string | null | undefined, tokens: number | null | undefined) {
    if (!model || !tokens) return null;
    const cached = prefs.computeUsageBasedCostBreakdown(model, tokens, tokens, 0);
    if (cached.aiCredits == null) return null;
    const writes = (cached.entry?.rates?.cacheWritePerM ?? 0) > 0;
    const uncached = writes
      ? prefs.computeUsageBasedCostBreakdown(model, tokens, 0, 0, tokens)
      : prefs.computeUsageBasedCostBreakdown(model, tokens, 0, 0);
    if (uncached.aiCredits == null) return null;
    return Math.max(0, uncached.aiCredits - cached.aiCredits);
  }

  /** Estimated extra cost of a window, or null when it was not a miss or is unpriced. */
  function windowMissCredits(window: CacheWindow): number | null {
    return isCacheMiss(window) ? missCredits(window.model, window.prefixTokens) : null;
  }

  /** Sum over windows; null when none of the misses could be priced. */
  function totalMissCredits(windows: readonly CacheWindow[]): number | null {
    let total: number | null = null;
    for (const window of windows) {
      const credits = windowMissCredits(window);
      if (credits != null) total = (total ?? 0) + credits;
    }
    return total;
  }

  return { missCredits, windowMissCredits, totalMissCredits };
}
