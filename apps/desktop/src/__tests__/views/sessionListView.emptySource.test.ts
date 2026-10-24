import { setupPinia } from "@tracepilot/test-utils";
import type { SessionListItem } from "@tracepilot/types";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reactive, ref } from "vue";
import { useSessionsStore } from "@/stores/sessions";
import SessionListView from "@/views/SessionListView.vue";

const routerPush = vi.fn();
const enabledFeatures = new Set<string>();
const preferences = reactive({
  isFeatureEnabled: (feature: string) => enabledFeatures.has(feature),
  whenReady: Promise.resolve(),
  autoRefreshEnabled: false,
  autoRefreshIntervalSeconds: 5,
  hideEmptySessions: true,
  sessionCacheSize: 20,
});

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: routerPush }),
  onBeforeRouteLeave: vi.fn(),
}));
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
vi.mock("@/composables/useLiveSessionBadges", () => ({
  useLiveSessionBadges: () => ({ liveBadge: () => null }),
}));
vi.mock("@/utils/sessionPrefetch", () => ({ prefetchRecentSessions: vi.fn() }));
// The list warms the Analytics cache in the background; left real, its mock
// IPC logs after the file finishes and Vitest fails the run on teardown.
vi.mock("@/stores/analytics", () => ({ useAnalyticsStore: () => ({ warm: vi.fn() }) }));
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

describe("Session list empty state with a source picked", () => {
  let store: ReturnType<typeof useSessionsStore>;
  let wrapper: ReturnType<typeof render> | undefined;

  beforeEach(() => {
    setupPinia();
    vi.clearAllMocks();
    preferences.hideEmptySessions = true;
    enabledFeatures.clear();
    store = useSessionsStore();
    vi.spyOn(store, "fetchSessions").mockResolvedValue(undefined);
    vi.spyOn(store, "reindex").mockResolvedValue(undefined);
    vi.spyOn(store, "ensureIndex").mockResolvedValue(undefined);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
  });

  it("says the picked source's sessions are hidden as empty when other sources have turns", async () => {
    store.sessions = [
      { ...session, source: "copilot" },
      {
        ...session,
        id: "claude-empty",
        summary: "Empty Claude session",
        source: "claudeCode",
        turnCount: 0,
      },
    ];
    store.filterSource = "claudeCode";
    wrapper = render();
    await flushPromises();

    expect(wrapper.get("h2").text()).toBe("Empty sessions are hidden");
    expect(wrapper.text()).toContain("Your Claude Code sessions have no conversation turns");
    expect(wrapper.get(".empty-state-btn--primary").text()).toBe("Show empty sessions");
    expect(wrapper.get(".empty-state-btn--secondary").text()).toBe("Clear filters");
    // The sidebar's count still covers every source.
    expect(store.visibleSessionCount).toBe(1);

    await wrapper.get(".empty-state-btn--primary").trigger("click");
    await flushPromises();
    expect(preferences.hideEmptySessions).toBe(false);
    expect(store.filterSource).toBe("claudeCode");
    expect(wrapper.findAll('[data-testid="session-card"]').map((c) => c.text())).toEqual([
      "Empty Claude session",
    ]);
  });

  it("does not blame hidden empty sessions for a source that has no sessions", async () => {
    store.sessions = [{ ...session, source: "copilot" }];
    store.filterSource = "claudeCode";
    wrapper = render();
    await flushPromises();

    expect(wrapper.get("h2").text()).toBe("No matching sessions");
    expect(wrapper.get(".empty-state-btn--primary").text()).toBe("Clear filters");
  });
});
