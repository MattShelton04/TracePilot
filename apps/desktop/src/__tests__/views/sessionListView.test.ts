import { setupPinia } from "@tracepilot/test-utils";
import type { SessionListItem } from "@tracepilot/types";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reactive, ref } from "vue";
import { useSessionsStore } from "@/stores/sessions";
import SessionListView from "@/views/SessionListView.vue";

const routerPush = vi.fn();
const preferences = reactive({
  whenReady: Promise.resolve(),
  autoRefreshEnabled: false,
  autoRefreshIntervalSeconds: 5,
  hideEmptySessions: true,
  sessionCacheSize: 20,
});

vi.mock("vue-router", () => ({ useRouter: () => ({ push: routerPush }) }));
vi.mock("@/stores/preferences", () => ({ usePreferencesStore: () => preferences }));
vi.mock("@/stores/sessionDetail", () => ({
  useSessionDetailStore: () => ({ setCacheSize: vi.fn(), prefetchSession: vi.fn() }),
}));
vi.mock("@/stores/sessionTabs", () => ({ useSessionTabsStore: () => ({ openTab: vi.fn() }) }));
vi.mock("@/composables/useIndexingEvents", () => ({
  useIndexingEvents: () => ({ setup: vi.fn().mockResolvedValue(undefined) }),
}));
vi.mock("@/composables/usePerfMonitor", () => ({ usePerfMonitor: vi.fn() }));
vi.mock("@/composables/useRenderBudget", () => ({ useRenderBudget: vi.fn() }));
vi.mock("@/utils/sessionPrefetch", () => ({ prefetchRecentSessions: vi.fn() }));
vi.mock("@tracepilot/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tracepilot/ui")>()),
  useAutoRefresh: () => ({ refreshing: ref(false), refresh: vi.fn() }),
}));

const session: SessionListItem = {
  id: "audit-session",
  summary: "Keyboard navigation review",
  repository: "audit/demo",
  branch: "main",
  eventCount: 12,
  turnCount: 2,
  isRunning: false,
};

function render() {
  return mount(SessionListView, {
    attachTo: document.body,
    global: {
      stubs: {
        ErrorBoundary: { template: "<slot />" },
        SessionCard: {
          props: ["session"],
          template: '<article data-testid="session-card">{{ session.summary }}</article>',
        },
      },
    },
  });
}

describe("Session list empty-state recovery", () => {
  let store: ReturnType<typeof useSessionsStore>;
  let wrapper: ReturnType<typeof render> | undefined;

  beforeEach(() => {
    setupPinia();
    vi.clearAllMocks();
    preferences.hideEmptySessions = true;
    store = useSessionsStore();
    vi.spyOn(store, "fetchSessions").mockResolvedValue(undefined);
    vi.spyOn(store, "reindex").mockResolvedValue(undefined);
    vi.spyOn(store, "ensureIndex").mockResolvedValue(undefined);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
  });

  it("explains a profile with no sessions and offers the settings route", async () => {
    wrapper = render();
    await flushPromises();

    expect(wrapper.get("h2").text()).toBe("No sessions yet");
    expect(wrapper.text()).toContain("check the session directory in Settings");
    expect(wrapper.text()).not.toContain("Try a different search");
    await wrapper.get(".empty-state-btn--primary").trigger("click");
    expect(routerPush).toHaveBeenCalledWith({ name: "settings" });
  });

  it("clears search, repository and branch filters without changing sorting or empty visibility", async () => {
    store.sessions = [session];
    store.searchQuery = "No matching result";
    store.filterRepo = "audit/other";
    store.filterBranch = "missing-branch";
    store.sortBy = "oldest";
    wrapper = render();
    await flushPromises();

    expect(wrapper.get("h2").text()).toBe("No matching sessions");
    await wrapper.get(".empty-state-btn--primary").trigger("click");
    await flushPromises();

    expect(store.searchQuery).toBe("");
    expect(store.filterRepo).toBeNull();
    expect(store.filterBranch).toBeNull();
    expect(store.sortBy).toBe("oldest");
    expect(preferences.hideEmptySessions).toBe(true);
    expect(wrapper.findAll('[data-testid="session-card"]')).toHaveLength(1);
    expect(document.activeElement).toBe(
      wrapper.get('[data-testid="session-search"] input').element,
    );
  });

  it("reveals existing empty sessions and restores focus when its action disappears", async () => {
    store.sessions = [{ ...session, turnCount: 0 }];
    wrapper = render();
    await flushPromises();

    expect(wrapper.get("h2").text()).toBe("Empty sessions are hidden");
    expect(wrapper.get(".empty-state-btn--primary").text()).toBe("Show empty sessions");
    await wrapper.get(".empty-state-btn--primary").trigger("click");
    await flushPromises();

    expect(preferences.hideEmptySessions).toBe(false);
    expect(wrapper.findAll('[data-testid="session-card"]')).toHaveLength(1);
    expect(document.activeElement).toBe(
      wrapper.get('[data-testid="session-search"] input').element,
    );
  });

  it("keeps a clear-filters recovery available when hidden empty sessions also have filters", async () => {
    store.sessions = [{ ...session, turnCount: 0 }];
    store.filterBranch = "missing-branch";
    wrapper = render();
    await flushPromises();

    expect(wrapper.get("h2").text()).toBe("Empty sessions are hidden");
    await wrapper.get(".empty-state-btn--secondary").trigger("click");
    expect(store.filterBranch).toBeNull();
    expect(preferences.hideEmptySessions).toBe(true);
  });

  it("does not mistake a failed load for a profile with no sessions", async () => {
    store.error = "Session directory is unavailable";
    wrapper = render();
    await flushPromises();

    expect(wrapper.text()).toContain("Session directory is unavailable");
    expect(wrapper.find(".empty-state").exists()).toBe(false);
    expect(store.reindex).not.toHaveBeenCalled();
  });
});
