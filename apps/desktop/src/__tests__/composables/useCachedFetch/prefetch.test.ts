import { createDeferred } from "@tracepilot/test-utils";
import { useCachedFetch } from "@tracepilot/ui";
import { describe, expect, it, vi } from "vitest";

describe("prefetch", () => {
  it("caches without touching what is on screen", async () => {
    const fetcher = vi.fn(async (params: { id: number }) => ({ id: params.id }));
    const { data, loading, fetch, prefetch } = useCachedFetch({ fetcher });

    await fetch({ id: 1 });
    await prefetch({ id: 2 });
    expect(data.value).toEqual({ id: 1 });
    expect(loading.value).toBe(false);

    await fetch({ id: 2 });
    expect(data.value).toEqual({ id: 2 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("skips parameters that are cached or already loading", async () => {
    const fetcher = vi.fn(async (params: { id: number }) => ({ id: params.id }));
    const { fetch, prefetch } = useCachedFetch({ fetcher });

    await fetch({ id: 1 });
    await prefetch({ id: 1 });
    await Promise.all([prefetch({ id: 2 }), prefetch({ id: 2 })]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("lets a fetch share a prefetch in flight and report loading until it lands", async () => {
    const pending = createDeferred<{ id: number }>();
    const fetcher = vi.fn().mockReturnValueOnce(pending.promise);
    const { data, loading, fetch, prefetch } = useCachedFetch({ fetcher });

    void prefetch({ id: 1 });
    const shown = fetch({ id: 1 });
    expect(loading.value).toBe(true);
    pending.resolve({ id: 1 });
    await shown;
    expect(data.value).toEqual({ id: 1 });
    expect(loading.value).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed prefetch out of the cache and off screen", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("busy"))
      .mockResolvedValueOnce({ id: 1 });
    const { error, fetch, prefetch } = useCachedFetch({ fetcher });

    await prefetch({ id: 1 });
    expect(error.value).toBeNull();
    await fetch({ id: 1 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
