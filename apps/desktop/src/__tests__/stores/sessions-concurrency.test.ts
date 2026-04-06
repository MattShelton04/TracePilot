import { setActivePinia, createPinia } from "pinia";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { useSessionsStore } from "@/stores/sessions";
import * as client from "@tracepilot/client";

vi.mock("@tracepilot/client", () => ({
  listSessions: vi.fn(),
  reindexSessions: vi.fn(),
}));

const MOCK_SESSIONS = [
  { id: "1", summary: "Session 1", turnCount: 5, eventCount: 10, updatedAt: "2024-01-01T12:00:00Z", createdAt: "2024-01-01T10:00:00Z" },
  { id: "2", summary: "Session 2", turnCount: 0, eventCount: 0, updatedAt: "2024-01-02T12:00:00Z", createdAt: "2024-01-02T10:00:00Z" },
];

describe("stores/sessions", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    vi.mocked(client.listSessions).mockResolvedValue(MOCK_SESSIONS);
    vi.mocked(client.reindexSessions).mockResolvedValue([1, 1]);
  });

  it("deduplicates concurrent fetchSessions calls", async () => {
    const store = useSessionsStore();
    const promise1 = store.fetchSessions();
    const promise2 = store.fetchSessions();

    expect(promise1).toBe(promise2);
    expect(client.listSessions).toHaveBeenCalledTimes(1);

    await promise1;
    expect(store.sessions).toHaveLength(2);

    // After completion, a new call should trigger a new fetch
    await store.fetchSessions();
    expect(client.listSessions).toHaveBeenCalledTimes(2);
  });

  it("deduplicates concurrent reindex calls", async () => {
    const store = useSessionsStore();
    const promise1 = store.reindex();
    const promise2 = store.reindex();

    expect(client.reindexSessions).toHaveBeenCalledTimes(1);

    await promise1;
    await promise2;

    expect(client.reindexSessions).toHaveBeenCalledTimes(1);
    // listSessions is called once after the first reindex, and once again
    // by the second deduplicated call's completion handler.
    expect(client.listSessions).toHaveBeenCalledTimes(2);
    expect(store.sessions).toHaveLength(2);

    // After completion, a new call should trigger a new reindex
    await store.reindex();
    expect(client.reindexSessions).toHaveBeenCalledTimes(2);
  });

  it("handles errors during deduplicated reindex calls", async () => {
    const store = useSessionsStore();
    const testError = new Error("Reindex failed");
    vi.mocked(client.reindexSessions).mockRejectedValueOnce(testError);

    const promise1 = store.reindex();
    const promise2 = store.reindex();

    await expect(promise1).rejects.toThrow(testError);
    await expect(promise2).rejects.toThrow(testError);

    expect(client.reindexSessions).toHaveBeenCalledTimes(1);
    expect(store.error).toBe("Reindex failed");
  });

  it("deduplicates refreshSessions with fetchSessions", async () => {
    const store = useSessionsStore();
    const promise1 = store.fetchSessions();
    const promise2 = store.refreshSessions();

    expect(promise1).toBe(promise2);
    expect(client.listSessions).toHaveBeenCalledTimes(1);

    await promise1;
    expect(store.sessions).toHaveLength(2);
  });

  it("deduplicates ensureIndex with reindex", async () => {
    const store = useSessionsStore();
    store.reindex();
    store.ensureIndex();

    expect(client.reindexSessions).toHaveBeenCalledTimes(1);
  });
});
