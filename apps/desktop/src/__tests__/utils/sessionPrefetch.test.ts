import { describe, expect, it, vi } from "vitest";
import { prefetchRecentSessions, SESSION_PREFETCH_CONCURRENCY } from "@/utils/sessionPrefetch";

describe("prefetchRecentSessions", () => {
  it("prefetches only the configured number of most-recent sessions", async () => {
    const prefetch = vi.fn().mockResolvedValue(undefined);

    await prefetchRecentSessions(
      [
        { id: "old", updatedAt: "2026-01-01", turnCount: 1 },
        { id: "newest-empty", updatedAt: "2026-04-01", turnCount: 0 },
        { id: "newest", updatedAt: "2026-03-01", turnCount: 1 },
        { id: "middle", updatedAt: "2026-02-01", turnCount: 1 },
      ],
      2,
      prefetch,
    );

    expect(prefetch).toHaveBeenCalledTimes(2);
    expect(prefetch).toHaveBeenCalledWith("newest");
    expect(prefetch).toHaveBeenCalledWith("middle");
    expect(prefetch).not.toHaveBeenCalledWith("newest-empty");
  });

  it("bounds concurrent work while continuing after an individual failure", async () => {
    let active = 0;
    let peakActive = 0;
    const visited: string[] = [];
    const prefetch = vi.fn(async (id: string) => {
      active += 1;
      peakActive = Math.max(peakActive, active);
      visited.push(id);
      await new Promise((resolve) => setTimeout(resolve, 0));
      active -= 1;
      if (id === "s-2") throw new Error("expected test failure");
    });

    await prefetchRecentSessions(
      Array.from({ length: 5 }, (_, index) => ({
        id: `s-${index}`,
        updatedAt: `2026-01-0${5 - index}`,
        turnCount: 1,
      })),
      5,
      prefetch,
    );

    expect(peakActive).toBe(SESSION_PREFETCH_CONCURRENCY);
    expect(visited).toHaveLength(5);
  });
});
