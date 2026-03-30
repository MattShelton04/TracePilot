import { toErrorMessage } from "@tracepilot/ui";
import { type Ref, readonly, ref } from "vue";
import { logError } from "@/utils/logger";

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

  // Cache tracking: which cache keys have been successfully loaded
  const loaded = new Set<string>();

  // In-flight promise tracking: deduplicate concurrent requests
  const inflight = new Map<string, Promise<TData | undefined>>();

  // Generation counter: prevent stale async writes
  let generation = 0;

  /**
   * Fetch data with the given parameters.
   */
  const fetch = async (params: TParams, opts?: { force?: boolean }): Promise<TData | undefined> => {
    const cacheKey = cacheKeyFn(params);

    // Return early if cached and not forced
    if (cache && !opts?.force && loaded.has(cacheKey)) {
      return data.value ?? undefined;
    }

    // Deduplicate: return existing promise if already in-flight
    const existingPromise = inflight.get(cacheKey);
    if (existingPromise) {
      return existingPromise;
    }

    // Start new fetch
    const gen = ++generation;
    if (!silent) {
      loading.value = true;
    }
    error.value = null;

    const promise = (async () => {
      try {
        const result = await fetcher(params);

        // Only update if this is still the latest request
        if (gen !== generation) return undefined;

        data.value = result as TData;
        if (cache) {
          loaded.add(cacheKey);
        }

        // Call onSuccess with try-catch to prevent callback errors from breaking state
        if (onSuccess) {
          try {
            onSuccess(result);
          } catch (callbackError) {
            logError("[useCachedFetch] onSuccess callback error:", callbackError);
          }
        }

        return result;
      } catch (e) {
        // Only update error if this is still the latest request
        if (gen !== generation) return undefined;

        const errorMsg = toErrorMessage(e);
        error.value = errorMsg;

        if (resetOnError) {
          data.value = initialData;
        }

        // Call onError with try-catch
        if (onError) {
          try {
            onError(errorMsg);
          } catch (callbackError) {
            logError("[useCachedFetch] onError callback error:", callbackError);
          }
        }

        return undefined;
      } finally {
        // Clean up inflight tracking
        inflight.delete(cacheKey);

        // Only update loading and call onFinally if this is still the latest request
        if (gen === generation) {
          if (!silent) {
            loading.value = false;
          }

          // Call onFinally with try-catch
          if (onFinally) {
            try {
              onFinally();
            } catch (callbackError) {
              logError("[useCachedFetch] onFinally callback error:", callbackError);
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
    loaded.clear();
    inflight.clear();
    generation++;
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
