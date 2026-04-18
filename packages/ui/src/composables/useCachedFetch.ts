import { type Ref, readonly, ref } from "vue";
import { toErrorMessage } from "../utils/formatters";

/**
 * Options for configuring the cached fetch composable.
 */
export interface CachedFetchOptions<TData, TParams> {
  /**
   * The async function to execute for fetching data.
   */
  fetcher: (params: TParams) => Promise<TData>;

  /**
   * Optional function to generate a cache key from parameters.
   * Defaults to JSON.stringify(params).
   */
  cacheKeyFn?: (params: TParams) => string;

  /**
   * Optional callback fired on successful fetch (only for non-stale requests).
   */
  onSuccess?: (data: TData) => void;

  /**
   * Optional callback fired on error (only for non-stale requests).
   */
  onError?: (error: string) => void;

  /**
   * Optional callback fired after fetch completes, success or error (only for non-stale requests).
   */
  onFinally?: () => void;

  /**
   * Initial data value. Defaults to null.
   */
  initialData?: TData | null;

  /**
   * Whether to reset data to null on error. Defaults to false.
   */
  resetOnError?: boolean;

  /**
   * Silent mode: don't update loading state. Useful for background refreshes.
   * Defaults to false.
   */
  silent?: boolean;

  /**
   * Whether to cache results. Defaults to true.
   * Set to false for always-fresh fetches.
   */
  cache?: boolean;
}

/**
 * Result interface for the cached fetch composable.
 */
export interface CachedFetchResult<TData, TParams> {
  /** Reactive data state (readonly - cannot be mutated externally) */
  readonly data: Readonly<Ref<TData | null>>;

  /** Reactive loading state (readonly - cannot be mutated externally) */
  readonly loading: Readonly<Ref<boolean>>;

  /** Reactive error state (readonly - cannot be mutated externally) */
  readonly error: Readonly<Ref<string | null>>;

  /**
   * Fetch data with the given parameters.
   * @param params - Parameters to pass to the fetcher function
   * @param options - Additional options (e.g., force refresh)
   * @returns The fetched data, or undefined if the request became stale or errored
   */
  fetch: (params: TParams, options?: { force?: boolean }) => Promise<TData | undefined>;

  /**
   * Reset all state to initial values and clear cache.
   */
  reset: () => void;

  /**
   * Check if data for the given parameters is cached.
   * @param params - Parameters to check
   */
  isCached: (params: TParams) => boolean;

  /**
   * Clear the cache without resetting data/loading/error state.
   */
  clearCache: () => void;
}

/**
 * A composable for managing cached async data fetching with request deduplication
 * and generation-based stale request prevention.
 *
 * Features:
 * - Request deduplication: concurrent requests for the same cache key return the same promise
 * - Generation tracking: prevents stale async writes from earlier requests
 * - Caching: results are cached by parameters to avoid redundant fetches
 * - Type-safe: full TypeScript support with generics
 *
 * @template TData - The type of data returned by the fetcher
 * @template TParams - The type of parameters accepted by the fetcher
 *
 * @param options - Configuration options
 * @returns An object containing reactive state and fetch methods
 *
 * @example
 * ```ts
 * interface MyData { value: string }
 * interface MyParams { id: number }
 *
 * const { data, loading, error, fetch } = useCachedFetch<MyData, MyParams>({
 *   fetcher: (params) => api.getData(params.id),
 *   cacheKeyFn: (params) => `data:${params.id}`,
 * });
 *
 * await fetch({ id: 1 }); // First call fetches
 * await fetch({ id: 1 }); // Second call uses cache
 * await fetch({ id: 1 }, { force: true }); // Force refetch
 * ```
 */
