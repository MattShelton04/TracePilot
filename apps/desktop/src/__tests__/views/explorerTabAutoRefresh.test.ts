import { setupPinia } from "@tracepilot/test-utils";
import type { SessionSource } from "@tracepilot/types";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reactive, ref } from "vue";
import { SESSION_VIEW_VISIBLE_KEY } from "@/composables/useVisibleAutoRefresh";
import { usePreferencesStore } from "@/stores/preferences";
import ExplorerTab from "../../views/tabs/ExplorerTab.vue";

// The Explorer's auto-refresh while its session tab is in the background.
const mocks = vi.hoisted(() => ({ sessionListFiles: vi.fn() }));

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../mocks/client");
  return createClientMock({
    sessionListFiles: mocks.sessionListFiles,
    sessionReadFile: vi.fn().mockResolvedValue(""),
    sessionSearchFiles: vi.fn(),
  });
});

const context = reactive({
  sessionId: "explorer-session",
  detail: { id: "explorer-session", source: "copilot" as SessionSource },
  plan: null,
  loadPlan: vi.fn(),
});

vi.mock("@/composables/useSessionDetailContext", () => ({
  useSessionDetailContext: () => context,
}));

enableAutoUnmount(afterEach);

describe("ExplorerTab auto-refresh", () => {
  beforeEach(async () => {
    setupPinia();
    vi.clearAllMocks();
    localStorage.clear();
    mocks.sessionListFiles.mockResolvedValue({
      root: "/home/user/.copilot/session-state/explorer-session",
      area: "session",
      areas: ["session"],
      entries: [],
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const prefs = usePreferencesStore();
    // Config hydration must finish first, or it resets these preferences.
    await prefs.whenReady;
    await flushPromises();
    prefs.autoRefreshEnabled = true;
    prefs.autoRefreshIntervalSeconds = 5;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits while its session tab is in the background, then refreshes on its return", async () => {
    const visible = ref(false);
    mount(ExplorerTab, {
      global: { provide: { [SESSION_VIEW_VISIBLE_KEY as symbol]: visible } },
    });
    await flushPromises();
    const listings = () => mocks.sessionListFiles.mock.calls.length;
    const afterMount = listings();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(listings()).toBe(afterMount);

    visible.value = true;
    await flushPromises();
    expect(listings()).toBe(afterMount + 1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(listings()).toBe(afterMount + 2);
  });

  it("keeps refreshing on its interval with no session detail around it", async () => {
    mount(ExplorerTab);
    await flushPromises();
    const afterMount = mocks.sessionListFiles.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.sessionListFiles.mock.calls.length).toBe(afterMount + 2);
  });
});
