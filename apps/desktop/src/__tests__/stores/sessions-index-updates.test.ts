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
});
