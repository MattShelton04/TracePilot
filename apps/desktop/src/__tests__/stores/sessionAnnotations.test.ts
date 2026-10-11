// biome-ignore-all assist/source/organizeImports: mocks must register before the store import.
import { setupPinia } from "@tracepilot/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listeners = vi.hoisted(() => new Map<string, (event: { payload: unknown }) => void>());
vi.mock("@/utils/tauriEvents", () => ({
  safeListen: vi.fn(async (event: string, handler: (event: { payload: unknown }) => void) => {
    listeners.set(event, handler);
    return () => listeners.delete(event);
  }),
}));

const mockList = vi.fn();
const mockUpdate = vi.fn();
vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../mocks/client");
  return createClientMock({
    listSessionAnnotations: (...args: unknown[]) => mockList(...args),
    updateSessionAnnotation: (...args: unknown[]) => mockUpdate(...args),
  });
});

const toastError = vi.fn();
vi.mock("@/stores/toast", () => ({ useToastStore: () => ({ error: toastError }) }));

import { IPC_EVENTS } from "@tracepilot/client";
import { useSessionAnnotationsStore } from "../../stores/sessionAnnotations";

const annotation = (sessionId: string, fields: Record<string, unknown> = {}) => ({
  sessionId,
  starred: false,
  archived: false,
  tags: [],
  note: null,
  updatedAt: "2026-10-11T00:00:00.000Z",
  ...fields,
});

describe("session annotations store", () => {
  beforeEach(() => {
    setupPinia();
    listeners.clear();
    toastError.mockReset();
    mockList.mockReset().mockResolvedValue([annotation("a", { starred: true, tags: ["Bug"] })]);
    mockUpdate.mockReset();
  });

  it("loads once and exposes stars and tags", async () => {
    const store = useSessionAnnotationsStore();
    await store.load();
    await store.load();
    expect(mockList).toHaveBeenCalledTimes(1);
    expect(store.isStarred("a")).toBe(true);
    expect(store.isStarred("b")).toBe(false);
    expect(store.allTags).toEqual([{ tag: "Bug", count: 1 }]);
  });

  it("shows a change at once and keeps what the backend saved", async () => {
    const store = useSessionAnnotationsStore();
    await store.load();
    let resolve!: (value: unknown) => void;
    mockUpdate.mockReturnValue(new Promise((r) => (resolve = r)));

    const pending = store.setArchived("b", true);
    expect(store.isArchived("b")).toBe(true);
    resolve(annotation("b", { archived: true }));
    await pending;

    expect(mockUpdate).toHaveBeenCalledWith("b", { archived: true });
    expect(store.get("b")?.updatedAt).toBe("2026-10-11T00:00:00.000Z");
  });

  it("rolls back and reports a failed save", async () => {
    const store = useSessionAnnotationsStore();
    await store.load();
    mockUpdate.mockRejectedValue(new Error("disk full"));

    const result = await store.toggleStar("a");

    expect(result).toBeNull();
    expect(store.isStarred("a")).toBe(true);
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining("disk full"));
  });

  it("drops a session whose annotation is cleared", async () => {
    const store = useSessionAnnotationsStore();
    await store.load();
    mockUpdate.mockResolvedValue(annotation("a", { updatedAt: null }));
    await store.update("a", { starred: false, tags: [] });
    expect(store.get("a")).toBeUndefined();
    expect(store.allTags).toEqual([]);
  });

  it("applies changes saved by another window", async () => {
    const store = useSessionAnnotationsStore();
    await store.load();
    await store.watchChanges();
    listeners.get(IPC_EVENTS.SESSION_ANNOTATION_CHANGED)?.({
      payload: annotation("c", { note: "From the other window" }),
    });
    expect(store.get("c")?.note).toBe("From the other window");
  });
});
