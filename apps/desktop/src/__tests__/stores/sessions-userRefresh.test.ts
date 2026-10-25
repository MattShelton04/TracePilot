// biome-ignore-all assist/source/organizeImports: mocks must register before the store import.
import { setupPinia } from "@tracepilot/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listeners = vi.hoisted(() => new Map<string, () => void>());
vi.mock("@/utils/tauriEvents", () => ({
  safeListen: vi.fn(async (event: string, handler: () => void) => {
    listeners.set(event, handler);
    return () => listeners.delete(event);
  }),
}));

// The session list's Refresh: a user's pass reports its failure, background
// passes stay silent, and any pass that reloads the list clears the error.
const mockListSessions = vi.fn();
const mockReindexSessions = vi.fn();

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../mocks/client");
  return createClientMock({
    listSessions: (...args: unknown[]) => mockListSessions(...args),
    reindexSessions: (...args: unknown[]) => mockReindexSessions(...args),
  });
});

import { IPC_EVENTS } from "@tracepilot/client";
import { flushPromises } from "@vue/test-utils";
import { useSessionsStore } from "../../stores/sessions";

const MOCK_SESSION = {
  id: "abc-123",
  summary: "Test Session",
  repository: "org/repo",
  branch: "main",
  eventCount: 10,
  turnCount: 3,
};

describe("sessions store Refresh errors", () => {
  beforeEach(() => {
    localStorage.clear();
    setupPinia();
    listeners.clear();
    mockListSessions.mockReset();
    mockReindexSessions.mockReset();
  });

  it("ensureIndex stays silent when a forced background pass fails", async () => {
    mockReindexSessions.mockRejectedValue(new Error("database is locked"));
    const store = useSessionsStore();

    await store.ensureIndex({ force: true });
    expect(store.error).toBeNull();
  });

  it("a user's Refresh that fails reports it and keeps the list", async () => {
    mockListSessions.mockResolvedValue([MOCK_SESSION]);
    const store = useSessionsStore();
    await store.fetchSessions();

    mockReindexSessions.mockRejectedValue(new Error("database is locked"));
    await store.ensureIndex({ force: true, userInitiated: true });

    expect(store.error).toBe("Couldn't refresh sessions: database is locked");
    expect(store.sessions).toHaveLength(1);
  });

  it("a user's Refresh reports a failed pass it joined", async () => {
    let failPass!: (e: Error) => void;
    mockReindexSessions.mockReturnValue(
      new Promise((_, reject) => {
        failPass = reject;
      }),
    );
    mockListSessions.mockResolvedValue([MOCK_SESSION]);
    const store = useSessionsStore();

    const background = store.ensureIndex({ force: true });
    const user = store.ensureIndex({ force: true, userInitiated: true });
    failPass(new Error("database is locked"));
    await Promise.all([background, user]);

    expect(mockReindexSessions).toHaveBeenCalledTimes(1);
    expect(store.error).toBe("Couldn't refresh sessions: database is locked");
  });

  it("a user's Refresh that hits a pass already running stays quiet", async () => {
    mockReindexSessions.mockRejectedValue({
      code: "ALREADY_INDEXING",
      message: "Indexing is already in progress.",
    });
    const store = useSessionsStore();

    await store.ensureIndex({ force: true, userInitiated: true });
    expect(store.error).toBeNull();
  });

  it("a successful forced pass clears an earlier load error", async () => {
    mockListSessions.mockRejectedValueOnce(new Error("database is locked"));
    const store = useSessionsStore();
    await store.fetchSessions();
    expect(store.error).toBe("database is locked");

    mockReindexSessions.mockResolvedValue([3, 10]);
    mockListSessions.mockResolvedValue([MOCK_SESSION]);
    await store.ensureIndex({ force: true });

    expect(store.error).toBeNull();
    expect(store.sessions).toHaveLength(1);
  });

  // The backend announces the pass finished before the command rejects, so
  // the store's own reload lands after the Refresh has reported its failure.
  it("keeps a failed Refresh's error when the index-finished reload lands after it", async () => {
    mockListSessions.mockResolvedValue([MOCK_SESSION]);
    const store = useSessionsStore();
    await store.watchIndexUpdates();
    await store.fetchSessions();

    mockListSessions.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve([MOCK_SESSION]), 5)),
    );
    mockReindexSessions.mockImplementation(async () => {
      listeners.get(IPC_EVENTS.INDEXING_FINISHED)?.();
      throw new Error("database is locked");
    });
    // The Refresh, then a Retry that fails the same way while it shows.
    for (let attempt = 0; attempt < 2; attempt++) {
      await store.ensureIndex({ force: true, userInitiated: true });
      await new Promise((resolve) => setTimeout(resolve, 20));
      await flushPromises();
      expect(store.error).toBe("Couldn't refresh sessions: database is locked");
    }
    expect(mockReindexSessions).toHaveBeenCalledTimes(2);

    // A later pass that succeeds still clears it.
    mockReindexSessions.mockReset().mockResolvedValue([3, 10]);
    await store.ensureIndex({ force: true });
    expect(store.error).toBeNull();
  });
});
