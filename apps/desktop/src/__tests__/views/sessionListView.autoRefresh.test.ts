import { setupPinia } from "@tracepilot/test-utils";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reactive, ref } from "vue";
import { useSessionsStore } from "@/stores/sessions";
import SessionListView from "@/views/SessionListView.vue";

// The list's auto-refresh while App.vue keeps it mounted under a session tab.
const preferences = reactive({
  isFeatureEnabled: () => false,
  whenReady: Promise.resolve(),
  autoRefreshEnabled: true,
  autoRefreshIntervalSeconds: 5,
  hideEmptySessions: true,
  sessionCacheSize: 20,
});

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
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
vi.mock("@/stores/analytics", () => ({ useAnalyticsStore: () => ({ warm: vi.fn() }) }));

describe("Session list auto-refresh under a session tab", () => {
  let ensureIndex: ReturnType<typeof vi.fn>;
  let wrapper: ReturnType<typeof mount> | undefined;

  beforeEach(() => {
    setupPinia();
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const store = useSessionsStore();
    vi.spyOn(store, "fetchSessions").mockResolvedValue(undefined);
    vi.spyOn(store, "reindex").mockResolvedValue(undefined);
    ensureIndex = vi.spyOn(store, "ensureIndex").mockResolvedValue(undefined) as never;
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    vi.useRealTimers();
  });

  /** The forced reindexes auto-refresh ran (the mount's own check isn't forced). */
  const forcedReindexes = () =>
    ensureIndex.mock.calls.filter(([opts]) => (opts as { force?: boolean })?.force).length;

  it("waits while a session tab covers the list, then refreshes on its return", async () => {
    const routeViewVisible = ref(false);
    wrapper = mount(SessionListView, {
      global: {
        provide: { routeViewVisible },
        stubs: { ErrorBoundary: { template: "<slot />" } },
      },
    });
    await flushPromises();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(forcedReindexes()).toBe(0);

    routeViewVisible.value = true;
    await flushPromises();
    expect(forcedReindexes()).toBe(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(forcedReindexes()).toBe(2);

    routeViewVisible.value = false;
    await flushPromises();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(forcedReindexes()).toBe(2);
  });

  it("keeps refreshing on its interval while the list shows", async () => {
    wrapper = mount(SessionListView, {
      global: { stubs: { ErrorBoundary: { template: "<slot />" } } },
    });
    await flushPromises();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(forcedReindexes()).toBe(3);
  });
});
