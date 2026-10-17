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

// The real view, search store and sidebar; only routing, URL sync, indexing
// events and polling are stubbed.
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
import { presetRange } from "@/utils/analyticsFilters";
import SessionSearchView from "@/views/SessionSearchView.vue";

let wrapper: VueWrapper | undefined;

async function mountView() {
  wrapper = mount(SessionSearchView, { attachTo: document.body });
  await flushSearchQueue();
  await flushPromises();
  return wrapper;
}

const pressedPresets = (w: VueWrapper) =>
  w
    .findAll(".date-preset-btn")
    .filter((b) => b.attributes("aria-pressed") === "true")
    .map((b) => b.text());

const dateChip = (w: VueWrapper) => w.find('[data-testid="search-date-chip"]');

async function pickPreset(w: VueWrapper, label: string) {
  const button = w.findAll(".date-preset-btn").find((b) => b.text() === label);
  if (!button) throw new Error(`no date preset "${label}"`);
  await button.trigger("click");
  await flushSearchQueue();
}

/** A "7 Days" search; with no results the "No results found" state shows. */
async function searchSevenDays(w: VueWrapper, results: SearchResult[] = []) {
  const store = useSearchStore();
  mocks.searchContent.mockResolvedValue({
    ...emptySearchResponse,
    results,
    totalCount: results.length,
  });
  await pickPreset(w, "7 Days");
  store.query = "auth";
  await new Promise((resolve) => setTimeout(resolve, 200));
  await flushSearchQueue();
  await flushPromises();
  expect(store.dateFrom).not.toBeNull();
  expect(pressedPresets(w)).toEqual(["7 Days"]);
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

describe("Search date filter", () => {
  it("highlights All Time again after the no-results Clear search button", async () => {
    const w = await mountView();
    await searchSevenDays(w);

    await w.find(".clear-search-btn").trigger("click");
    await flushSearchQueue();

    expect(useSearchStore().dateFrom).toBeNull();
    expect(pressedPresets(w)).toEqual(["All Time"]);
    expect(dateChip(w).exists()).toBe(false);
  });

  it("highlights All Time again after the results header's clear button", async () => {
    const w = await mountView();
    await searchSevenDays(w);

    await w.find('.results-summary button[aria-label="Clear search"]').trigger("click");
    await flushSearchQueue();

    expect(useSearchStore().dateFrom).toBeNull();
    expect(pressedPresets(w)).toEqual(["All Time"]);
  });

  it("highlights All Time again after Escape clears the search", async () => {
    const w = await mountView();
    await searchSevenDays(w, [
      {
        id: 1,
        sessionId: "sess-1",
        sessionSummary: "Synthetic session",
        contentType: "user_message",
        snippet: "auth",
        turnNumber: 1,
        eventIndex: 0,
        toolName: null,
        timestampUnix: 1_790_000_000,
        metadataJson: null,
        sessionRepository: "acme/app",
        sessionBranch: "main",
        sessionUpdatedAt: null,
      } as SearchResult,
    ]);
    // Escape clears the search only while results are listed.
    expect(w.findAll(".result-card")).toHaveLength(1);

    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flushSearchQueue();

    expect(useSearchStore().dateFrom).toBeNull();
    expect(pressedPresets(w)).toEqual(["All Time"]);
  });

  it("shows a removable chip for the date filter a preset sets", async () => {
    const w = await mountView();
    await pickPreset(w, "7 Days");

    expect(dateChip(w).exists()).toBe(true);
    expect(dateChip(w).text()).toContain("Since");

    await dateChip(w).find("button").trigger("click");
    await flushSearchQueue();

    expect(useSearchStore().dateFrom).toBeNull();
    expect(dateChip(w).exists()).toBe(false);
    expect(pressedPresets(w)).toEqual(["All Time"]);
  });

  it.each([
    ["7 Days", "7d", "2026-10-11", "Since Oct 11, 2026"],
    ["This Month", "month-to-date", "2026-10-01", "Since Oct 1, 2026"],
    ["90 Days", "90d", "2026-07-20", "Since Jul 20, 2026"],
  ] as const)("%s covers the same dates as Analytics' preset", async (label, range, from, chip) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-17T12:00:00Z"));
    try {
      const w = await mountView();
      await pickPreset(w, label);

      expect(useSearchStore().dateFrom).toBe(from);
      expect(presetRange(range).fromDate).toBe(from);
      expect(dateChip(w).text()).toContain(chip);
      expect(pressedPresets(w)).toEqual([label]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not claim All Time when the view opens on a date-limited search", async () => {
    // History Back to /search?from=... restores the dates before the view mounts.
    const store = useSearchStore();
    const from = new Date(2026, 9, 6).toISOString();
    store.setDateRange(from, null);

    const w = await mountView();

    expect(store.hasActiveFilters).toBe(true);
    expect(pressedPresets(w)).not.toContain("All Time");
    expect(dateChip(w).text()).toContain("Since Oct 6, 2026");
  });
});
