import { toErrorMessage } from '@tracepilot/ui';
import { ref, type Ref } from 'vue';
import { toErrorMessage } from '@tracepilot/ui';

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
}

/**
 * Result interface for the cached fetch composable.
 */
export interface CachedFetchResult<TData, TParams> {
  /** Reactive data state */
  data: Ref<TData | null>;

  /** Reactive loading state */
  loading: Ref<boolean>;

  /** Reactive error state (error message string) */
  error: Ref<string | null>;

  /**
   * Fetch data with the given parameters.
   * @param params - Parameters to pass to the fetcher function
   * @param options - Additional options (e.g., force refresh)
   */
  fetch: (params: TParams, options?: { force?: boolean }) => Promise<void>;

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
  const { fetcher, cacheKeyFn = (p) => JSON.stringify(p) } = options;

  // Reactive state
  const data = ref<TData | null>(null) as Ref<TData | null>;
  const loading = ref(false);
  const error = ref<string | null>(null);

  // Cache tracking: which cache keys have been successfully loaded
  const loaded = new Set<string>();

  // In-flight promise tracking: deduplicate concurrent requests
  const inflight = new Map<string, Promise<void>>();

  // Generation counter: prevent stale async writes
  let generation = 0;

  /**
   * Fetch data with the given parameters.
   */
  const fetch = async (params: TParams, opts?: { force?: boolean }): Promise<void> => {
    const cacheKey = cacheKeyFn(params);

    // Return early if cached and not forced
    if (!opts?.force && loaded.has(cacheKey)) {
      return;
    }

    // Deduplicate: return existing promise if already in-flight
    const existingPromise = inflight.get(cacheKey);
    if (existingPromise) {
      return existingPromise;
    }

    // Start new fetch
    const gen = ++generation;
    loading.value = true;
    error.value = null;

    const promise = (async () => {
      try {
        const result = await fetcher(params);

        // Only update if this is still the latest request
        if (gen !== generation) return;

        data.value = result as TData;
        loaded.add(cacheKey);
      } catch (e) {
        // Only update error if this is still the latest request
        if (gen !== generation) return;

        error.value = toErrorMessage(e);
      } finally {
        // Clean up inflight tracking
        inflight.delete(cacheKey);

        // Only update loading if this is still the latest request
        if (gen === generation) {
          loading.value = false;
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
    data.value = null;
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
    return loaded.has(cacheKeyFn(params));
  };

  /**
   * Clear the cache without resetting data/loading/error state.
   */
  const clearCache = () => {
    loaded.clear();
  };

  return {
    data,
    loading,
    error,
    fetch,
    reset,
    isCached,
    clearCache,
  };
}
