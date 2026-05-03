import { createDeferred } from "@tracepilot/test-utils";
import { useCachedFetch } from "@tracepilot/ui";
import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("caching", () => {
  it("caches results and does not refetch", async () => {
    const fetcher = vi.fn().mockResolvedValue({ data: "test" });
    const { fetch } = useCachedFetch({ fetcher });

    await fetch({ id: 1 });
    await fetch({ id: 1 }); // Should use cache

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("fetches again for different parameters", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ data: "first" })
      .mockResolvedValueOnce({ data: "second" });
    const { data, fetch } = useCachedFetch({ fetcher });

    await fetch({ id: 1 });
    expect(data.value).toEqual({ data: "first" });

    await fetch({ id: 2 });
    expect(data.value).toEqual({ data: "second" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("uses custom cache key function", async () => {
    const fetcher = vi.fn().mockResolvedValue({ data: "test" });
    const cacheKeyFn = vi.fn((params: { id: number }) => `key-${params.id}`);
    const { fetch } = useCachedFetch({ fetcher, cacheKeyFn });

    await fetch({ id: 1 });
    await fetch({ id: 1 });

    expect(cacheKeyFn).toHaveBeenCalledTimes(2);
    expect(cacheKeyFn).toHaveBeenCalledWith({ id: 1 });
    expect(fetcher).toHaveBeenCalledTimes(1); // Cached
  });

  it("force refetch bypasses cache", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ data: "first" })
      .mockResolvedValueOnce({ data: "second" });
    const { data, fetch } = useCachedFetch({ fetcher });

    await fetch({ id: 1 });
    expect(data.value).toEqual({ data: "first" });

    await fetch({ id: 1 }); // Cached
    expect(fetcher).toHaveBeenCalledTimes(1);

    await fetch({ id: 1 }, { force: true }); // Force refetch
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(data.value).toEqual({ data: "second" });
  });

  it("isCached returns correct status", async () => {
    const fetcher = vi.fn().mockResolvedValue({ data: "test" });
    const { fetch, isCached } = useCachedFetch({ fetcher });

    expect(isCached({ id: 1 })).toBe(false);

    await fetch({ id: 1 });
    expect(isCached({ id: 1 })).toBe(true);
    expect(isCached({ id: 2 })).toBe(false);
  });

  it("clearCache removes cache entries", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ data: "first" })
      .mockResolvedValueOnce({ data: "second" });
    const { fetch, isCached, clearCache } = useCachedFetch({ fetcher });

    await fetch({ id: 1 });
    expect(isCached({ id: 1 })).toBe(true);

    clearCache();
    expect(isCached({ id: 1 })).toBe(false);

    await fetch({ id: 1 }); // Should refetch
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("returns cached data for prior parameters after other keys are fetched", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ data: "first" })
      .mockResolvedValueOnce({ data: "second" });
    const { data, fetch } = useCachedFetch<{ data: string }, { id: number }>({ fetcher });

    await fetch({ id: 1 });
    await fetch({ id: 2 });

    const cached = await fetch({ id: 1 });
    expect(cached).toEqual({ data: "first" });
    expect(data.value).toEqual({ data: "first" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("stores stale responses in cache without overwriting newer active data", async () => {
    const first = createDeferred<{ data: string }>();
    const second = createDeferred<{ data: string }>();
    const fetcher = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const { data, fetch, isCached } = useCachedFetch<{ data: string }, { id: number }>({
      fetcher,
    });

    const req1 = fetch({ id: 1 });
    const req2 = fetch({ id: 2 });

    second.resolve({ data: "second" });
    await req2;
    expect(data.value).toEqual({ data: "second" });

    first.resolve({ data: "first" });
    await req1;
    expect(data.value).toEqual({ data: "second" });
    expect(isCached({ id: 1 })).toBe(true);

    const cachedResult = await fetch({ id: 1 });
    expect(cachedResult).toEqual({ data: "first" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("request deduplication", () => {
  it("deduplicates concurrent requests for same parameters", async () => {
    const deferred = createDeferred<unknown>();
    const fetcher = vi.fn(() => deferred.promise);
    const { fetch } = useCachedFetch<unknown, { id: number }>({ fetcher });

    const promise1 = fetch({ id: 1 });
    const promise2 = fetch({ id: 1 });
    const promise3 = fetch({ id: 1 });

    expect(fetcher).toHaveBeenCalledTimes(1);

    deferred.resolve({ data: "test" });
    await Promise.all([promise1, promise2, promise3]);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not deduplicate requests for different parameters", async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    const fetcher = vi.fn(() => new Promise((resolve) => resolvers.push(resolve)));
    const { fetch } = useCachedFetch<unknown, { id: number }>({ fetcher });

    const promise1 = fetch({ id: 1 });
    const promise2 = fetch({ id: 2 });

    expect(fetcher).toHaveBeenCalledTimes(2);

    resolvers[0]({ data: "first" });
    resolvers[1]({ data: "second" });
    await Promise.all([promise1, promise2]);
  });

  it("allows new request after previous completes", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ data: "first" })
      .mockResolvedValueOnce({ data: "second" });
    const { fetch } = useCachedFetch({ fetcher });

    await fetch({ id: 1 });
    await fetch({ id: 1 }, { force: true });

    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("cache control", () => {
  it("does not cache results when cache is false", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ data: "first" })
      .mockResolvedValueOnce({ data: "second" });
    const { fetch, isCached } = useCachedFetch({ fetcher, cache: false });

    await fetch({ id: 1 });
    expect(isCached({ id: 1 })).toBe(false);

    await fetch({ id: 1 }); // Should refetch
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("returns cached data when cache is false and force is false", async () => {
    const mockData = { data: "test" };
    const fetcher = vi.fn().mockResolvedValue(mockData);
    const { data, fetch } = useCachedFetch({ fetcher, cache: false });

    await fetch(undefined);
    expect(data.value).toEqual(mockData);

    const result = await fetch(undefined);
    expect(result).toEqual(mockData); // Returns current data
    expect(fetcher).toHaveBeenCalledTimes(2); // But fetches again
  });
});
