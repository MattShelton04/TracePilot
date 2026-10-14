import { setupPinia } from "@tracepilot/test-utils";
import type { SearchFacetsResponse, SearchResult } from "@tracepilot/types";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  emptyFacets,
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
  useSessionsStore: () => ({ repositories: [], sources: [] }),
}));
vi.mock("@tracepilot/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tracepilot/ui")>()),
  usePolling: () => ({ start: vi.fn(), stop: vi.fn() }),
}));

import { useSearchStore } from "@/stores/search";
import SessionSearchView from "@/views/SessionSearchView.vue";

let wrapper: VueWrapper | undefined;
let nextId = 1;

function result(sessionId: string): SearchResult {
  const id = nextId++;
  return {
    id,
    sessionId,
    sessionSummary: `Session ${sessionId}`,
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

/** Facets for the typed query; the view's own unfiltered fetch gets other numbers. */
function facetsForQuery(forQuery: SearchFacetsResponse | Promise<SearchFacetsResponse>) {
  mocks.getSearchFacets.mockImplementation((query?: string) =>
    query ? forQuery : Promise.resolve({ ...emptyFacets, totalMatches: 500, sessionCount: 40 }),
  );
}

async function settle() {
  await flushSearchQueue();
  await flushPromises();
}

async function searchGrouped(text: string) {
  wrapper = mount(SessionSearchView, { attachTo: document.body });
  await settle();
  const store = useSearchStore();
  store.resultViewMode = "grouped";
  store.query = text;
  await new Promise((resolve) => setTimeout(resolve, 200));
  await settle();
  return { w: wrapper, store };
}

const summary = (w: VueWrapper) => w.get(".results-summary-text").text().replace(/\s+/g, " ");
const groupCounts = (w: VueWrapper) => w.findAll(".session-group-count").map((c) => c.text());

beforeEach(() => {
  setupPinia();
  resetAllMocks();
  setupDefaultMocks();
  nextId = 1;
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = "";
});

describe("Search grouped view counts", () => {
  it("counts the sessions behind every page and keeps the page label", async () => {
    facetsForQuery({ ...emptyFacets, totalMatches: 120, sessionCount: 12 });
    mocks.searchContent.mockResolvedValueOnce(
      page([result("s1"), result("s1"), result("s2")], 120, true),
    );
    const { w, store } = await searchGrouped("retry");

    // A space separates the count from the timing.
    expect(summary(w)).toContain("across 12 sessions (");
    expect(summary(w)).toContain("page 1 of 3");
    // Matches interleave across pages, so no group claims "N+".
    expect(groupCounts(w)).toEqual(["2 matches on this page", "1 match on this page"]);

    mocks.searchContent.mockResolvedValueOnce(page([result("s3"), result("s3")], 120, true));
    store.nextPage();
    await settle();

    expect(summary(w)).toContain("across 12 sessions");
    expect(summary(w)).toContain("page 2 of 3");
  });

  it("shows no session count until this search's facets arrive", async () => {
    let resolveFacets: (f: SearchFacetsResponse) => void = () => {};
    facetsForQuery(new Promise((resolve) => (resolveFacets = resolve)));
    mocks.searchContent.mockResolvedValueOnce(page([result("s1"), result("s2")], 120, true));
    const { w } = await searchGrouped("retry");

    // Neither this page's 2 groups nor the earlier unfiltered facets' 40.
    expect(summary(w)).not.toContain("across");
    expect(summary(w)).toContain("page 1 of 3");

    resolveFacets({ ...emptyFacets, totalMatches: 120, sessionCount: 12 });
    await settle();
    expect(summary(w)).toContain("across 12 sessions");
  });

  it("drops a session count whose facets disagree with the result total", async () => {
    facetsForQuery({ ...emptyFacets, totalMatches: 119, sessionCount: 12 });
    mocks.searchContent.mockResolvedValueOnce(page([result("s1"), result("s2")], 120, true));
    const { w } = await searchGrouped("retry");

    expect(summary(w)).not.toContain("across");
  });

  it("counts this page's groups when every result fits on one page", async () => {
    facetsForQuery(new Promise(() => {}));
    mocks.searchContent.mockResolvedValueOnce(
      page([result("s1"), result("s1"), result("s2")], 3, false),
    );
    const { w } = await searchGrouped("retry");

    expect(summary(w)).toContain("across 2 sessions");
    expect(summary(w)).not.toContain("page");
    expect(groupCounts(w)).toEqual(["2 matches", "1 match"]);
  });
});
