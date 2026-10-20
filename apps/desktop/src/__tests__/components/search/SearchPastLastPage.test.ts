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

let wrapper: VueWrapper | undefined;

function result(id: number): SearchResult {
  return {
    id,
    sessionId: "s1",
    sessionSummary: "Session s1",
    contentType: "user_message",
    snippet: "retry",
    turnNumber: 1,
    eventIndex: id,
    toolName: null,
    timestampUnix: 1_790_000_000 - id,
    metadataJson: null,
    sessionRepository: "acme/app",
    sessionBranch: "main",
    sessionUpdatedAt: null,
    source: "copilot",
  } as SearchResult;
}

function page(results: SearchResult[], totalCount: number, hasMore: boolean) {
  return { ...emptySearchResponse, results, totalCount, hasMore };
}

async function settle() {
  await flushSearchQueue();
  await flushPromises();
}

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

describe("Search page past the last page", () => {
  it("offers the last page instead of pagination when the index has shrunk", async () => {
    wrapper = mount(SessionSearchView, { attachTo: document.body });
    await settle();
    const store = useSearchStore();

    // Six pages of matches.
    mocks.searchContent.mockResolvedValue(page([result(1)], 300, true));
    store.query = "retry";
    await new Promise((resolve) => setTimeout(resolve, 200));
    await settle();
    expect(store.totalPages).toBe(6);

    // The index shrinks to three pages before page 5 loads, so it comes back empty.
    mocks.searchContent.mockResolvedValue(page([], 120, false));
    store.setPage(5);
    await settle();

    expect(store.page).toBe(5);
    expect(store.totalPages).toBe(3);
    const w = wrapper;
    const pastEnd = w.get('[data-testid="search-past-last-page"]');
    expect(pastEnd.text()).toContain("No results on page 5");
    expect(pastEnd.text()).toContain("now fit on 3 pages");
    expect(w.text()).not.toContain("No results found");
    expect(w.find(".pagination").exists()).toBe(false);
    expect(w.get(".results-summary-text").text().replace(/\s+/g, " ")).toContain(
      "Found 120 results",
    );

    mocks.searchContent.mockResolvedValue(page([result(2)], 120, false));
    await pastEnd.get("button").trigger("click");
    await settle();

    expect(store.page).toBe(3);
    expect(mocks.searchContent).toHaveBeenLastCalledWith(
      "retry",
      expect.objectContaining({ offset: 100 }),
    );
    expect(w.find('[data-testid="search-past-last-page"]').exists()).toBe(false);
    expect(w.find(".results-list .result-card").exists()).toBe(true);
  });
});
