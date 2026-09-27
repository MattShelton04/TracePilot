import { createDeferred } from "@tracepilot/test-utils";
import { useCachedFetch } from "@tracepilot/ui";
import { expect, it, vi } from "vitest";

it.each([
  "reset",
  "invalidate",
] as const)("%s prevents old cleanup from erasing a new same-key request", async (method) => {
  const old = createDeferred<string>();
  const fresh = createDeferred<string>();
  const fetcher = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  const cache = useCachedFetch<string, string>({ fetcher });
  const first = cache.fetch("same");
  cache[method]();
  const second = cache.fetch("same");
  old.resolve("stale");
  expect(await first).toBeUndefined();
  const joined = cache.fetch("same");
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(cache.loading.value).toBe(true);
  fresh.resolve("fresh");
  expect(await second).toBe("fresh");
  expect(await joined).toBe("fresh");
  expect(cache.data.value).toBe("fresh");
  expect(cache.isCached("same")).toBe(true);
});

it("invalidation preserves displayed data but prevents pending results from repopulating the cache", async () => {
  const pending = createDeferred<string>();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce("displayed")
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce("current");
  const cache = useCachedFetch<string>({ fetcher });
  await cache.fetch(undefined);
  const old = cache.fetch(undefined, { force: true });
  cache.invalidate();
  expect(cache.data.value).toBe("displayed");
  await cache.fetch(undefined);
  pending.resolve("outdated");
  await old;
  expect(cache.data.value).toBe("current");
});
