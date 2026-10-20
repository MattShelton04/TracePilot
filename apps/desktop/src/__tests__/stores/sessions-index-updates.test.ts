// biome-ignore-all assist/source/organizeImports: mocks must register before the store import.
import { createDeferred, setupPinia } from "@tracepilot/test-utils";
import type { SessionListItem } from "@tracepilot/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listeners = vi.hoisted(() => new Map<string, () => void>());
vi.mock("@/utils/tauriEvents", () => ({
  safeListen: vi.fn(async (event: string, handler: () => void) => {
    listeners.set(event, handler);
    return () => listeners.delete(event);
  }),
}));

const mockListSessions = vi.fn();
vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../mocks/client");
  return createClientMock({
    listSessions: (...args: unknown[]) => mockListSessions(...args),
  });
});

import { IPC_EVENTS } from "@tracepilot/client";
import { flushPromises } from "@vue/test-utils";
import { useSessionsStore } from "../../stores/sessions";

describe("sessions store index updates", () => {
  beforeEach(() => {
    setupPinia();
    listeners.clear();
    mockListSessions.mockReset().mockResolvedValue([]);
  });

  it("reloads the list when indexing finishes, so a purged source drops out", async () => {
    const store = useSessionsStore();
    await store.watchIndexUpdates();
    await store.fetchSessions();
    expect(mockListSessions).toHaveBeenCalledTimes(1);

    listeners.get(IPC_EVENTS.INDEXING_FINISHED)?.();
    await flushPromises();
    expect(mockListSessions).toHaveBeenCalledTimes(2);
  });

  it("refetches after a list read that began before the pass finished", async () => {
    const before = [session("old")];
    const after = [session("old"), session("new")];
    const stale = createDeferred<SessionListItem[]>();
    mockListSessions.mockReturnValueOnce(stale.promise).mockResolvedValue(after);
    const store = useSessionsStore();
    await store.watchIndexUpdates();

    const pending = store.refreshSessions();
    listeners.get(IPC_EVENTS.INDEXING_FINISHED)?.();
    listeners.get(IPC_EVENTS.INDEXING_FINISHED)?.();
    stale.resolve(before);
    await pending;
    await flushPromises();

    // Both events share one trailing read, and its list is the one shown.
    expect(store.sessions.map((s) => s.id)).toEqual(["old", "new"]);
    expect(mockListSessions).toHaveBeenCalledTimes(2);
  });

  it("does not refetch when no list read is in flight", async () => {
    const store = useSessionsStore();
    await store.watchIndexUpdates();

    listeners.get(IPC_EVENTS.INDEXING_FINISHED)?.();
    await flushPromises();
    expect(mockListSessions).toHaveBeenCalledTimes(1);
  });

  it("lets a newer fetch started after the pass serve the trailing read", async () => {
    const stale = createDeferred<SessionListItem[]>();
    const fresh = createDeferred<SessionListItem[]>();
    mockListSessions.mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise);
    const store = useSessionsStore();
    await store.watchIndexUpdates();

    void store.refreshSessions();
    listeners.get(IPC_EVENTS.INDEXING_FINISHED)?.();
    stale.resolve([session("old")]);
    await flushPromises();
    expect(mockListSessions).toHaveBeenCalledTimes(2);

    // An explicit fetch now coalesces onto the trailing read rather than racing it.
    const explicit = store.fetchSessions();
    fresh.resolve([session("new")]);
    await explicit;
    await flushPromises();
    expect(mockListSessions).toHaveBeenCalledTimes(2);
    expect(store.sessions.map((s) => s.id)).toEqual(["new"]);
  });
});

function session(id: string): SessionListItem {
  return { id, updatedAt: "2025-01-01T00:00:00Z" } as SessionListItem;
}
