/**
 * Background loading for the analytics store. Once a page has its results,
 * the filters a user is likely to pick next (the other preset ranges, then
 * each source) load while the app is idle, one request at a time, so those
 * switches come straight from the cache. The dashboard's current view is
 * also warmed at launch and re-warmed after each reindex.
 */
import type { SessionSource } from "@tracepilot/types";
import {
  type AnalyticsDatasetName,
  type AnalyticsDateRange,
  type AnalyticsFetchParams,
  filterKey,
  PREFETCH_RANGES,
  presetRange,
} from "./analyticsFilters";

export interface AnalyticsPrefetchOptions {
  /** Load one dataset for some filters into its cache, off screen. */
  prefetch: (name: AnalyticsDatasetName, params: AnalyticsFetchParams) => Promise<void>;
  /** Request parameters for a range (and source), with the current repository. */
  build: (filters: AnalyticsDateRange & { source?: SessionSource | null }) => AnalyticsFetchParams;
  dateRange: () => AnalyticsDateRange;
  sources: () => readonly SessionSource[];
  /** Called when warming starts, so the store hears about reindexes. */
  onWarm: () => void;
}

/**
 * Wait for the renderer to go idle, so prefetching never delays a frame.
 * Prefetching runs unawaited, so this can resume after `window` is gone (a
 * test environment torn down mid-run); it must not touch `window` directly.
 */
function idle(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof globalThis.requestIdleCallback === "function") {
      globalThis.requestIdleCallback(() => resolve(), { timeout: 1000 });
    } else {
      setTimeout(resolve, 50);
    }
  });
}

export function createAnalyticsPrefetch(options: AnalyticsPrefetchOptions) {
  let run = 0;
  // Bumped by `reset`, which also stops a warm still in progress.
  let epoch = 0;
  // Datasets warmed at launch, re-warmed after each reindex so a page opened
  // later never shows numbers from before it.
  let warmed: AnalyticsDatasetName[] = [];

  /** The current filters with each preset range, then with each source. */
  function nearbyFilters(): AnalyticsFetchParams[] {
    const range = options.dateRange();
    const seen = new Set([filterKey(options.build(range))]);
    const variants = [
      ...PREFETCH_RANGES.map((preset) => options.build(presetRange(preset))),
      ...[null, ...options.sources()].map((source) => options.build({ ...range, source })),
    ];
    return variants.filter((params) => {
      const key = filterKey(params);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /** Prefetch the named datasets for nearby filters; a newer call stops it. */
  async function prefetchNearby(names: AnalyticsDatasetName[]) {
    const current = ++run;
    for (const params of nearbyFilters()) {
      for (const name of names) {
        // A cancelled run stops before waiting for another idle slot too.
        if (current !== run) return;
        await idle();
        if (current !== run) return;
        await options.prefetch(name, params);
      }
    }
  }

  /** Stop prefetching, so a filter change has the backend to itself. */
  function cancel() {
    run += 1;
  }

  /**
   * Load the named datasets for the current filters into the cache, one at a
   * time while the app is idle, without touching what is on screen.
   */
  async function warm(names: AnalyticsDatasetName[]) {
    const current = epoch;
    warmed = names;
    options.onWarm();
    const params = options.build(options.dateRange());
    for (const name of names) {
      await idle();
      if (current !== epoch) return;
      await options.prefetch(name, params);
    }
  }

  /** After a reindex: warm again whatever was warmed before. */
  function rewarm() {
    if (warmed.length) void warm(warmed);
  }

  function reset() {
    cancel();
    epoch += 1;
    warmed = [];
  }

  return { prefetchNearby, cancel, warm, rewarm, reset };
}
