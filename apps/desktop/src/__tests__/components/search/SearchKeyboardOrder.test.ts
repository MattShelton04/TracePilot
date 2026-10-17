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

function result(id: number, sessionId: string): SearchResult {
  return {
    id,
    sessionId,
    sessionSummary: `Session ${sessionId}`,
    contentType: "user_message",
    snippet: `match ${id}`,
    turnNumber: 1,
    eventIndex: id,
    toolName: null,
    timestampUnix: 1_790_000_000 - id,
    metadataJson: null,
    sessionRepository: null,
    sessionBranch: null,
    sessionUpdatedAt: null,
    source: "copilot",
  } as SearchResult;
}

// Relevance order interleaves the sessions; the grouped view shows A1, A3, B2.
const RESULTS = [result(1, "a"), result(2, "b"), result(3, "a")];

async function settle() {
  await flushSearchQueue();
  await flushPromises();
}

async function searchIn(view: "flat" | "grouped") {
  mocks.searchContent.mockResolvedValue({
    ...emptySearchResponse,
    results: RESULTS,
    totalCount: 3,
  });
  wrapper = mount(SessionSearchView, { attachTo: document.body });
  await settle();
  const store = useSearchStore();
  store.resultViewMode = view;
  store.query = "match";
  await new Promise((resolve) => setTimeout(resolve, 200));
  await settle();
  return wrapper;
}

async function press(key: string) {
  document.body.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
  );
  await settle();
}

/** The snippet of the highlighted result, or null when none is on screen. */
function focusedText(w: VueWrapper): string | null {
  const focused = w.findAll(".result-focused");
  expect(focused.length).toBeLessThanOrEqual(1);
  return focused[0]?.find(".session-group-snippet, .result-snippet").text() ?? null;
}

beforeEach(() => {
  setupPinia();
  resetAllMocks();
  setupDefaultMocks();
  // jsdom has no layout or scrolling; the cursor scrolls its result into view.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = "";
});

describe("Search keyboard navigation follows the screen", () => {
  it("walks the grouped view top to bottom, not in relevance order", async () => {
    const w = await searchIn("grouped");

    await press("j");
    expect(focusedText(w)).toBe("match 1");
    await press("j");
    expect(focusedText(w)).toBe("match 3");
    await press("ArrowDown");
    expect(focusedText(w)).toBe("match 2");
    await press("k");
    expect(focusedText(w)).toBe("match 3");
  });

  it("skips the results of a collapsed group", async () => {
    const w = await searchIn("grouped");
    await w.findAll(".session-group-toggle")[0].trigger("click");

    await press("j");
    expect(focusedText(w)).toBe("match 2");
    await press("j");
    expect(focusedText(w)).toBe("match 2");
  });

  it("continues from a clicked result in the flat view", async () => {
    const w = await searchIn("flat");

    await w.findAll(".result-card")[1].trigger("click");
    expect(focusedText(w)).toBe("match 2");
    await press("j");
    expect(focusedText(w)).toBe("match 3");
  });

  it("continues from a clicked result in the grouped view", async () => {
    const w = await searchIn("grouped");

    // "match 3" sits second on screen, inside the first group.
    await w.findAll(".session-group-result")[1].trigger("click");
    expect(focusedText(w)).toBe("match 3");
    await press("j");
    expect(focusedText(w)).toBe("match 2");
    await press("k");
    await press("k");
    expect(focusedText(w)).toBe("match 1");
  });
});
