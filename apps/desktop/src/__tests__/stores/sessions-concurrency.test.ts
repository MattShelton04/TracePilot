import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionsStore } from "../../stores/sessions";
import type { SessionListItem } from "@tracepilot/types";
import { createDeferred } from "../helpers/deferred";

const mockListSessions = vi.fn();
const mockReindexSessions = vi.fn();

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../mocks/client");
  return createClientMock({
    listSessions: (...args: unknown[]) => mockListSessions(...args),
    reindexSessions: (...args: unknown[]) => mockReindexSessions(...args),
  });
});

const MOCK_SESSIONS: SessionListItem[] = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    summary: "First session",
    repository: "org/repo",
    branch: "main",
    hostType: "cli",
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T01:00:00Z",
    eventCount: 5,
    turnCount: 2,
    currentModel: "claude-opus-4.6",
    isRunning: false,
  },
];

describe("useSessionsStore — concurrency & deduplication", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockListSessions.mockReset();
    mockReindexSessions.mockReset();
  });

  describe("fetchSessions deduplication", () => {
    it("coalesces concurrent calls into one underlying request", async () => {
      const deferred = createDeferred<SessionListItem[]>();
      mockListSessions.mockReturnValue(deferred.promise);
      const store = useSessionsStore();

      const p1 = store.fetchSessions();
      const p2 = store.fetchSessions();

      // Only one underlying API call is made even though two callers are waiting
      expect(mockListSessions).toHaveBeenCalledTimes(1);

      deferred.resolve(MOCK_SESSIONS);
      await Promise.all([p1, p2]);

      expect(store.sessions).toEqual(MOCK_SESSIONS);
      expect(store.loading).toBe(false);
    });

    it("allows a fresh fetch after the first one completes", async () => {
      mockListSessions.mockResolvedValue(MOCK_SESSIONS);
      const store = useSessionsStore();

      await store.fetchSessions();
      expect(mockListSessions).toHaveBeenCalledTimes(1);

      // After completion fetchPromise is null — a new call should go through
      await store.fetchSessions();
      expect(mockListSessions).toHaveBeenCalledTimes(2);
    });

    it("fresh Pinia instance does not inherit in-flight promise from previous instance", async () => {
      // Start a fetch on the first Pinia instance (don't await it yet)
      const deferred = createDeferred<SessionListItem[]>();
      mockListSessions.mockReturnValue(deferred.promise);

      const store1 = useSessionsStore();
      const p1 = store1.fetchSessions();
      expect(store1.loading).toBe(true);

      // Create a brand-new Pinia — the new store must start clean
      setActivePinia(createPinia());
      mockListSessions.mockResolvedValue(MOCK_SESSIONS);

      const store2 = useSessionsStore();
      // The new store has its own closure; fetchPromise starts as null
      expect(store2.loading).toBe(false);

      await store2.fetchSessions();
      expect(store2.loading).toBe(false);
      expect(store2.sessions).toEqual(MOCK_SESSIONS);

      // Settle the first deferred to avoid unhandled rejection warnings
      deferred.resolve([]);
      await p1;
    });
  });

  describe("refreshSessions deduplication", () => {
    it("deduplicates with an in-flight fetchSessions call", async () => {
      const deferred = createDeferred<SessionListItem[]>();
      mockListSessions.mockReturnValue(deferred.promise);
      const store = useSessionsStore();

      const fetchP = store.fetchSessions();
      const refreshP = store.refreshSessions();

      // Both resolve to the same result — only one API call is made
      expect(mockListSessions).toHaveBeenCalledTimes(1);

      deferred.resolve(MOCK_SESSIONS);
      await Promise.all([fetchP, refreshP]);
      expect(store.sessions).toEqual(MOCK_SESSIONS);
    });

    it("updates sessions without triggering the loading state", async () => {
      mockListSessions.mockResolvedValue(MOCK_SESSIONS);
      const store = useSessionsStore();

      await store.refreshSessions();

      expect(store.sessions).toEqual(MOCK_SESSIONS);
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });

    it("clears a previous error on successful refresh", async () => {
      // Prime the store with an error from a failed fetchSessions
      mockListSessions.mockRejectedValueOnce(new Error("network error"));
      const store = useSessionsStore();
      await store.fetchSessions();
      expect(store.error).toBeTruthy();

      // Now a successful refreshSessions should clear the stale error
      mockListSessions.mockResolvedValue(MOCK_SESSIONS);
      await store.refreshSessions();
      expect(store.sessions).toEqual(MOCK_SESSIONS);
      expect(store.error).toBeNull();
    });
  });

  describe("reindex deduplication", () => {
    it("only calls reindexSessions once for concurrent calls", async () => {
      const deferred = createDeferred<[number, number]>();
      mockReindexSessions.mockReturnValue(deferred.promise);
      mockListSessions.mockResolvedValue(MOCK_SESSIONS);
      const store = useSessionsStore();

      // Both reindex calls start before the first one resolves
      const p1 = store.reindex();
      const p2 = store.reindex();

      expect(mockReindexSessions).toHaveBeenCalledTimes(1);
      expect(store.indexing).toBe(true);

      deferred.resolve([1, 1]);
      await Promise.all([p1, p2]);

      expect(mockListSessions).toHaveBeenCalledTimes(1);
      expect(store.indexing).toBe(false);
      expect(store.sessions).toEqual(MOCK_SESSIONS);
    });

    it("allows a fresh reindex after the previous one completes", async () => {
      mockReindexSessions.mockResolvedValue([1, 1] as [number, number]);
      mockListSessions.mockResolvedValue(MOCK_SESSIONS);
      const store = useSessionsStore();

      await store.reindex();
      expect(mockReindexSessions).toHaveBeenCalledTimes(1);

      await store.reindex();
      expect(mockReindexSessions).toHaveBeenCalledTimes(2);
    });

    it("dedup path suppresses ALREADY_INDEXING errors but surfaces other errors", async () => {
      const deferred = createDeferred<[number, number]>();
      mockReindexSessions.mockReturnValue(deferred.promise);
      mockListSessions.mockResolvedValue(MOCK_SESSIONS);
      const store = useSessionsStore();

      // First call starts the reindex
      const p1 = store.reindex();
      // Second call enters the dedup branch
      const p2 = store.reindex();

      // Reject with a generic error (not ALREADY_INDEXING)
      deferred.reject(new Error("disk full"));
      await Promise.all([p1, p2]);

      // The first caller sets error.value; the second dedup caller also sees it
      expect(store.error).toContain("disk full");
      // indexingPromise was cleared so a fresh attempt is allowed
      expect(store.indexing).toBe(false);
    });
  });

  describe("ensureIndex deduplication", () => {
    it("reuses in-flight indexingPromise when reindex is in-progress", async () => {
      const deferred = createDeferred<[number, number]>();
      mockReindexSessions.mockReturnValue(deferred.promise);
      mockListSessions.mockResolvedValue(MOCK_SESSIONS);
      const store = useSessionsStore();

      // Start a reindex — indexingPromise is now set
      const reindexP = store.reindex();
      // ensureIndex should reuse the existing promise
      const ensureP = store.ensureIndex();

      expect(mockReindexSessions).toHaveBeenCalledTimes(1);

      deferred.resolve([1, 1]);
      await Promise.all([reindexP, ensureP]);

      expect(mockListSessions).toHaveBeenCalledTimes(1);
      expect(store.sessions).toEqual(MOCK_SESSIONS);
    });

    it("coalesces concurrent ensureIndex calls into one post-index refresh fetch", async () => {
      const deferred = createDeferred<[number, number]>();
      mockReindexSessions.mockReturnValue(deferred.promise);
      mockListSessions.mockResolvedValue(MOCK_SESSIONS);
      const store = useSessionsStore();

      const p1 = store.ensureIndex();
      const p2 = store.ensureIndex();

      expect(mockReindexSessions).toHaveBeenCalledTimes(1);

      deferred.resolve([1, 1]);
      await Promise.all([p1, p2]);

      expect(mockListSessions).toHaveBeenCalledTimes(1);
      expect(store.error).toBeNull();
    });
  });

  describe("post-index refresh error semantics", () => {
    it("surfaces post-index refresh failures for reindex callers", async () => {
      mockReindexSessions.mockResolvedValue([1, 1]);
      mockListSessions.mockRejectedValue(new Error("refresh failed"));
      const store = useSessionsStore();

      const p1 = store.reindex();
      const p2 = store.reindex();
      await Promise.all([p1, p2]);

      expect(mockListSessions).toHaveBeenCalledTimes(1);
      expect(store.error).toContain("refresh failed");
      expect(store.indexing).toBe(false);
    });

    it("keeps ensureIndex refresh failures silent while sharing one fetch", async () => {
      mockReindexSessions.mockResolvedValue([1, 1]);
      mockListSessions.mockRejectedValue(new Error("refresh failed"));
      const store = useSessionsStore();

      const p1 = store.ensureIndex();
      const p2 = store.ensureIndex();
      await Promise.all([p1, p2]);

      expect(mockListSessions).toHaveBeenCalledTimes(1);
      expect(store.error).toBeNull();
      expect(store.indexing).toBe(false);
    });
  });
});
