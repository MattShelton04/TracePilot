import { setupPinia } from "@tracepilot/test-utils";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";

const routerPush = vi.hoisted(() => vi.fn());

// Mock heavy dependencies that the composable transitively touches.
vi.mock("vue-router", () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn() }),
  useRoute: () => ({ query: {}, path: "/search" }),
}));

// Captures the callbacks so tests can replay main-index events.
const indexingCallbacks = vi.hoisted(() => ({
  current: null as null | {
    onStarted: () => void;
    onProgress: (p: { current: number; total: number }) => void;
    onFinished: () => void;
  },
}));

vi.mock("@/composables/useIndexingEvents", () => ({
  useIndexingEvents: (callbacks: NonNullable<typeof indexingCallbacks.current>) => {
    indexingCallbacks.current = callbacks;
    return { setup: vi.fn().mockResolvedValue(undefined) };
  },
}));

vi.mock("@/composables/useSearchUrlSync", () => ({
  useSearchUrlSync: () => undefined,
}));

vi.mock("@tracepilot/ui", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@tracepilot/ui");
  return {
    ...actual,
    usePolling: () => ({ start: vi.fn(), stop: vi.fn() }),
    useToast: () => ({
      success: vi.fn().mockReturnValue("t1"),
      error: vi.fn().mockReturnValue("t2"),
      dismiss: vi.fn(),
    }),
  };
});

const storeState = {
  query: "",
  sessionId: null as string | null,
  source: null as string | null,
  effectiveSource: null as string | null,
  results: [] as {
    id: number;
    sessionId?: string;
    turnNumber?: number | null;
    eventIndex?: number | null;
  }[],
  groupedResults: [] as { sessionId: string; sessionSummary: string | null }[],
  resultViewMode: "flat" as "flat" | "grouped",
  contentTypes: [] as string[],
  excludeContentTypes: [] as string[],
  repository: null as string | null,
  toolName: null as string | null,
  dateFrom: null as string | null,
  dateTo: null as string | null,
  sortBy: "relevance",
  page: 1,
  pageSize: 50,
  totalCount: 0,
  totalPages: 0,
  hasQuery: false,
  hasMore: false,
  latencyMs: 0,
  stats: null as { totalSessions: number; contentTypeCounts: [string, number][] } | null,
  error: null as string | null,
  loading: false,
  hasResults: false,
  hasActiveFilters: false,
  isBrowseMode: false,
  searchIndexing: false,
  searchIndexingProgress: null,
  rebuilding: false,
  healthInfo: null,
  fetchStats: vi.fn(),
  fetchFilterOptions: vi.fn(),
  fetchFacets: vi.fn(),
  fetchFacetsForCurrentQuery: vi.fn(),
  fetchHealth: vi.fn().mockResolvedValue(undefined),
  setViewMounted: vi.fn(),
  clearAll: vi.fn(),
  clearFilters: vi.fn(() => {
    storeState.contentTypes.splice(0, storeState.contentTypes.length);
    storeState.excludeContentTypes.splice(0, storeState.excludeContentTypes.length);
  }),
  copySingleResult: vi.fn().mockResolvedValue(true),
  copyResultsToClipboard: vi.fn().mockResolvedValue(true),
  prevPage: vi.fn(),
  nextPage: vi.fn(),
  setPage: vi.fn(),
  rebuild: vi.fn(),
};

vi.mock("@/stores/search", () => ({
  useSearchStore: () => storeState,
}));

import { useSessionsStore } from "@/stores/sessions";
import { useSessionSearch } from "../useSessionSearch";

function runComposable() {
  let api!: ReturnType<typeof useSessionSearch>;
  const inputRef = ref<HTMLInputElement | null>(null);
  const Host = defineComponent({
    setup() {
      api = useSessionSearch({ searchInputRef: inputRef });
      return () => h("div");
    },
  });
  const wrapper = mount(Host);
  return { api, wrapper };
}

beforeEach(() => {
  setupPinia();
  storeState.contentTypes.splice(0, storeState.contentTypes.length);
  storeState.excludeContentTypes.splice(0, storeState.excludeContentTypes.length);
  storeState.repository = null;
  storeState.toolName = null;
  storeState.sessionId = null;
  storeState.source = null;
  storeState.effectiveSource = null;
  storeState.dateFrom = null;
  storeState.dateTo = null;
  storeState.error = null;
  storeState.stats = null;
  storeState.results = [];
  routerPush.mockClear();
});

