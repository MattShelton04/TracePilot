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

describe("Session list rendering", () => {
  let wrapper: ReturnType<typeof render> | undefined;

  beforeEach(() => {
    setupPinia();
    vi.clearAllMocks();
    const store = useSessionsStore();
    vi.spyOn(store, "fetchSessions").mockResolvedValue(undefined);
    vi.spyOn(store, "ensureIndex").mockResolvedValue(undefined);
    store.sessions = Array.from({ length: 150 }, (_, i) => ({
      ...session,
      id: `session-${i}`,
      summary: `Session ${i}`,
    }));
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
  });

  it("paints the first cards before building the rest of a long list", async () => {
    wrapper = render();
    await flushPromises();
    const cards = () => wrapper?.findAll('[data-testid="session-card"]') ?? [];

    expect(cards().length).toBeGreaterThan(0);
    expect(cards().length).toBeLessThan(150);
    expect(wrapper.get('[data-testid="session-count"]').text()).toBe("150 sessions");

    await vi.waitFor(() => expect(cards()).toHaveLength(150));
  });
});
