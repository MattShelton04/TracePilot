import { useCachedFetch } from "@tracepilot/ui";
import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generation-based stale request prevention", () => {
  it("prevents stale writes when newer request completes first", async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    const fetcher = vi.fn(() => new Promise((resolve) => resolvers.push(resolve)));
    const { data, fetch } = useCachedFetch<unknown, { id: number }>({ fetcher });

    // Start first request
    const req1 = fetch({ id: 1 });
    // Start second request (newer generation)
    const req2 = fetch({ id: 2 });

    expect(fetcher).toHaveBeenCalledTimes(2);

    // Resolve second request first
    resolvers[1]({ value: "second" });
    await req2;
    expect(data.value).toEqual({ value: "second" });

    // Resolve first request (should be ignored as stale)
    resolvers[0]({ value: "first" });
    await req1;

    // Data should still be from second request
    expect(data.value).toEqual({ value: "second" });
  });

  it("prevents stale error writes", async () => {
    const resolvers: Array<{ resolve: (v: unknown) => void; reject: (e: unknown) => void }> = [];
    const fetcher = vi.fn(
      () =>
        new Promise((resolve, reject) => {
          resolvers.push({ resolve, reject });
        }),
    );
    const { error, data, fetch } = useCachedFetch<unknown, { id: number }>({ fetcher });

    const req1 = fetch({ id: 1 });
    const req2 = fetch({ id: 2 });

    // Second request succeeds
    resolvers[1].resolve({ value: "success" });
    await req2;
    expect(data.value).toEqual({ value: "success" });
    expect(error.value).toBe(null);

    // First request fails (should be ignored)
    resolvers[0].reject(new Error("stale error"));
    await req1;

    // Error should not be set
    expect(error.value).toBe(null);
    expect(data.value).toEqual({ value: "success" });
  });

  it("prevents stale loading state updates", async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    const fetcher = vi.fn(() => new Promise((resolve) => resolvers.push(resolve)));
    const { loading, fetch } = useCachedFetch<unknown, { id: number }>({ fetcher });

    const req1 = fetch({ id: 1 });
    expect(loading.value).toBe(true);

    const req2 = fetch({ id: 2 });
    expect(loading.value).toBe(true);

    // Complete second request
    resolvers[1]({ value: "second" });
    await req2;
    expect(loading.value).toBe(false);

    // Complete first request (stale)
    resolvers[0]({ value: "first" });
    await req1;

    // Loading should remain false
    expect(loading.value).toBe(false);
  });
});
