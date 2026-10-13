// @vitest-environment node
// Prefetching runs unawaited, so it can resume after a test environment is
// torn down and `window` no longer exists. Node has no `window`, which
// reproduces that state.
import { describe, expect, it, vi } from "vitest";
import type { AnalyticsFetchParams } from "../analyticsFilters";
import { createAnalyticsPrefetch } from "../analyticsPrefetch";

function setup() {
  const prefetch = vi.fn(async (_name: string, _params: AnalyticsFetchParams) => {});
  const background = createAnalyticsPrefetch({
    prefetch,
    build: (filters) => ({ ...filters }),
    dateRange: () => ({}),
    sources: () => [],
    onWarm: () => {},
  });
  return { prefetch, background };
}

describe("createAnalyticsPrefetch without a window", () => {
  it("still prefetches nearby filters instead of rejecting", async () => {
    expect(typeof (globalThis as { window?: unknown }).window).toBe("undefined");
    const { prefetch, background } = setup();
    await expect(background.prefetchNearby(["analytics"])).resolves.toBeUndefined();
    expect(prefetch).toHaveBeenCalled();
  });

  it("still warms the current filters instead of rejecting", async () => {
    const { prefetch, background } = setup();
    await expect(background.warm(["analytics", "agents"])).resolves.toBeUndefined();
    expect(prefetch).toHaveBeenCalledTimes(2);
  });

  it("stops a warm in progress on reset", async () => {
    const { prefetch, background } = setup();
    const warming = background.warm(["analytics", "agents"]);
    background.reset();
    await warming;
    expect(prefetch).not.toHaveBeenCalled();
  });
});
