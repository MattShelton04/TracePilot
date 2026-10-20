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

describe("Session list search by pull request", () => {
  let store: ReturnType<typeof useSessionsStore>;
  let wrapper: ReturnType<typeof render> | undefined;

  beforeEach(() => {
    setupPinia();
    preferences.hideEmptySessions = true;
    store = useSessionsStore();
    vi.spyOn(store, "ensureIndex").mockResolvedValue(undefined);
    const linked = (number: number) => ({
      count: 1,
      primary: { host: "github.com", owner: "audit", repo: "demo", number, url: "", state: null },
      pullRequests: [{ owner: "audit", repo: "demo", number, title: null }],
    });
    store.sessions = [
      { ...session, linkedPullRequests: linked(12) },
      { ...session, id: "other", summary: "Export polish", linkedPullRequests: linked(120) },
    ];
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
  });

  function paste(input: HTMLInputElement, text: string) {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { getData: () => text } });
    input.dispatchEvent(event);
    return event;
  }

  it("turns a pasted pull request URL into its owner/repo#n and finds its sessions", async () => {
    wrapper = render();
    await flushPromises();
    const input = wrapper.get('[data-testid="session-search"] input').element as HTMLInputElement;

    const event = paste(input, "https://github.com/audit/demo/pull/12/files\n");
    await flushPromises();
    expect(event.defaultPrevented).toBe(true);
    expect(store.searchQuery).toBe("audit/demo#12");
    expect(input.value).toBe("audit/demo#12");
    expect(wrapper.findAll('[data-testid="session-card"]').map((c) => c.text())).toEqual([
      "Keyboard navigation review",
    ]);
  });

  it("leaves other pastes to the input", async () => {
    wrapper = render();
    await flushPromises();
    const input = wrapper.get('[data-testid="session-search"] input').element as HTMLInputElement;
    expect(paste(input, "export").defaultPrevented).toBe(false);
    expect(store.searchQuery).toBe("");
  });
});
