import { createDeferred } from "@tracepilot/test-utils";
import { useCachedFetch } from "@tracepilot/ui";
import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("initial state", () => {
  it("initializes with null data, no loading, and no error", () => {
    const fetcher = vi.fn().mockResolvedValue({ data: "test" });
    const { data, loading, error } = useCachedFetch({ fetcher });

    expect(data.value).toBe(null);
    expect(loading.value).toBe(false);
    expect(error.value).toBe(null);
  });
});

describe("successful fetch", () => {
  it("fetches data successfully and updates state", async () => {
    const mockData = { value: "test", count: 42 };
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

  it("sets loading state during fetch", async () => {
    const deferred = createDeferred<unknown>();
    const fetcher = vi.fn(() => deferred.promise);
    const { loading, fetch } = useCachedFetch({ fetcher });

    expect(loading.value).toBe(false);

    const fetchPromise = fetch(undefined);
    expect(loading.value).toBe(true);

    deferred.resolve({ data: "test" });
    await fetchPromise;

    expect(loading.value).toBe(false);
  });

  it("passes parameters to fetcher function", async () => {
    interface Params {
      id: number;
      name: string;
    }
    const fetcher = vi.fn().mockResolvedValue({ result: "ok" });
    const { fetch } = useCachedFetch<unknown, Params>({ fetcher });

    await fetch({ id: 123, name: "test" });

    expect(fetcher).toHaveBeenCalledWith({ id: 123, name: "test" });
  });
});
