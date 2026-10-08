/**
 * usePromptCacheCost — estimated extra cost of prompt-cache misses.
 *
 * After a miss the cached prefix is re-sent and written to the cache again
 * (Copilot CLI reports the frontier as cache writes). The extra cost is the
 * difference between billing those tokens as cache writes (or plain input
 * when a model has no write rate) and billing them as cache reads. Prices come
 * from the pricing registry, so the figure is always an estimate. Sources not
 * billed in AI Credits are priced in USD at their API rates, with the write
 * charged at the window's recorded TTL tier.
 */
import { type CacheWindow, type SessionSource, sourceCapabilities } from "@tracepilot/types";
import { formatAiCredits } from "@tracepilot/ui";
import { type MaybeRefOrGetter, toValue } from "vue";
import { usePreferencesStore } from "@/stores/preferences";
import { formatUsd, sourceTokenUsd } from "@/utils/sourceCost";

/** Outcomes where the cached prefix could not be reused. */
export function isCacheMiss(window: CacheWindow): boolean {
  return window.outcome === "expired" || window.outcome === "modelChanged";
}

export function usePromptCacheCost(source?: MaybeRefOrGetter<SessionSource | undefined>) {
  const prefs = usePreferencesStore();
  const inUsd = () => !sourceCapabilities(toValue(source)).hasAic;

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
    // Price identical model/prefix pairs once per calculation. Keep token sizes
    // separate because summing prefixes first could cross a context-price tier.
    const prices = new Map<string, Map<number, number | null>>();
    for (const window of windows) {
      if (!isCacheMiss(window) || !window.model || !window.prefixTokens) continue;
      let modelPrices = prices.get(window.model);
      if (!modelPrices) {
        modelPrices = new Map();
        prices.set(window.model, modelPrices);
      }
      if (!modelPrices.has(window.prefixTokens)) {
        modelPrices.set(window.prefixTokens, missCredits(window.model, window.prefixTokens));
      }
      const credits = modelPrices.get(window.prefixTokens);
      if (credits != null) total = (total ?? 0) + credits;
    }
    return total;
  }

  /** Extra USD at the source's API rates; null without a 5m or 1h tier or a price. */
  function windowMissUsd(window: CacheWindow): number | null {
    const tokens = window.prefixTokens;
    const ttl = String(window.ttlSeconds ?? "");
    if (!isCacheMiss(window) || !tokens || (ttl !== "300" && ttl !== "3600")) return null;
    const sessionSource = toValue(source) ?? "copilot";
    const read = sourceTokenUsd(sessionSource, window.model, {
      inputTokens: tokens,
      cacheReadTokens: tokens,
      outputTokens: 0,
    });
    const write = sourceTokenUsd(sessionSource, window.model, {
      inputTokens: tokens,
      cacheWriteTokens: tokens,
      cacheWriteByTtl: { [ttl]: tokens },
      outputTokens: 0,
    });
    return read == null || write == null ? null : Math.max(0, write - read);
  }

  /** The window's extra cost in the source's unit (AI Credits or USD). */
  function windowMissCost(window: CacheWindow): number | null {
    return inUsd() ? windowMissUsd(window) : windowMissCredits(window);
  }

  /** Sum in the source's unit; null when none of the misses could be priced. */
  function totalMissCost(windows: readonly CacheWindow[]): number | null {
    if (!inUsd()) return totalMissCredits(windows);
    let total: number | null = null;
    for (const window of windows) {
      const cost = windowMissUsd(window);
      if (cost != null) total = (total ?? 0) + cost;
    }
    return total;
  }

  function formatMissCost(value: number): string {
    return inUsd() ? formatUsd(value) : formatAiCredits(value);
  }

  return {
    missCredits,
    windowMissCredits,
    totalMissCredits,
    windowMissCost,
    totalMissCost,
    formatMissCost,
  };
}