export function useCachedFetch<TData, TParams = void>(
  options: CachedFetchOptions<TData, TParams>,
): CachedFetchResult<TData, TParams> {
  const {
    fetcher,
    cacheKeyFn = (p) => JSON.stringify(p),
    onSuccess,
    onError,
    onFinally,
    initialData = null,
    resetOnError = false,
    silent = false,
    cache = true,
  } = options;

  // Reactive state
  const data = ref<TData | null>(initialData) as Ref<TData | null>;
  const loading = ref(false);
  const error = ref<string | null>(null);

  // Cache tracking: which cache keys have been successfully loaded and their data
  const cacheData = new Map<string, TData | null>();
  const loaded = new Set<string>();

  // In-flight promise tracking: deduplicate concurrent requests
  const inflight = new Map<string, Promise<TData | undefined>>();

  // Per-key generation counter: prevent stale async writes while preserving multi-key cache
  const keyGenerations = new Map<string, number>();

  // Monotonic epoch counter — incremented on reset() to invalidate all pre-reset generations
  let resetEpoch = 0;

  // Track the currently active request so only the newest invocation updates shared state
  let activeKey: string | null = null;
  let activeGeneration = 0;
  let activeEpoch = 0;

  /**
   * Fetch data with the given parameters.
   */
  const fetch = async (params: TParams, opts?: { force?: boolean }): Promise<TData | undefined> => {
    const cacheKey = cacheKeyFn(params);

    // Return cached data when available
    if (cache && !opts?.force && loaded.has(cacheKey)) {
      activeKey = cacheKey;
      activeGeneration = keyGenerations.get(cacheKey) ?? 0;
      activeEpoch = resetEpoch;
      const cachedValue = cacheData.get(cacheKey) ?? null;
      error.value = null;
      if (!silent) {
        loading.value = false;
      }
      data.value = cachedValue;
      return cachedValue ?? undefined;
    }

    // Deduplicate: return existing promise if already in-flight
    const existingPromise = inflight.get(cacheKey);
    if (existingPromise) {
      // Update active tracking so when the promise resolves, it updates shared state
      activeKey = cacheKey;
      activeGeneration = keyGenerations.get(cacheKey) ?? 0;
      activeEpoch = resetEpoch;
      return existingPromise;
    }

    // Start new fetch
    const epoch = resetEpoch;
    const gen = (keyGenerations.get(cacheKey) ?? 0) + 1;
    keyGenerations.set(cacheKey, gen);
    activeKey = cacheKey;
    activeGeneration = gen;
    activeEpoch = epoch;
    if (!silent) {
      loading.value = true;
    }
    error.value = null;

    const promise = (async () => {
      try {
        const result = await fetcher(params);

        // Stale if a newer request was made for this key, or a reset occurred
        if (epoch !== resetEpoch || gen !== keyGenerations.get(cacheKey)) return undefined;

        // Only write to cache when caching is enabled
        if (cache) {
          cacheData.set(cacheKey, result ?? null);
          loaded.add(cacheKey);
        }

        const isActive = activeKey === cacheKey && activeGeneration === gen && activeEpoch === epoch;
        if (isActive) {
          data.value = result as TData;
          error.value = null;
        }

        // Call onSuccess with try-catch to prevent callback errors from breaking state
        if (isActive && onSuccess) {
          try {
            onSuccess(result);
          } catch (callbackError) {
            console.error("[useCachedFetch] onSuccess callback error:", callbackError);
          }
        }

        return result;
      } catch (e) {
        // Stale if a newer request was made for this key, or a reset occurred
        if (epoch !== resetEpoch || gen !== keyGenerations.get(cacheKey)) return undefined;

        const errorMsg = toErrorMessage(e);
        const isActive = activeKey === cacheKey && activeGeneration === gen && activeEpoch === epoch;
        if (isActive) {
          error.value = errorMsg;

          if (resetOnError) {
            data.value = initialData;
          }
        }

        // Call onError with try-catch
        if (isActive && onError) {
          try {
            onError(errorMsg);
          } catch (callbackError) {
            console.error("[useCachedFetch] onError callback error:", callbackError);
          }
        }

        return undefined;
      } finally {
        // Clean up inflight tracking
        inflight.delete(cacheKey);

        // Only update loading and call onFinally if this is still the latest request for this key
        if (activeKey === cacheKey && activeGeneration === gen && activeEpoch === epoch) {
          if (!silent) {
            loading.value = false;
          }

          // Call onFinally with try-catch
          if (onFinally) {
            try {
              onFinally();
            } catch (callbackError) {
              console.error("[useCachedFetch] onFinally callback error:", callbackError);
            }
          }
        }
      }
    })();

    inflight.set(cacheKey, promise);
    return promise;
  };

  /**
   * Reset all state to initial values and clear cache.
   */
  const reset = () => {
    data.value = initialData;
    loading.value = false;
    error.value = null;
    cacheData.clear();
    loaded.clear();
    inflight.clear();
    keyGenerations.clear();
    resetEpoch++;
    activeKey = null;
    activeGeneration = 0;
    activeEpoch = resetEpoch;
  };

  /**
   * Check if data for the given parameters is cached.
   */
  const isCached = (params: TParams): boolean => {
    return cache && loaded.has(cacheKeyFn(params));
  };

  /**
   * Clear the cache without resetting data/loading/error state.
   */
  const clearCache = () => {
    cacheData.clear();
    loaded.clear();
  };

  return {
    data: readonly(data) as unknown as Readonly<Ref<TData | null>>,
    loading: readonly(loading),
    error: readonly(error),
    fetch,
    reset,
    isCached,
    clearCache,
  };
}
