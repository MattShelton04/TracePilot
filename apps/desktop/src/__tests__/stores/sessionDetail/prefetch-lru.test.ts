// biome-ignore-all assist/source/organizeImports: setup must register mocks before the store import.
import { describe, expect, it, vi } from "vitest";
import {
  buildFreshness,
  FIXTURE_DETAIL,
  FIXTURE_TURNS,
  ZERO_FRESHNESS,
  mocks,
  setupSessionDetailStoreTest,
} from "./setup";
import { useSessionDetailStore } from "@/stores/sessionDetail";

setupSessionDetailStoreTest();

describe("useSessionDetailStore", () => {
  describe("prefetchSession", () => {
    it("prefetches detail/turns and restores from cache with section defaults", async () => {
      const store = useSessionDetailStore();
      const PREFETCH_ID = "prefetch-999";
      const prefetchedDetail = { ...FIXTURE_DETAIL, id: PREFETCH_ID, repository: "prefetch-repo" };
      const prefetchedTurns = {
        turns: [{ turnIndex: 0, userMessage: "prefetched", assistantMessages: [], toolCalls: [] }],
        eventsFileSize: 777,
        eventsFileMtime: 7_770,
      };

      mocks.getSessionDetail.mockResolvedValue(prefetchedDetail);
      mocks.getSessionTurns.mockResolvedValue(prefetchedTurns);
      await store.prefetchSession(PREFETCH_ID);

      vi.clearAllMocks();
      mocks.getSessionDetail.mockResolvedValue(prefetchedDetail);
      mocks.getSessionTurns.mockResolvedValue(prefetchedTurns);
      mocks.checkSessionFreshness.mockResolvedValue(
        buildFreshness(prefetchedTurns.eventsFileSize, prefetchedTurns.eventsFileMtime),
      );

      await store.loadDetail(PREFETCH_ID);

      expect(store.loading).toBe(false);
      expect(store.detail).toEqual(prefetchedDetail);
      expect(store.turns).toEqual(prefetchedTurns.turns);
      expect(store.checkpoints).toEqual([]);
      expect(store.plan).toBeNull();
      expect(store.shutdownMetrics).toBeNull();
      expect(store.incidents).toEqual([]);
      expect(store.loaded.has("detail")).toBe(true);
      expect(store.loaded.has("turns")).toBe(true);
      expect(store.loaded.has("events")).toBe(false);
      expect(store.loaded.has("todos")).toBe(false);
    });
  });

  // ── LRU session cache eviction ────────────────────────────────
  // The frontend session cache holds up to 10 sessions using LRU (Least
  // Recently Used) eviction. Both cache hits (reads) and saves (writes)
  // promote the entry to the most-recently-used position so that
  // frequently accessed sessions survive cache pressure from browsing.
  //
  // Detection strategy: `loadDetail` sets `loading = true` SYNCHRONOUSLY before
  // any IPC call (cache miss) and sets `loading = false` SYNCHRONOUSLY for an
  // instant cache restore (cache hit). Checking `store.loading` immediately after
  // calling `store.loadDetail()` (without awaiting) reliably distinguishes the two.
  describe("LRU session cache", () => {
    /**
     * Navigate through `ids` sequentially to populate the cache.
     * After this helper, the last id is the current session and all
     * previously navigated sessions are stored in the cache.
     */
    async function fillCache(
      store: ReturnType<typeof useSessionDetailStore>,
      ids: string[],
    ): Promise<void> {
      for (const id of ids) {
        mocks.getSessionDetail.mockResolvedValue({ ...FIXTURE_DETAIL, id });
        mocks.getSessionTurns.mockResolvedValue(FIXTURE_TURNS);
        mocks.checkSessionFreshness.mockResolvedValue(ZERO_FRESHNESS);
        await store.loadDetail(id);
      }
    }

    /**
     * Start loading `id` without awaiting and immediately capture the
     * synchronous `loading` state. Returns `true` when the load required
     * a full IPC fetch (cache miss) and `false` for an instant cache
     * restore (cache hit). Always awaits the pending promise to clean up.
     */
    async function getLoadingState(
      store: ReturnType<typeof useSessionDetailStore>,
      id: string,
    ): Promise<boolean> {
      mocks.getSessionDetail.mockResolvedValue({ ...FIXTURE_DETAIL, id });
      mocks.getSessionTurns.mockResolvedValue(FIXTURE_TURNS);
      mocks.checkSessionFreshness.mockResolvedValue(ZERO_FRESHNESS);
      // Do NOT await — loading state is set synchronously before first IPC await
      const pending = store.loadDetail(id);
      const wasLoading = store.loading; // true = cache miss, false = cache hit
      await pending;
      await new Promise((r) => setTimeout(r, 10)); // allow background refresh to settle
      return wasLoading;
    }

    it("evicts the least-recently-used entry when cache overflows", async () => {
      const store = useSessionDetailStore();

      // Load s-0 … s-29 sequentially (cache size = 30).
      // After this: cache = {s-0…s-28} (29 entries saved on navigate-away),
      // current session = s-29, s-0 is the oldest (LRU candidate).
      await fillCache(
        store,
        Array.from({ length: 30 }, (_, i) => `s-${i}`),
      );

      // Navigate to s-30: saveToCache(s-29) fills cache to 30 entries.
      // Cache = {s-0…s-29}, current = s-30 (not yet cached).
      mocks.getSessionDetail.mockResolvedValue({ ...FIXTURE_DETAIL, id: "s-30" });
      mocks.getSessionTurns.mockResolvedValue(FIXTURE_TURNS);
      await store.loadDetail("s-30");

      // Navigate to s-31: saveToCache(s-30) adds s-30, triggering eviction of s-0 (LRU).
      // Cache = {s-1…s-29, s-30}, s-0 evicted.
      mocks.getSessionDetail.mockResolvedValue({ ...FIXTURE_DETAIL, id: "s-31" });
      mocks.getSessionTurns.mockResolvedValue(FIXTURE_TURNS);
      await store.loadDetail("s-31");

      // s-0 should be evicted → cache miss (loading = true)
      const missOnS0 = await getLoadingState(store, "s-0");
      expect(missOnS0).toBe(true); // full IPC fetch required — s-0 was evicted
    });

    it("read-touch: visiting a cached session promotes it to MRU, preventing eviction", async () => {
      const store = useSessionDetailStore();

      // Load s-0…s-29 (cache size = 30). Cache = {s-0…s-28}, current = s-29, s-0 is LRU.
      await fillCache(
        store,
        Array.from({ length: 30 }, (_, i) => `s-${i}`),
      );

      // Navigate s-29 → s-0 (cache hit).
      // saveToCache(s-29) adds s-29 → cache = {s-0…s-29} (30 entries).
      // getFromSessionCache(s-0) promotes s-0 to MRU → cache = {s-1…s-29, s-0}, s-1 is now LRU.
      mocks.getSessionDetail.mockResolvedValue({ ...FIXTURE_DETAIL, id: "s-0" });
      mocks.checkSessionFreshness.mockResolvedValue(ZERO_FRESHNESS);
      await store.loadDetail("s-0");
      await new Promise((r) => setTimeout(r, 10)); // let background refresh settle

      // Navigate to s-30 (cache miss).
      // saveToCache(s-0) keeps s-0 at MRU. Cache = {s-1…s-29, s-0}, s-1 still LRU.
      mocks.getSessionDetail.mockResolvedValue({ ...FIXTURE_DETAIL, id: "s-30" });
      mocks.getSessionTurns.mockResolvedValue(FIXTURE_TURNS);
      await store.loadDetail("s-30");

      // Navigate to s-31 (cache miss).
      // saveToCache(s-30) adds s-30, evicts s-1 (LRU). Cache = {s-2…s-29, s-0, s-30}.
      mocks.getSessionDetail.mockResolvedValue({ ...FIXTURE_DETAIL, id: "s-31" });
      mocks.getSessionTurns.mockResolvedValue(FIXTURE_TURNS);
      await store.loadDetail("s-31");

      // s-0 was promoted by read-touch → still cached (cache hit, loading = false)
      const s0Result = await getLoadingState(store, "s-0");
      expect(s0Result).toBe(false); // s-0 was NOT evicted

      // s-1 was the LRU after s-0 was promoted → evicted (cache miss, loading = true)
      const s1Result = await getLoadingState(store, "s-1");
      expect(s1Result).toBe(true); // s-1 WAS evicted
    });

    it("prefetch guard uses .has() without promoting the entry to MRU", async () => {
      const store = useSessionDetailStore();

      // Load s-0…s-29 (cache size = 30). Cache = {s-0…s-28}, current = s-29, s-0 is LRU.
      await fillCache(
        store,
        Array.from({ length: 30 }, (_, i) => `s-${i}`),
      );

      // Navigate s-29 → s-0 (cache hit, read-touch).
      // cache = {s-1…s-29, s-0}, s-1 is now LRU.
      mocks.getSessionDetail.mockResolvedValue({ ...FIXTURE_DETAIL, id: "s-0" });
      mocks.checkSessionFreshness.mockResolvedValue(ZERO_FRESHNESS);
      await store.loadDetail("s-0");
      await new Promise((r) => setTimeout(r, 10));

      // Attempt to prefetch s-1 — guard returns early via .has() (already cached).
      // Unlike getFromSessionCache, the .has() check does NOT promote s-1 to MRU.
      await store.prefetchSession("s-1"); // no-op: already cached, guard returns early

      // Navigate to s-30 (cache miss). saveToCache(s-0) keeps s-0 at MRU.
      mocks.getSessionDetail.mockResolvedValue({ ...FIXTURE_DETAIL, id: "s-30" });
      mocks.getSessionTurns.mockResolvedValue(FIXTURE_TURNS);
      await store.loadDetail("s-30");

      // Navigate to s-31 (cache miss). saveToCache(s-30) adds s-30, evicts s-1 (LRU).
      // If prefetch HAD promoted s-1, s-2 would be evicted instead.
      mocks.getSessionDetail.mockResolvedValue({ ...FIXTURE_DETAIL, id: "s-31" });
      mocks.getSessionTurns.mockResolvedValue(FIXTURE_TURNS);
      await store.loadDetail("s-31");

      // s-1 was not promoted by prefetch guard → it remains the LRU → evicted
      const s1Result = await getLoadingState(store, "s-1");
      expect(s1Result).toBe(true); // s-1 WAS evicted (prefetch didn't protect it)
    });
  });
});
