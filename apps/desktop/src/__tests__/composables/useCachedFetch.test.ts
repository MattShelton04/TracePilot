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

      expect(error.value).toBe('object error');
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

  describe('lifecycle hooks', () => {
    it('calls onSuccess with fetched data for successful requests', async () => {
      const mockData = { value: 'test' };
      const fetcher = vi.fn().mockResolvedValue(mockData);
      const onSuccess = vi.fn();
      const { fetch } = useCachedFetch({ fetcher, onSuccess });

      await fetch(undefined);

      expect(onSuccess).toHaveBeenCalledTimes(1);
      expect(onSuccess).toHaveBeenCalledWith(mockData);
    });

    it('calls onError with error message for failed requests', async () => {
      const fetcher = vi.fn().mockRejectedValue(new Error('Network error'));
      const onError = vi.fn();
      const { fetch } = useCachedFetch({ fetcher, onError });

      await fetch(undefined);

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith('Network error');
    });

    it('calls onFinally after successful requests', async () => {
      const fetcher = vi.fn().mockResolvedValue({ data: 'test' });
      const onFinally = vi.fn();
      const { fetch } = useCachedFetch({ fetcher, onFinally });

      await fetch(undefined);

      expect(onFinally).toHaveBeenCalledTimes(1);
    });

    it('calls onFinally after failed requests', async () => {
      const fetcher = vi.fn().mockRejectedValue(new Error('fail'));
      const onFinally = vi.fn();
      const { fetch } = useCachedFetch({ fetcher, onFinally });

      await fetch(undefined);

      expect(onFinally).toHaveBeenCalledTimes(1);
    });

    it('does not call onSuccess for stale requests', async () => {
      let resolvers: Array<(value: any) => void> = [];
      const fetcher = vi.fn(() => new Promise((resolve) => resolvers.push(resolve)));
      const onSuccess = vi.fn();
      const { fetch } = useCachedFetch<any, { id: number }>({ fetcher, onSuccess });

      const req1 = fetch({ id: 1 });
      const req2 = fetch({ id: 2 });

      // Complete second request first
      resolvers[1]({ value: 'second' });
      await req2;
      expect(onSuccess).toHaveBeenCalledTimes(1);
      expect(onSuccess).toHaveBeenCalledWith({ value: 'second' });

      // Complete first request (stale)
      resolvers[0]({ value: 'first' });
      await req1;

      // onSuccess should not have been called again
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });

    it('does not call onError for stale requests', async () => {
      let resolvers: Array<{ resolve: (v: any) => void; reject: (e: any) => void }> = [];
      const fetcher = vi.fn(() => new Promise((resolve, reject) => {
        resolvers.push({ resolve, reject });
      }));
      const onError = vi.fn();
      const { fetch } = useCachedFetch<any, { id: number }>({ fetcher, onError });

      const req1 = fetch({ id: 1 });
      const req2 = fetch({ id: 2 });

      // Second request succeeds
      resolvers[1].resolve({ value: 'success' });
      await req2;
      expect(onError).not.toHaveBeenCalled();

      // First request fails (stale)
      resolvers[0].reject(new Error('stale error'));
      await req1;

      // onError should not have been called
      expect(onError).not.toHaveBeenCalled();
    });

    it('does not call onFinally for stale requests', async () => {
      let resolvers: Array<(value: any) => void> = [];
      const fetcher = vi.fn(() => new Promise((resolve) => resolvers.push(resolve)));
      const onFinally = vi.fn();
      const { fetch } = useCachedFetch<any, { id: number }>({ fetcher, onFinally });

      const req1 = fetch({ id: 1 });
      const req2 = fetch({ id: 2 });

      // Complete second request
      resolvers[1]({ value: 'second' });
      await req2;
      expect(onFinally).toHaveBeenCalledTimes(1);

      // Complete first request (stale)
      resolvers[0]({ value: 'first' });
      await req1;

      // onFinally should not have been called again
      expect(onFinally).toHaveBeenCalledTimes(1);
    });

    it('handles onSuccess throwing an error gracefully', async () => {
      const fetcher = vi.fn().mockResolvedValue({ data: 'test' });
      const onSuccess = vi.fn(() => {
        throw new Error('Callback error');
      });
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { data, error, fetch } = useCachedFetch({ fetcher, onSuccess });

      await fetch(undefined);

      // Data should still be set despite callback error
      expect(data.value).toEqual({ data: 'test' });
      expect(error.value).toBe(null);
      expect(onSuccess).toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('onSuccess'),
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });

    it('handles onError throwing an error gracefully', async () => {
      const fetcher = vi.fn().mockRejectedValue(new Error('fetch failed'));
      const onError = vi.fn(() => {
        throw new Error('Callback error');
      });
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { error, fetch } = useCachedFetch({ fetcher, onError });

      await fetch(undefined);

      // Error should still be set despite callback error
      expect(error.value).toBe('fetch failed');
      expect(onError).toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('onError'),
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });

    it('handles onFinally throwing an error gracefully', async () => {
      const fetcher = vi.fn().mockResolvedValue({ data: 'test' });
      const onFinally = vi.fn(() => {
        throw new Error('Callback error');
      });
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { data, fetch } = useCachedFetch({ fetcher, onFinally });

      await fetch(undefined);

      // Data should still be set despite callback error
      expect(data.value).toEqual({ data: 'test' });
      expect(onFinally).toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('onFinally'),
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe('initialData option', () => {
    it('initializes with provided initial data', () => {
      const initialData = { value: 'initial' };
      const fetcher = vi.fn().mockResolvedValue({ value: 'new' });
      const { data } = useCachedFetch({ fetcher, initialData });

      expect(data.value).toEqual(initialData);
    });

    it('replaces initial data after successful fetch', async () => {
      const initialData = { value: 'initial' };
      const newData = { value: 'new' };
      const fetcher = vi.fn().mockResolvedValue(newData);
      const { data, fetch } = useCachedFetch({ fetcher, initialData });

      expect(data.value).toEqual(initialData);

      await fetch(undefined);

      expect(data.value).toEqual(newData);
    });

    it('resets to initial data after reset()', async () => {
      const initialData = { value: 'initial' };
      const fetcher = vi.fn().mockResolvedValue({ value: 'new' });
      const { data, fetch, reset } = useCachedFetch({ fetcher, initialData });

      await fetch(undefined);
      expect(data.value).toEqual({ value: 'new' });

      reset();

      expect(data.value).toEqual(initialData);
    });
  });

  describe('resetOnError option', () => {
    it('clears data on error when resetOnError is true', async () => {
      const fetcher = vi.fn().mockResolvedValue({ data: 'success' });
      const { data, fetch } = useCachedFetch({ fetcher, resetOnError: true });

      await fetch({ id: 1 });
      expect(data.value).toEqual({ data: 'success' });

      // Reconfigure to fail
      fetcher.mockRejectedValueOnce(new Error('fail'));
      await fetch({ id: 2 });

      expect(data.value).toBe(null);
    });

    it('preserves data on error when resetOnError is false', async () => {
      const fetcher = vi.fn().mockResolvedValue({ data: 'success' });
      const { data, fetch } = useCachedFetch({ fetcher, resetOnError: false });

      await fetch({ id: 1 });
      expect(data.value).toEqual({ data: 'success' });

      fetcher.mockRejectedValueOnce(new Error('fail'));
      await fetch({ id: 2 });

      // Data should still be from first successful request
      expect(data.value).toEqual({ data: 'success' });
    });

    it('resets to initialData on error when resetOnError is true', async () => {
      const initialData = { value: 'initial' };
      const fetcher = vi.fn().mockRejectedValue(new Error('fail'));
      const { data, fetch } = useCachedFetch({ fetcher, initialData, resetOnError: true });

      expect(data.value).toEqual(initialData);

      await fetch(undefined);

      expect(data.value).toEqual(initialData);
    });
  });

  describe('silent mode', () => {
    it('does not update loading state when silent is true', async () => {
      let resolvePromise: (value: any) => void;
      const fetcher = vi.fn(() => new Promise((resolve) => { resolvePromise = resolve; }));
      const { loading, fetch } = useCachedFetch({ fetcher, silent: true });

      expect(loading.value).toBe(false);

      const fetchPromise = fetch(undefined);
      expect(loading.value).toBe(false); // Should stay false

      resolvePromise!({ data: 'test' });
      await fetchPromise;

      expect(loading.value).toBe(false);
    });

    it('still updates data in silent mode', async () => {
      const mockData = { value: 'test' };
      const fetcher = vi.fn().mockResolvedValue(mockData);
      const { data, fetch } = useCachedFetch({ fetcher, silent: true });

      await fetch(undefined);

      expect(data.value).toEqual(mockData);
    });

    it('still updates error in silent mode', async () => {
      const fetcher = vi.fn().mockRejectedValue(new Error('Network error'));
      const { error, fetch } = useCachedFetch({ fetcher, silent: true });

      await fetch(undefined);

      expect(error.value).toBe('Network error');
    });

    it('still calls callbacks in silent mode', async () => {
      const onSuccess = vi.fn();
      const onFinally = vi.fn();
      const fetcher = vi.fn().mockResolvedValue({ data: 'test' });
      const { fetch } = useCachedFetch({ fetcher, silent: true, onSuccess, onFinally });

      await fetch(undefined);

      expect(onSuccess).toHaveBeenCalled();
      expect(onFinally).toHaveBeenCalled();
    });
  });

  describe('cache control', () => {
    it('does not cache results when cache is false', async () => {
      const fetcher = vi.fn()
        .mockResolvedValueOnce({ data: 'first' })
        .mockResolvedValueOnce({ data: 'second' });
      const { fetch, isCached } = useCachedFetch({ fetcher, cache: false });

      await fetch({ id: 1 });
      expect(isCached({ id: 1 })).toBe(false);

      await fetch({ id: 1 }); // Should refetch
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('returns cached data when cache is false and force is false', async () => {
      const mockData = { data: 'test' };
      const fetcher = vi.fn().mockResolvedValue(mockData);
      const { data, fetch } = useCachedFetch({ fetcher, cache: false });

      await fetch(undefined);
      expect(data.value).toEqual(mockData);

      const result = await fetch(undefined);
      expect(result).toEqual(mockData); // Returns current data
      expect(fetcher).toHaveBeenCalledTimes(2); // But fetches again
    });
  });

  describe('return value from fetch', () => {
    it('returns fetched data on successful fetch', async () => {
      const mockData = { value: 'test' };
      const fetcher = vi.fn().mockResolvedValue(mockData);
      const { fetch } = useCachedFetch({ fetcher });

      const result = await fetch(undefined);

      expect(result).toEqual(mockData);
    });

    it('returns undefined on error', async () => {
      const fetcher = vi.fn().mockRejectedValue(new Error('fail'));
      const { fetch } = useCachedFetch({ fetcher });

      const result = await fetch(undefined);

      expect(result).toBeUndefined();
    });

    it('returns undefined for stale requests', async () => {
      let resolvers: Array<(value: any) => void> = [];
      const fetcher = vi.fn(() => new Promise((resolve) => resolvers.push(resolve)));
      const { fetch } = useCachedFetch<any, { id: number }>({ fetcher });

      const req1 = fetch({ id: 1 });
      const req2 = fetch({ id: 2 });

      // Complete second request first
      resolvers[1]({ value: 'second' });
      const result2 = await req2;
      expect(result2).toEqual({ value: 'second' });

      // Complete first request (stale)
      resolvers[0]({ value: 'first' });
      const result1 = await req1;
      expect(result1).toBeUndefined();
    });

    it('returns cached data when using cache hit', async () => {
      const mockData = { value: 'test' };
      const fetcher = vi.fn().mockResolvedValue(mockData);
      const { fetch } = useCachedFetch({ fetcher });

      await fetch(undefined);
      const result = await fetch(undefined); // Cache hit

      expect(result).toEqual(mockData);
      expect(fetcher).toHaveBeenCalledTimes(1);
    });
  });

  describe('readonly protection', () => {
    it('returns readonly refs that cannot be mutated directly', async () => {
      const fetcher = vi.fn().mockResolvedValue({ data: 'test' });
      const { data, loading, error } = useCachedFetch({ fetcher });

      // TypeScript will prevent these assignments, but let's verify at runtime
      // that the refs are readonly wrapped
      expect(data).toBeDefined();
      expect(loading).toBeDefined();
      expect(error).toBeDefined();

      // These should be readonly refs (Vue's readonly() wrapper)
      // Attempting to set .value will throw in strict mode or be silently ignored
      const attempt = () => {
        // @ts-expect-error Testing runtime readonly behavior
        data.value = { data: 'hacked' };
      };

      // In development, Vue's readonly will throw
      // In production, it might be silently ignored
      // Either way, the value shouldn't change
      const originalValue = data.value;
      try {
        attempt();
      } catch {
        // Expected in dev mode
      }

      // Value should not have changed
      expect(data.value).toBe(originalValue);
    });
  });
});
