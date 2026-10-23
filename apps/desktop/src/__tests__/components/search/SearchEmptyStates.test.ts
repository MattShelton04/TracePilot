import { setupPinia } from "@tracepilot/test-utils";
import type { SearchResult } from "@tracepilot/types";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  emptySearchResponse,
  flushSearchQueue,
  mocks,
  resetAllMocks,
  setupDefaultMocks,
} from "@/__tests__/stores/search/setup";

// The real view and search store; only routing, URL sync, indexing events and
// polling are stubbed.
vi.mock("vue-router", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useRoute: () => ({ query: {}, path: "/search", fullPath: "/search" }),
  onBeforeRouteLeave: vi.fn(),
}));
vi.mock("@/composables/useSearchUrlSync", () => ({ useSearchUrlSync: () => undefined }));
vi.mock("@/composables/useIndexingEvents", () => ({
  useIndexingEvents: () => ({ setup: vi.fn().mockResolvedValue(undefined) }),
}));
vi.mock("@/stores/sessions", () => ({
  useSessionsStore: () => ({ repositories: [], sessions: [], sources: [] }),
}));
vi.mock("@tracepilot/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tracepilot/ui")>()),
  usePolling: () => ({ start: vi.fn(), stop: vi.fn() }),
}));

import { useSearchStore } from "@/stores/search";
import SessionSearchView from "@/views/SessionSearchView.vue";

const match = {
  id: 1,
  sessionId: "sess-1",
  sessionSummary: "Synthetic session",
  contentType: "user_message",
  snippet: "retry",
  turnNumber: 1,
  eventIndex: 0,
  toolName: null,
  timestampUnix: 1_790_000_000,
  metadataJson: null,
  sessionRepository: "acme/app",
  sessionBranch: "main",
  sessionUpdatedAt: null,
} as SearchResult;

const found = { ...emptySearchResponse, results: [match], totalCount: 1 };

let wrapper: VueWrapper | undefined;

async function mountView() {
  // An indexed session, so the landing offers the browse presets.
  mocks.getSearchStats.mockResolvedValue({
    totalRows: 1,
    indexedSessions: 1,
    totalSessions: 1,
    contentTypeCounts: [["user_message", 1]],
  });
  wrapper = mount(SessionSearchView, { attachTo: document.body });
  await flushSearchQueue();
  await flushPromises();
  return wrapper;
}

/** Set the query and let its debounced search finish. */
async function type(text: string) {
  useSearchStore().query = text;
  await new Promise((resolve) => setTimeout(resolve, 200));
  await flushSearchQueue();
  await flushPromises();
}

const noResults = (w: VueWrapper) => w.find('[data-testid="search-no-results"]');

beforeEach(() => {
  setupPinia();
  resetAllMocks();
  setupDefaultMocks();
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = "";
});

describe("Search empty states", () => {
  it("offers Clear filters when filters hide every match, and keeps the query", async () => {
    const w = await mountView();
    const store = useSearchStore();
    store.contentTypes = ["reasoning"];
    await type("retry");
    expect(noResults(w).text()).toContain("current filters");
    const button = noResults(w).find("button");
    expect(button.text()).toBe("Clear filters");

    mocks.searchContent.mockClear();
    mocks.searchContent.mockResolvedValue(found);
    await button.trigger("click");
    await flushSearchQueue();
    await flushPromises();

    expect(store.query).toBe("retry");
    expect(store.hasActiveFilters).toBe(false);
    expect(mocks.searchContent).toHaveBeenCalledTimes(1);
    expect(mocks.searchContent.mock.calls[0][0]).toBe("retry");
    expect(mocks.searchContent.mock.calls[0][1].contentTypes).toBeUndefined();
    expect(w.findAll(".result-card")).toHaveLength(1);
  });

  it("offers Clear search when no filter is set", async () => {
    const w = await mountView();
    await type("nothing-matches");

    const button = noResults(w).find("button");
    expect(button.text()).toBe("Clear search");
    await button.trigger("click");
    await flushSearchQueue();

    expect(useSearchStore().query).toBe("");
    expect(w.findComponent({ name: "SearchBrowsePresets" }).exists()).toBe(true);
  });

  it("shows the landing again after the query is deleted", async () => {
    mocks.searchContent.mockResolvedValue(found);
    const w = await mountView();
    await type("retry");
    expect(w.findAll(".result-card")).toHaveLength(1);

    await type("");

    expect(w.findAll(".result-card")).toHaveLength(0);
    expect(w.findComponent({ name: "SearchBrowsePresets" }).exists()).toBe(true);
    expect(mocks.searchContent).toHaveBeenCalledTimes(1);
  });

  it("disables a preset with nothing indexed instead of landing on No results", async () => {
    const w = await mountView();
    const preset = (label: string) =>
      w.findAll(".browse-preset-btn").find((b) => b.text().includes(label));

    const reasoning = preset("Reasoning");
    expect(reasoning?.attributes("disabled")).toBeDefined();
    expect(reasoning?.text()).toContain("None indexed");
    expect(preset("User Messages")?.attributes("disabled")).toBeUndefined();

    mocks.searchContent.mockClear();
    await reasoning?.trigger("click");
    await flushSearchQueue();
    await flushPromises();
    expect(mocks.searchContent).not.toHaveBeenCalled();
    expect(noResults(w).exists()).toBe(false);
  });
});
