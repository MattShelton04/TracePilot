import { createDeferred } from "@tracepilot/test-utils";
import { useCachedFetch } from "@tracepilot/ui";
import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("reset", () => {
  it("resets all state to initial values", async () => {
    const fetcher = vi.fn().mockResolvedValue({ data: "test" });
    const { data, error, loading, fetch, reset } = useCachedFetch<unknown, { id: number }>({
      fetcher,
    });

    await fetch({ id: 1 });
    expect(data.value).toEqual({ data: "test" });

    reset();

    expect(data.value).toBe(null);
    expect(loading.value).toBe(false);
    expect(error.value).toBe(null);
  });

  it("clears cache so next fetch refetches", async () => {
    const fetcher = vi.fn().mockResolvedValue({ data: "test" });
    const { fetch, reset, isCached } = useCachedFetch<unknown, { id: number }>({ fetcher });

    await fetch({ id: 1 });
    expect(isCached({ id: 1 })).toBe(true);

    reset();
    expect(isCached({ id: 1 })).toBe(false);

    await fetch({ id: 1 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("increments generation to prevent stale writes after reset", async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    const fetcher = vi.fn(() => new Promise((resolve) => resolvers.push(resolve)));
    const { data, fetch, reset } = useCachedFetch<unknown, { id: number }>({ fetcher });

    const req1 = fetch({ id: 1 });

    reset();

    // Complete request started before reset (should be ignored)
    resolvers[0]({ value: "stale" });
    await req1;

    expect(data.value).toBe(null);
  });
});

describe("type safety", () => {
  it("enforces correct data type", async () => {
    interface MyData {
      name: string;
      count: number;
    }
    const mockData: MyData = { name: "test", count: 42 };
    const fetcher = vi.fn().mockResolvedValue(mockData);
    const { data, fetch } = useCachedFetch<MyData>({ fetcher });

    await fetch(undefined);

    expect(data.value).toEqual(mockData);
    // TypeScript will enforce that data.value is MyData | null
  });

  it("enforces correct parameter type", async () => {
    interface MyParams {
      id: number;
      filter?: string;
    }
    const fetcher = vi.fn().mockResolvedValue({ result: "ok" });
    const { fetch } = useCachedFetch<unknown, MyParams>({ fetcher });

    await fetch({ id: 1 });
    await fetch({ id: 2, filter: "test" });

    expect(fetcher).toHaveBeenCalledWith({ id: 1 });
    expect(fetcher).toHaveBeenCalledWith({ id: 2, filter: "test" });
  });
});

describe("edge cases", () => {
  it("handles void parameters correctly", async () => {
    const fetcher = vi.fn().mockResolvedValue({ data: "test" });
    const { fetch } = useCachedFetch<unknown, void>({ fetcher });

    await fetch(undefined);
    await fetch(undefined); // Should use cache

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("handles empty object parameters", async () => {
    const fetcher = vi.fn().mockResolvedValue({ data: "test" });
    const { fetch } = useCachedFetch({ fetcher });

    await fetch({});
    await fetch({}); // Should use cache (same cache key)

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("handles null values in parameters", async () => {
    interface Params {
      id: number | null;
      name?: string;
    }
    const fetcher = vi.fn().mockResolvedValue({ data: "test" });
    const { fetch } = useCachedFetch<unknown, Params>({ fetcher });

    await fetch({ id: null });
    await fetch({ id: null }); // Should use cache

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("handles undefined values in parameters", async () => {
    interface Params {
      id?: number;
      name?: string;
    }
    const fetcher = vi.fn().mockResolvedValue({ data: "test" });
    const { fetch } = useCachedFetch<unknown, Params>({ fetcher });

    await fetch({ id: undefined, name: undefined });
    await fetch({ id: undefined, name: undefined }); // Should use cache (same as above)

    // JSON.stringify removes undefined properties, so both calls produce same cache key
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("initialData option", () => {
  it("initializes with provided initial data", () => {
    const initialData = { value: "initial" };
    const fetcher = vi.fn().mockResolvedValue({ value: "new" });
    const { data } = useCachedFetch({ fetcher, initialData });

    expect(data.value).toEqual(initialData);
  });

  it("replaces initial data after successful fetch", async () => {
    const initialData = { value: "initial" };
    const newData = { value: "new" };
    const fetcher = vi.fn().mockResolvedValue(newData);
    const { data, fetch } = useCachedFetch({ fetcher, initialData });

    expect(data.value).toEqual(initialData);

    await fetch(undefined);

    expect(data.value).toEqual(newData);
  });

  it("resets to initial data after reset()", async () => {
    const initialData = { value: "initial" };
    const fetcher = vi.fn().mockResolvedValue({ value: "new" });
    const { data, fetch, reset } = useCachedFetch({ fetcher, initialData });

    await fetch(undefined);
    expect(data.value).toEqual({ value: "new" });

    reset();

    expect(data.value).toEqual(initialData);
  });
});

describe("silent mode", () => {
  it("does not update loading state when silent is true", async () => {
    const deferred = createDeferred<unknown>();
    const fetcher = vi.fn(() => deferred.promise);
    const { loading, fetch } = useCachedFetch({ fetcher, silent: true });

    expect(loading.value).toBe(false);

    const fetchPromise = fetch(undefined);
    expect(loading.value).toBe(false); // Should stay false

    deferred.resolve({ data: "test" });
    await fetchPromise;

    expect(loading.value).toBe(false);
  });

  it("still updates data in silent mode", async () => {
    const mockData = { value: "test" };
    const fetcher = vi.fn().mockResolvedValue(mockData);
    const { data, fetch } = useCachedFetch({ fetcher, silent: true });

    await fetch(undefined);

    expect(data.value).toEqual(mockData);
  });

  it("still updates error in silent mode", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("Network error"));
    const { error, fetch } = useCachedFetch({ fetcher, silent: true });

    await fetch(undefined);

    expect(error.value).toBe("Network error");
  });

  it("still calls callbacks in silent mode", async () => {
    const onSuccess = vi.fn();
    const onFinally = vi.fn();
    const fetcher = vi.fn().mockResolvedValue({ data: "test" });
    const { fetch } = useCachedFetch({ fetcher, silent: true, onSuccess, onFinally });

    await fetch(undefined);

    expect(onSuccess).toHaveBeenCalled();
    expect(onFinally).toHaveBeenCalled();
  });
});

describe("return value from fetch", () => {
  it("returns fetched data on successful fetch", async () => {
    const mockData = { value: "test" };
    const fetcher = vi.fn().mockResolvedValue(mockData);
    const { fetch } = useCachedFetch({ fetcher });

    const result = await fetch(undefined);

    expect(result).toEqual(mockData);
  });

  it("returns undefined on error", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("fail"));
    const { fetch } = useCachedFetch({ fetcher });

    const result = await fetch(undefined);

    expect(result).toBeUndefined();
  });

  it("returns data for stale requests but does not overwrite newer state", async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    const fetcher = vi.fn(() => new Promise((resolve) => resolvers.push(resolve)));
    const { data, fetch } = useCachedFetch<unknown, { id: number }>({ fetcher });

    const req1 = fetch({ id: 1 });
    const req2 = fetch({ id: 2 });

    // Complete second request first
    resolvers[1]({ value: "second" });
    const result2 = await req2;
    expect(result2).toEqual({ value: "second" });
    expect(data.value).toEqual({ value: "second" });

    // Complete first request (stale)
    resolvers[0]({ value: "first" });
    const result1 = await req1;
    expect(result1).toEqual({ value: "first" });
    expect(data.value).toEqual({ value: "second" });
  });

  it("returns cached data when using cache hit", async () => {
    const mockData = { value: "test" };
    const fetcher = vi.fn().mockResolvedValue(mockData);
    const { fetch } = useCachedFetch({ fetcher });

    await fetch(undefined);
    const result = await fetch(undefined); // Cache hit

    expect(result).toEqual(mockData);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("readonly protection", () => {
  it("returns readonly refs that cannot be mutated directly", async () => {
    const fetcher = vi.fn().mockResolvedValue({ data: "test" });
    const { data, loading, error } = useCachedFetch({ fetcher });
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // TypeScript will prevent these assignments, but let's verify at runtime
    // that the refs are readonly wrapped
    expect(data).toBeDefined();
    expect(loading).toBeDefined();
    expect(error).toBeDefined();

    // These should be readonly refs (Vue's readonly() wrapper)
    // Attempting to set .value will throw in strict mode or be silently ignored
    const attempt = () => {
      // @ts-expect-error Testing runtime readonly behavior
      data.value = { data: "hacked" };
    };

    // In development, Vue's readonly will throw
    // In production, it might be silently ignored
    // Either way, the value shouldn't change
    const originalValue = data.value;
    try {
      try {
        attempt();
      } catch {
        // Expected in dev mode
      }

      expect(consoleWarnSpy).toHaveBeenCalled();
      // Value should not have changed
      expect(data.value).toBe(originalValue);
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });
});
