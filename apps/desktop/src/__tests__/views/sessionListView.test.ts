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

// The list's sort and filters persist; start every test from the defaults.
beforeEach(() => localStorage.clear());

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

  it("explains a profile with no sessions and offers the settings route", async () => {
    wrapper = render();
    await flushPromises();

    expect(wrapper.get("h2").text()).toBe("No sessions yet");
    expect(wrapper.text()).toContain("check the session directory in Settings");
    expect(wrapper.text()).not.toContain("Try a different search");
    await wrapper.get(".empty-state-btn--primary").trigger("click");
    expect(routerPush).toHaveBeenCalledWith({ name: "settings" });
  });

  it("names both sources when Claude Code sessions are enabled", async () => {
    enabledFeatures.add("claudeCodeSessions");
    wrapper = render();
    await flushPromises();

    expect(wrapper.text()).toContain("Start a Copilot CLI or Claude Code session");
    expect(wrapper.text()).toContain("check the session folders in Settings");
  });

  it("clears search, repository and source filters without changing sorting or empty visibility", async () => {
    store.sessions = [session];
    store.searchQuery = "No matching result";
    store.filterRepo = "audit/other";
    store.filterSource = "claudeCode";
    store.sortBy = "oldest";
    wrapper = render();
    await flushPromises();

    expect(wrapper.get("h2").text()).toBe("No matching sessions");
    await wrapper.get(".empty-state-btn--primary").trigger("click");
    await flushPromises();

    expect(store.searchQuery).toBe("");
    expect(store.filterRepo).toBeNull();
    expect(store.filterSource).toBeNull();
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
    store.filterRepo = "audit/other";
    wrapper = render();
    await flushPromises();

    expect(wrapper.get("h2").text()).toBe("Empty sessions are hidden");
    await wrapper.get(".empty-state-btn--secondary").trigger("click");
    expect(store.filterRepo).toBeNull();
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

describe("Session list repository filter", () => {
  beforeEach(() => {
    setupPinia();
    preferences.hideEmptySessions = true;
  });

  it("offers a folder for a session with only a cwd and filters to it", async () => {
    const store = useSessionsStore();
    vi.spyOn(store, "ensureIndex").mockResolvedValue(undefined);
    store.sessions = [
      session,
      {
        ...session,
        id: "cwd-only",
        summary: "Folder session",
        repository: null,
        cwd: "C:/work/orchard",
      },
    ];
    const wrapper = render();
    await flushPromises();

    const select = wrapper.get('select[aria-label="All Repos"]');
    expect(select.findAll("optgroup").map((g) => g.attributes("label"))).toEqual([
      "Repositories",
      "Folders",
    ]);
    await select.setValue("project:orchard");
    expect(wrapper.findAll('[data-testid="session-card"]').map((c) => c.text())).toEqual([
      "Folder session",
    ]);
    wrapper.unmount();
  });

  describe("with two sources", () => {
    let store: ReturnType<typeof useSessionsStore>;
    let wrapper: ReturnType<typeof render> | undefined;

    beforeEach(() => {
      store = useSessionsStore();
      vi.spyOn(store, "ensureIndex").mockResolvedValue(undefined);
      store.sessions = [
        { ...session, id: "cp-1", summary: "Copilot demo", source: "copilot" },
        {
          ...session,
          id: "cp-2",
          summary: "Copilot only",
          repository: "audit/copilot-only",
          source: "copilot",
        },
        {
          ...session,
          id: "cc-1",
          summary: "Claude work",
          repository: "audit/claude",
          source: "claudeCode",
        },
        // Hidden by "Hide empty sessions", so its repository leads nowhere.
        {
          ...session,
          id: "cc-empty",
          summary: "Claude draft",
          repository: "audit/hidden",
          source: "claudeCode",
          turnCount: 0,
        },
      ];
    });

    afterEach(() => {
      wrapper?.unmount();
      wrapper = undefined;
    });

    const repoOptions = () =>
      wrapper
        ?.get('select[aria-label="All Repos"]')
        .findAll("option")
        .map((o) => o.attributes("value"))
        .filter(Boolean);
    const cards = () => wrapper?.findAll('[data-testid="session-card"]').map((c) => c.text());
    const pickSource = (label: string) =>
      wrapper
        ?.findAll('[data-testid="session-source-filter"] [role="radio"]')
        .find((b) => b.text() === label)
        ?.trigger("click");

    it("offers only repositories that have visible sessions in the picked source", async () => {
      wrapper = render();
      await flushPromises();

      expect(repoOptions()).toEqual(["audit/claude", "audit/copilot-only", "audit/demo"]);

      await pickSource("Claude");
      expect(repoOptions()).toEqual(["audit/claude"]);

      preferences.hideEmptySessions = false;
      await flushPromises();
      expect(repoOptions()).toEqual(["audit/claude", "audit/hidden"]);
    });

    it("clears a repository the new source has no sessions in", async () => {
      wrapper = render();
      await flushPromises();
      await wrapper.get('select[aria-label="All Repos"]').setValue("audit/copilot-only");
      expect(cards()).toEqual(["Copilot only"]);

      await pickSource("Claude");
      expect(store.filterRepo).toBeNull();
      expect(cards()).toEqual(["Claude work"]);
      expect(wrapper.text()).not.toContain("No matching sessions");
    });

    it("keeps a repository the new source still has sessions in", async () => {
      wrapper = render();
      await flushPromises();
      await pickSource("Claude");
      await wrapper.get('select[aria-label="All Repos"]').setValue("audit/claude");

      await pickSource("All");
      expect(store.filterRepo).toBe("audit/claude");
      expect(cards()).toEqual(["Claude work"]);
    });

    it("keeps the selected repository listed when no visible session has it", async () => {
      store.filterRepo = "audit/hidden";
      wrapper = render();
      await flushPromises();

      const select = wrapper.get<HTMLSelectElement>('select[aria-label="All Repos"]');
      expect(repoOptions()).toContain("audit/hidden");
      expect(select.element.value).toBe("audit/hidden");
    });
  });
});

describe("Session list freshness while it stays open", () => {
  const T0 = new Date("2026-10-14T09:00:00Z").getTime();
  let store: ReturnType<typeof useSessionsStore>;
  let wrapper: ReturnType<typeof mount> | undefined;

  function renderWithCards() {
    return mount(SessionListView, {
      attachTo: document.body,
      global: { stubs: { ErrorBoundary: { template: "<slot />" } } },
    });
  }

  function setHidden(hidden: boolean) {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(T0);
    setupPinia();
    vi.clearAllMocks();
    setHidden(false);
    preferences.hideEmptySessions = true;
    store = useSessionsStore();
    store.sessions = [{ ...session, isRunning: true, updatedAt: new Date(T0).toISOString() }];
    vi.spyOn(store, "ensureIndex").mockResolvedValue(undefined);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    vi.useRealTimers();
    setHidden(false);
  });

  it("drops a stale Active badge when the user returns to the window, without reindexing", async () => {
    // The backend recomputes running state on every list call; the session
    // has since ended in its terminal.
    const refresh = vi.spyOn(store, "refreshSessions").mockImplementation(async () => {
      store.sessions = [{ ...store.sessions[0], isRunning: false }];
    });
    wrapper = renderWithCards();
    await flushPromises();
    expect(wrapper.find(".active-badge").exists()).toBe(true);
    const ensureCalls = vi.mocked(store.ensureIndex).mock.calls.length;

    // Returning right after the list loaded does not refetch it.
    window.dispatchEvent(new Event("focus"));
    expect(refresh).not.toHaveBeenCalled();

    vi.setSystemTime(T0 + 31_000);
    window.dispatchEvent(new Event("focus"));
    await flushPromises();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(store.ensureIndex).toHaveBeenCalledTimes(ensureCalls);
    expect(wrapper.find(".active-badge").exists()).toBe(false);

    // Focus and visibility both fire on return; the pair refreshes once.
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
    expect(refresh).toHaveBeenCalledTimes(1);

    vi.setSystemTime(T0 + 62_000);
    setHidden(true);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(refresh).toHaveBeenCalledTimes(1);
    setHidden(false);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(refresh).toHaveBeenCalledTimes(2);

    wrapper.unmount();
    wrapper = undefined;
    vi.setSystemTime(T0 + 120_000);
    window.dispatchEvent(new Event("focus"));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("does not refetch on focus while the list is loading or indexing", async () => {
    const refresh = vi.spyOn(store, "refreshSessions").mockResolvedValue(undefined);
    wrapper = renderWithCards();
    await flushPromises();

    vi.setSystemTime(T0 + 31_000);
    store.indexing = true;
    window.dispatchEvent(new Event("focus"));
    store.indexing = false;
    store.loading = true;
    window.dispatchEvent(new Event("focus"));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("keeps relative update times current while the list stays open", async () => {
    vi.spyOn(store, "refreshSessions").mockResolvedValue(undefined);
    wrapper = renderWithCards();
    await flushPromises();
    expect(wrapper.get(".card-time-new").text()).toBe("now");

    vi.advanceTimersByTime(5 * 60_000);
    await flushPromises();
    expect(wrapper.get(".card-time-new").text()).toBe("5m");
  });
});

describe("Session list count while filtered", () => {
  let store: ReturnType<typeof useSessionsStore>;
  let wrapper: ReturnType<typeof render> | undefined;

  beforeEach(() => {
    setupPinia();
    preferences.hideEmptySessions = true;
    store = useSessionsStore();
    vi.spyOn(store, "ensureIndex").mockResolvedValue(undefined);
    store.sessions = [
      session,
      { ...session, id: "second", summary: "Export polish" },
      { ...session, id: "third", summary: "Export retries", repository: "audit/other" },
      // Hidden by "Hide empty sessions", so it is never counted.
      { ...session, id: "empty", summary: "Export draft", turnCount: 0 },
    ];
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
  });

  const count = () => wrapper?.get('[data-testid="session-count"]').text();

  it("counts the sessions shown, with no Clear action, whatever narrows the list", async () => {
    wrapper = render();
    await flushPromises();
    expect(count()).toBe("3 sessions");

    await wrapper.get('[data-testid="session-search"] input').setValue("export");
    expect(count()).toBe("2 sessions");

    await wrapper.get('select[aria-label="All Repos"]').setValue("audit/other");
    expect(count()).toBe("1 session");
    // The count stays one short label, so the toolbar keeps its width.
    expect(wrapper.find('[data-testid="session-clear-filters"]').exists()).toBe(false);
  });
});

describe("Session list count before the first list arrives", () => {
  let store: ReturnType<typeof useSessionsStore>;
  let wrapper: ReturnType<typeof render> | undefined;

  beforeEach(() => {
    setupPinia();
    preferences.hideEmptySessions = true;
    store = useSessionsStore();
    vi.spyOn(store, "fetchSessions").mockResolvedValue(undefined);
    vi.spyOn(store, "reindex").mockResolvedValue(undefined);
    vi.spyOn(store, "ensureIndex").mockResolvedValue(undefined);
  });

  afterEach(() => wrapper?.unmount());
  const count = () => wrapper?.get('[data-testid="session-count"]').text();

  it.each([
    ["loading", () => (store.loading = true)],
    ["indexing for the first time", () => (store.indexing = true)],
    ["after a failed first load", () => (store.error = "Index unavailable")],
  ])("shows no count while %s", async (_state, enter) => {
    enter();
    wrapper = render();
    await flushPromises();
    // Unknown, not zero; one dash keeps the label as long as "0 sessions".
    expect(count()).toBe("– sessions");
  });

  it("counts once the list arrives, including an empty one", async () => {
    store.loading = true;
    wrapper = render();
    await flushPromises();
    store.loading = false;
    await flushPromises();
    expect(count()).toBe("0 sessions");
    store.sessions = [session];
    await flushPromises();
    expect(count()).toBe("1 session");
    // A later refresh keeps the count it already has.
    store.loading = true;
    await flushPromises();
    expect(count()).toBe("1 session");
  });
});
