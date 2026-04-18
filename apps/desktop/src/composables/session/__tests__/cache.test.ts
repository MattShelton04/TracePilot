import { describe, expect, it } from "vitest";
import { createSessionCache } from "@/composables/session/cache";
import type { CachedSession } from "@/composables/session/cache";

const makeEntry = (id: string): CachedSession =>
  ({
    detail: { id } as CachedSession["detail"],
    turns: [],
    eventsFingerprint: { size: 0, mtime: null },
    checkpoints: [],
    plan: null,
    shutdownMetrics: null,
    incidents: [],
    loadedSections: new Set(["detail"]),
  }) as CachedSession;

describe("createSessionCache", () => {
  it("stores and retrieves entries", () => {
    const cache = createSessionCache(3);
    cache.set("a", makeEntry("a"));
    expect(cache.has("a")).toBe(true);
    expect(cache.get("a")?.detail.id).toBe("a");
    expect(cache.size).toBe(1);
  });

  it("evicts the least-recently-used entry when full", () => {
    const cache = createSessionCache(2);
    cache.set("a", makeEntry("a"));
    cache.set("b", makeEntry("b"));
    cache.set("c", makeEntry("c")); // should evict "a"
    expect(cache.has("a")).toBe(false);
    expect(cache.has("b")).toBe(true);
    expect(cache.has("c")).toBe(true);
    expect(cache.size).toBe(2);
  });

  it("refreshes recency on get so re-read entries aren't evicted first", () => {
    const cache = createSessionCache(2);
    cache.set("a", makeEntry("a"));
    cache.set("b", makeEntry("b"));
    cache.get("a"); // bump 'a' to most recent
    cache.set("c", makeEntry("c")); // should evict 'b', not 'a'
    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
    expect(cache.has("c")).toBe(true);
  });

  it("re-setting an existing key updates recency and value", () => {
    const cache = createSessionCache(2);
    cache.set("a", makeEntry("a"));
    cache.set("b", makeEntry("b"));
    cache.set("a", makeEntry("a")); // 'a' becomes MRU
    cache.set("c", makeEntry("c")); // evicts 'b'
    expect(cache.has("b")).toBe(false);
    expect(cache.has("a")).toBe(true);
  });

  it("clear() empties the cache", () => {
    const cache = createSessionCache(3);
    cache.set("a", makeEntry("a"));
    cache.set("b", makeEntry("b"));
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.has("a")).toBe(false);
  });
});