describe("useSessionSearch", () => {
  it("fetches facets for the restored query on mount, not for the whole index", () => {
    storeState.fetchFacets.mockClear();
    storeState.fetchFacetsForCurrentQuery.mockClear();
    const { wrapper } = runComposable();
    expect(storeState.fetchFacetsForCurrentQuery).toHaveBeenCalledTimes(1);
    expect(storeState.fetchFacets).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("activeFilterCount reflects active store filters", async () => {
    storeState.contentTypes.push("user_message");
    storeState.repository = "acme/app";
    storeState.sessionId = "s1";
    const { api, wrapper } = runComposable();
    expect(api.activeFilterCount.value).toBe(3);
    wrapper.unmount();
  });

  it("shows the source filter only once two sources have sessions, or one is selected", () => {
    const sessions = useSessionsStore();
    sessions.sessions = [{ id: "a" }, { id: "b", source: "copilot" }] as never;
    const { api, wrapper } = runComposable();
    expect(api.showSourceFilter.value).toBe(false);

    storeState.source = "claudeCode";
    storeState.effectiveSource = "claudeCode";
    wrapper.unmount();
    const second = runComposable();
    expect(second.api.showSourceFilter.value).toBe(true);
    expect(second.api.activeFilterCount.value).toBe(1);
    second.wrapper.unmount();

    // A typed `source:` qualifier shows the switch too, with that source
    // offered even when no session has it, so the switch can show it picked.
    storeState.source = null;
    const typed = runComposable();
    expect(typed.api.showSourceFilter.value).toBe(true);
    expect(typed.api.sourceOptions.value).toEqual(["copilot", "claudeCode"]);
    typed.wrapper.unmount();

    storeState.effectiveSource = null;
    sessions.sessions = [{ id: "a" }, { id: "c", source: "claudeCode" }] as never;
    const third = runComposable();
    expect(third.api.showSourceFilter.value).toBe(true);
    expect(third.api.sourceOptions.value).toEqual(["copilot", "claudeCode"]);
    third.wrapper.unmount();
  });

  it("activeContentTypeChips includes both include and exclude modes", async () => {
    storeState.contentTypes.push("user_message");
    storeState.excludeContentTypes.push("tool_call");
    const { api, wrapper } = runComposable();
    expect(api.activeContentTypeChips.value).toEqual([
      { type: "user_message", mode: "include" },
      { type: "tool_call", mode: "exclude" },
    ]);
    wrapper.unmount();
  });

  it("removeContentTypeFilter clears include and exclude entries", async () => {
    const { api, wrapper } = runComposable();
    storeState.contentTypes.push("user_message");
    storeState.excludeContentTypes.push("user_message");
    api.removeContentTypeFilter("user_message" as never);
    expect(storeState.contentTypes).toEqual([]);
    expect(storeState.excludeContentTypes).toEqual([]);
    wrapper.unmount();
  });

  it("sessionLink builds canonical URLs with optional turn/event", () => {
    const { api, wrapper } = runComposable();
    expect(api.sessionLink("abc", null, null)).toBe("/session/abc/conversation");
    expect(api.sessionLink("abc", 3, null)).toBe("/session/abc/conversation?turn=3");
    expect(api.sessionLink("abc", 3, 7)).toBe("/session/abc/conversation?turn=3&event=7");
    wrapper.unmount();
  });

  it("Ctrl+Enter opens the highlighted result at its deep link", () => {
    storeState.results = [
      { id: 1, sessionId: "first", turnNumber: 0, eventIndex: 2 },
      { id: 2, sessionId: "second", turnNumber: 4, eventIndex: 9 },
    ];
    const { wrapper } = runComposable();
    const key = (init: KeyboardEventInit) =>
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
      );

    key({ key: "ArrowDown" });
    key({ key: "ArrowDown" });
    key({ key: "Enter", ctrlKey: true });

    expect(routerPush).toHaveBeenCalledWith("/session/second/conversation?turn=4&event=9");
    wrapper.unmount();
  });

  // The date preset highlight is derived from the store's dates in the sidebar
  // (see SearchDateFilter.test.ts), so clearing the store clears it too.
  it("handleClearFilters resets store filters and the session name override", async () => {
    const { api, wrapper } = runComposable();
    api.filteredSessionNameOverride.value = "Synthetic session";
    storeState.contentTypes.push("user_message");
    api.handleClearFilters();
    expect(storeState.clearFilters).toHaveBeenCalled();
    expect(api.filteredSessionNameOverride.value).toBeNull();
    wrapper.unmount();
  });

  it("shows a main-index pass that started before Search was opened", () => {
    // INDEXING_STARTED fired before this view mounted; only PROGRESS arrives.
    const { api, wrapper } = runComposable();
    const events = indexingCallbacks.current!;
    expect(api.isIndexing.value).toBe(false);

    events.onProgress({ current: 4, total: 12 });
    expect(api.isIndexing.value).toBe(true);
    expect(api.indexingProgress.value).toEqual({ current: 4, total: 12 });

    events.onFinished();
    expect(api.isIndexing.value).toBe(false);
    expect(api.indexingProgress.value).toBeNull();
    wrapper.unmount();
  });

  it("does not start the banner from a pass's final PROGRESS event", () => {
    const { api, wrapper } = runComposable();
    indexingCallbacks.current!.onProgress({ current: 12, total: 12 });
    expect(api.isIndexing.value).toBe(false);
    wrapper.unmount();
  });
});
