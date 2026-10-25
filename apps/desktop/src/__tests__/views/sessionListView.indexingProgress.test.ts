import { setupPinia } from "@tracepilot/test-utils";
import type { IndexingProgressPayload } from "@tracepilot/types";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reactive, ref } from "vue";
import type { IndexingEventsCallbacks } from "@/composables/useIndexingEvents";
import { useSessionsStore } from "@/stores/sessions";
import SessionListView from "@/views/SessionListView.vue";

const preferences = reactive({
  isFeatureEnabled: () => false,
  whenReady: Promise.resolve(),
  autoRefreshEnabled: false,
  autoRefreshIntervalSeconds: 5,
  hideEmptySessions: true,
  sessionCacheSize: 20,
});
// The view's indexing callbacks, so a test can deliver progress events.
let indexing: IndexingEventsCallbacks | undefined;

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
  useIndexingEvents: (callbacks: IndexingEventsCallbacks) => {
    indexing = callbacks;
    return { setup: vi.fn().mockResolvedValue(undefined) };
  },
}));
vi.mock("@/composables/usePerfMonitor", () => ({ usePerfMonitor: vi.fn() }));
vi.mock("@/composables/useRenderBudget", () => ({ useRenderBudget: vi.fn() }));
vi.mock("@/composables/useLiveSessionBadges", () => ({
  useLiveSessionBadges: () => ({ liveBadge: () => null }),
}));
vi.mock("@/composables/useScrollRestore", () => ({
  useScrollRestore: () => ({ pendingAnchorId: () => undefined }),
}));
vi.mock("@/utils/sessionPrefetch", () => ({ prefetchRecentSessions: vi.fn() }));
vi.mock("@/stores/analytics", () => ({ useAnalyticsStore: () => ({ warm: vi.fn() }) }));
vi.mock("@tracepilot/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tracepilot/ui")>()),
  useAutoRefresh: () => ({ refreshing: ref(false), refresh: vi.fn() }),
}));

const progress = (current: number, total: number) =>
  ({ current, total }) as unknown as IndexingProgressPayload;

describe("Session list indexing progress", () => {
  let wrapper: ReturnType<typeof mount> | undefined;

  beforeEach(() => {
    setupPinia();
    indexing = undefined;
    const store = useSessionsStore();
    vi.spyOn(store, "fetchSessions").mockResolvedValue(undefined);
    vi.spyOn(store, "ensureIndex").mockResolvedValue(undefined);
    store.indexing = true;
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
  });

  it("shows an empty bar, not NaN, until a progress event has a total", async () => {
    wrapper = mount(SessionListView, {
      attachTo: document.body,
      global: { stubs: { ErrorBoundary: { template: "<slot />" } } },
    });
    await flushPromises();
    const bar = () => wrapper?.get('[role="progressbar"]');

    indexing?.onProgress(progress(0, 0));
    await flushPromises();
    expect(bar()?.attributes("aria-valuenow")).toBe("0");
    expect(wrapper.text()).not.toContain("0 / 0 sessions");

    indexing?.onProgress(progress(5, 20));
    await flushPromises();
    expect(bar()?.attributes("aria-valuenow")).toBe("25");
    expect(wrapper.text()).toContain("5 / 20 sessions");
  });
});
