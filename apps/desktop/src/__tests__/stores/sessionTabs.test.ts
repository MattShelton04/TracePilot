import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { useSessionTabsStore } from "../../stores/sessionTabs";

// ── localStorage mock ─────────────────────────────────────────
let storageMap: Record<string, string> = {};

const mockStorage = {
  getItem: vi.fn((key: string) => storageMap[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    storageMap[key] = value;
  }),
};

beforeEach(() => {
  storageMap = {};
  vi.stubGlobal("localStorage", mockStorage);
  setActivePinia(createPinia());
});

describe("useSessionTabsStore", () => {
  it("initializes with empty tabs when storage is empty", () => {
    const store = useSessionTabsStore();
    expect(store.tabs).toEqual([]);
    expect(store.activeTabId).toBeNull();
  });

  it("loads from localStorage on init", () => {
    storageMap["tracepilot:session-tabs"] = JSON.stringify({
      tabs: [{ sessionId: "s1", label: "Session 1", activeSubTab: "overview" }],
      activeId: "s1",
    });

    const store = useSessionTabsStore();
    expect(store.tabs).toHaveLength(1);
    expect(store.tabs[0].sessionId).toBe("s1");
    expect(store.activeTabId).toBe("s1");
  });

  it("persists to localStorage when opening a tab", async () => {
    const store = useSessionTabsStore();
    store.openTab("s2", "New Session");

    // Wait for usePersistedRef's async watch
    await nextTick();
    await nextTick();

    expect(mockStorage.setItem).toHaveBeenCalledWith(
      "tracepilot:session-tabs",
      expect.stringContaining('"sessionId":"s2"'),
    );

    const saved = JSON.parse(storageMap["tracepilot:session-tabs"]);
    expect(saved.tabs).toHaveLength(1);
    expect(saved.activeId).toBe("s2");
  });

  it("persists to localStorage when closing a tab", async () => {
    storageMap["tracepilot:session-tabs"] = JSON.stringify({
      tabs: [{ sessionId: "s1", label: "S1", activeSubTab: "overview" }],
      activeId: "s1",
    });

    const store = useSessionTabsStore();
    expect(store.tabs).toHaveLength(1);

    store.closeTab("s1");
    await nextTick();
    await nextTick();

    const saved = JSON.parse(storageMap["tracepilot:session-tabs"]);
    expect(saved.tabs).toEqual([]);
    expect(saved.activeId).toBeNull();
  });
});
