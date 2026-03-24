import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useCachedFetch } from '@/composables/useCachedFetch';

describe('useCachedFetch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('initializes with null data, no loading, and no error', () => {
      const fetcher = vi.fn().mockResolvedValue({ data: 'test' });
      const { data, loading, error } = useCachedFetch({ fetcher });

      expect(data.value).toBe(null);
      expect(loading.value).toBe(false);
      expect(error.value).toBe(null);
    });
  });

  describe('successful fetch', () => {
    it('fetches data successfully and updates state', async () => {
      const mockData = { value: 'test', count: 42 };
      const fetcher = vi.fn().mockResolvedValue(mockData);
      const { data, loading, error, fetch } = useCachedFetch({ fetcher });

      expect(loading.value).toBe(false);
      expect(data.value).toBe(null);

      await fetch(undefined);

      expect(loading.value).toBe(false);
      expect(data.value).toEqual(mockData);
      expect(error.value).toBe(null);
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('sets loading state during fetch', async () => {
      let resolvePromise: (value: any) => void;
      const fetcher = vi.fn(() => new Promise((resolve) => { resolvePromise = resolve; }));
      const { loading, fetch } = useCachedFetch({ fetcher });

      expect(loading.value).toBe(false);

      const fetchPromise = fetch(undefined);
      expect(loading.value).toBe(true);

      resolvePromise!({ data: 'test' });
      await fetchPromise;

      expect(loading.value).toBe(false);
    });

    it('passes parameters to fetcher function', async () => {
      interface Params { id: number; name: string }
      const fetcher = vi.fn().mockResolvedValue({ result: 'ok' });
      const { fetch } = useCachedFetch<any, Params>({ fetcher });

      await fetch({ id: 123, name: 'test' });

      expect(fetcher).toHaveBeenCalledWith({ id: 123, name: 'test' });
    });
  });

  describe('error handling', () => {
    it('handles Error instances', async () => {
      const fetcher = vi.fn().mockRejectedValue(new Error('Network error'));
      const { data, error, loading, fetch } = useCachedFetch({ fetcher });

      await fetch(undefined);

      expect(data.value).toBe(null);
      expect(error.value).toBe('Network error');
      expect(loading.value).toBe(false);
    });

    it('handles non-Error rejection values', async () => {
      const fetcher = vi.fn().mockRejectedValue('string error');
      const { error, fetch } = useCachedFetch({ fetcher });

      await fetch(undefined);

      expect(error.value).toBe('string error');
    });

    it('handles object rejection values', async () => {
      const fetcher = vi.fn().mockRejectedValue({ message: 'object error', code: 500 });
      const { error, fetch } = useCachedFetch({ fetcher });

      await fetch(undefined);

      expect(error.value).toBe('[object Object]');
    });

    it('clears previous error on successful retry', async () => {
      const fetcher = vi.fn()
        .mockRejectedValueOnce(new Error('First fail'))
        .mockResolvedValueOnce({ data: 'success' });
      const { data, error, fetch } = useCachedFetch({ fetcher });

      await fetch({ id: 1 });
      expect(error.value).toBe('First fail');

      await fetch({ id: 1 }, { force: true });
      expect(error.value).toBe(null);
      expect(data.value).toEqual({ data: 'success' });
    });
  });

  describe('caching', () => {
    it('caches results and does not refetch', async () => {
      const fetcher = vi.fn().mockResolvedValue({ data: 'test' });
      const { fetch } = useCachedFetch({ fetcher });

      await fetch({ id: 1 });
      await fetch({ id: 1 }); // Should use cache

      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('fetches again for different parameters', async () => {
      const fetcher = vi.fn()
        .mockResolvedValueOnce({ data: 'first' })
        .mockResolvedValueOnce({ data: 'second' });
      const { data, fetch } = useCachedFetch({ fetcher });

      await fetch({ id: 1 });
      expect(data.value).toEqual({ data: 'first' });

      await fetch({ id: 2 });
      expect(data.value).toEqual({ data: 'second' });
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('uses custom cache key function', async () => {
      const fetcher = vi.fn().mockResolvedValue({ data: 'test' });
      const cacheKeyFn = vi.fn((params: { id: number }) => `key-${params.id}`);
      const { fetch } = useCachedFetch({ fetcher, cacheKeyFn });

      await fetch({ id: 1 });
      await fetch({ id: 1 });

      expect(cacheKeyFn).toHaveBeenCalledTimes(2);
      expect(cacheKeyFn).toHaveBeenCalledWith({ id: 1 });
      expect(fetcher).toHaveBeenCalledTimes(1); // Cached
    });

    it('force refetch bypasses cache', async () => {
      const fetcher = vi.fn()
        .mockResolvedValueOnce({ data: 'first' })
        .mockResolvedValueOnce({ data: 'second' });
      const { data, fetch } = useCachedFetch({ fetcher });

      await fetch({ id: 1 });
      expect(data.value).toEqual({ data: 'first' });

      await fetch({ id: 1 }); // Cached
      expect(fetcher).toHaveBeenCalledTimes(1);

      await fetch({ id: 1 }, { force: true }); // Force refetch
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(data.value).toEqual({ data: 'second' });
    });

    it('isCached returns correct status', async () => {
      const fetcher = vi.fn().mockResolvedValue({ data: 'test' });
      const { fetch, isCached } = useCachedFetch({ fetcher });

      expect(isCached({ id: 1 })).toBe(false);

      await fetch({ id: 1 });
      expect(isCached({ id: 1 })).toBe(true);
      expect(isCached({ id: 2 })).toBe(false);
    });

    it('clearCache removes cache entries', async () => {
      const fetcher = vi.fn()
        .mockResolvedValueOnce({ data: 'first' })
        .mockResolvedValueOnce({ data: 'second' });
      const { fetch, isCached, clearCache } = useCachedFetch({ fetcher });

      await fetch({ id: 1 });
      expect(isCached({ id: 1 })).toBe(true);

      clearCache();
      expect(isCached({ id: 1 })).toBe(false);

      await fetch({ id: 1 }); // Should refetch
      expect(fetcher).toHaveBeenCalledTimes(2);
    });
  });

  describe('request deduplication', () => {
    it('deduplicates concurrent requests for same parameters', async () => {
      let resolvePromise: (value: any) => void;
      const fetcher = vi.fn(() => new Promise((resolve) => { resolvePromise = resolve; }));
      const { fetch } = useCachedFetch<any, { id: number }>({ fetcher });

      const promise1 = fetch({ id: 1 });
      const promise2 = fetch({ id: 1 });
      const promise3 = fetch({ id: 1 });

      expect(fetcher).toHaveBeenCalledTimes(1);

      resolvePromise!({ data: 'test' });
      await Promise.all([promise1, promise2, promise3]);

      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('does not deduplicate requests for different parameters', async () => {
      let resolvers: Array<(value: any) => void> = [];
      const fetcher = vi.fn(() => new Promise((resolve) => resolvers.push(resolve)));
      const { fetch } = useCachedFetch<any, { id: number }>({ fetcher });

      const promise1 = fetch({ id: 1 });
      const promise2 = fetch({ id: 2 });

      expect(fetcher).toHaveBeenCalledTimes(2);

      resolvers[0]({ data: 'first' });
      resolvers[1]({ data: 'second' });
      await Promise.all([promise1, promise2]);
    });

    it('allows new request after previous completes', async () => {
      const fetcher = vi.fn()
        .mockResolvedValueOnce({ data: 'first' })
        .mockResolvedValueOnce({ data: 'second' });
      const { fetch } = useCachedFetch({ fetcher });

      await fetch({ id: 1 });
      await fetch({ id: 1 }, { force: true });

      expect(fetcher).toHaveBeenCalledTimes(2);
    });
  });

  describe('generation-based stale request prevention', () => {
    it('prevents stale writes when newer request completes first', async () => {
      let resolvers: Array<(value: any) => void> = [];
      const fetcher = vi.fn(() => new Promise((resolve) => resolvers.push(resolve)));
      const { data, fetch } = useCachedFetch<any, { id: number }>({ fetcher });

      // Start first request
      const req1 = fetch({ id: 1 });
      // Start second request (newer generation)
      const req2 = fetch({ id: 2 });

      expect(fetcher).toHaveBeenCalledTimes(2);

      // Resolve second request first
      resolvers[1]({ value: 'second' });
      await req2;
      expect(data.value).toEqual({ value: 'second' });

      // Resolve first request (should be ignored as stale)
      resolvers[0]({ value: 'first' });
      await req1;

      // Data should still be from second request
      expect(data.value).toEqual({ value: 'second' });
    });

    it('prevents stale error writes', async () => {
      let resolvers: Array<{ resolve: (v: any) => void; reject: (e: any) => void }> = [];
      const fetcher = vi.fn(() => new Promise((resolve, reject) => {
        resolvers.push({ resolve, reject });
      }));
      const { error, data, fetch } = useCachedFetch<any, { id: number }>({ fetcher });

      const req1 = fetch({ id: 1 });
      const req2 = fetch({ id: 2 });

      // Second request succeeds
      resolvers[1].resolve({ value: 'success' });
      await req2;
      expect(data.value).toEqual({ value: 'success' });
      expect(error.value).toBe(null);

      // First request fails (should be ignored)
      resolvers[0].reject(new Error('stale error'));
      await req1;

      // Error should not be set
      expect(error.value).toBe(null);
      expect(data.value).toEqual({ value: 'success' });
    });

    it('prevents stale loading state updates', async () => {
      let resolvers: Array<(value: any) => void> = [];
      const fetcher = vi.fn(() => new Promise((resolve) => resolvers.push(resolve)));
      const { loading, fetch } = useCachedFetch<any, { id: number }>({ fetcher });

      const req1 = fetch({ id: 1 });
      expect(loading.value).toBe(true);

      const req2 = fetch({ id: 2 });
      expect(loading.value).toBe(true);

      // Complete second request
      resolvers[1]({ value: 'second' });
      await req2;
      expect(loading.value).toBe(false);

      // Complete first request (stale)
      resolvers[0]({ value: 'first' });
      await req1;

      // Loading should remain false
      expect(loading.value).toBe(false);
    });
  });

  describe('reset', () => {
    it('resets all state to initial values', async () => {
      const fetcher = vi.fn().mockResolvedValue({ data: 'test' });
      const { data, error, loading, fetch, reset } = useCachedFetch<any, { id: number }>({ fetcher });

      await fetch({ id: 1 });
      expect(data.value).toEqual({ data: 'test' });

      reset();

      expect(data.value).toBe(null);
      expect(loading.value).toBe(false);
      expect(error.value).toBe(null);
    });

    it('clears cache so next fetch refetches', async () => {
      const fetcher = vi.fn().mockResolvedValue({ data: 'test' });
      const { fetch, reset, isCached } = useCachedFetch<any, { id: number }>({ fetcher });

      await fetch({ id: 1 });
      expect(isCached({ id: 1 })).toBe(true);

      reset();
      expect(isCached({ id: 1 })).toBe(false);

      await fetch({ id: 1 });
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('increments generation to prevent stale writes after reset', async () => {
      let resolvers: Array<(value: any) => void> = [];
      const fetcher = vi.fn(() => new Promise((resolve) => resolvers.push(resolve)));
      const { data, fetch, reset } = useCachedFetch<any, { id: number }>({ fetcher });

      const req1 = fetch({ id: 1 });

      reset();

      // Complete request started before reset (should be ignored)
      resolvers[0]({ value: 'stale' });
      await req1;

      expect(data.value).toBe(null);
    });
  });

  describe('type safety', () => {
    it('enforces correct data type', async () => {
      interface MyData { name: string; count: number }
      const mockData: MyData = { name: 'test', count: 42 };
      const fetcher = vi.fn().mockResolvedValue(mockData);
      const { data, fetch } = useCachedFetch<MyData>({ fetcher });

      await fetch(undefined);

      expect(data.value).toEqual(mockData);
      // TypeScript will enforce that data.value is MyData | null
    });

    it('enforces correct parameter type', async () => {
      interface MyParams { id: number; filter?: string }
      const fetcher = vi.fn().mockResolvedValue({ result: 'ok' });
      const { fetch } = useCachedFetch<any, MyParams>({ fetcher });

      await fetch({ id: 1 });
      await fetch({ id: 2, filter: 'test' });

      expect(fetcher).toHaveBeenCalledWith({ id: 1 });
      expect(fetcher).toHaveBeenCalledWith({ id: 2, filter: 'test' });
    });
  });

  describe('edge cases', () => {
    it('handles void parameters correctly', async () => {
      const fetcher = vi.fn().mockResolvedValue({ data: 'test' });
      const { fetch } = useCachedFetch<any, void>({ fetcher });

      await fetch(undefined);
      await fetch(undefined); // Should use cache

      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('handles empty object parameters', async () => {
      const fetcher = vi.fn().mockResolvedValue({ data: 'test' });
      const { fetch } = useCachedFetch({ fetcher });

      await fetch({});
      await fetch({}); // Should use cache (same cache key)

      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('handles null values in parameters', async () => {
      interface Params { id: number | null; name?: string }
      const fetcher = vi.fn().mockResolvedValue({ data: 'test' });
      const { fetch } = useCachedFetch<any, Params>({ fetcher });

      await fetch({ id: null });
      await fetch({ id: null }); // Should use cache

      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('handles undefined values in parameters', async () => {
      interface Params { id?: number; name?: string }
      const fetcher = vi.fn().mockResolvedValue({ data: 'test' });
      const { fetch } = useCachedFetch<any, Params>({ fetcher });

      await fetch({ id: undefined, name: undefined });
      await fetch({ id: undefined, name: undefined }); // Should use cache (same as above)

      // JSON.stringify removes undefined properties, so both calls produce same cache key
      expect(fetcher).toHaveBeenCalledTimes(1);
    });
  });
});
