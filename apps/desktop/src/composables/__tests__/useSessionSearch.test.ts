import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";

// Mock heavy dependencies that the composable transitively touches.
vi.mock("vue-router", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useRoute: () => ({ query: {}, path: "/search" }),
}));

vi.mock("@/composables/useIndexingEvents", () => ({
  useIndexingEvents: () => ({ setup: vi.fn().mockResolvedValue(undefined) }),
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
  results: [] as { id: number }[],
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
  setActivePinia(createPinia());
  storeState.contentTypes.splice(0, storeState.contentTypes.length);
  storeState.excludeContentTypes.splice(0, storeState.excludeContentTypes.length);
  storeState.repository = null;
  storeState.toolName = null;
  storeState.sessionId = null;
  storeState.dateFrom = null;
  storeState.dateTo = null;
  storeState.error = null;
  storeState.stats = null;
});

describe("useSessionSearch", () => {
  it("activeFilterCount reflects active store filters", async () => {
    storeState.contentTypes.push("user_message");
    storeState.repository = "acme/app";
    storeState.sessionId = "s1";
    const { api, wrapper } = runComposable();
    expect(api.activeFilterCount.value).toBe(3);
    wrapper.unmount();
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

  it("handleClearFilters resets store filters and the date preset", async () => {
    const { api, wrapper } = runComposable();
    api.activeDatePreset.value = "last-7-days";
    storeState.contentTypes.push("user_message");
    api.handleClearFilters();
    expect(storeState.clearFilters).toHaveBeenCalled();
    expect(api.activeDatePreset.value).toBe("all");
    wrapper.unmount();
  });
});
