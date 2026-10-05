import type { SearchResult, SessionListItem } from "@tracepilot/types";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import SearchPalette from "@/components/chrome/SearchPalette.vue";
import type { ResultGroup } from "@/composables/useSearchPaletteSearch";
import { pushRoute } from "@/router/navigation";

// Mock the search composable so we don't hit the real search IPC.
const paletteState = {
  query: ref(""),
  totalCount: ref(0),
  latencyMs: ref(0),
  loading: ref(false),
  searchError: ref<string | null>(null),
  groupedResults: ref<ResultGroup[]>([]),
  flatResults: ref<SearchResult[]>([]),
  hasResults: ref(false),
  hasQuery: ref(false),
  uniqueSessionCount: () => 0,
  reset: vi.fn(),
  dispose: vi.fn(),
};
vi.mock("@/composables/useSearchPaletteSearch", () => ({
  useSearchPaletteSearch: () => paletteState,
}));

const sessionsState = { sessions: [] as SessionListItem[] };
vi.mock("@/stores/sessions", () => ({
  useSessionsStore: () => sessionsState,
}));

vi.mock("@/stores/preferences", () => ({
  usePreferencesStore: () => ({ isFeatureEnabled: () => false }),
}));

vi.mock("vue-router", () => ({
  useRouter: () => ({
    push: vi.fn(),
    getRoutes: () => [
      {
        name: "sessions",
        meta: {
          title: "Sessions",
          sidebar: { section: "primary", label: "Sessions", order: 0 },
        },
      },
      {
        name: "search",
        meta: {
          title: "Session Search",
          sidebar: { section: "primary", label: "Search", order: 1 },
        },
      },
    ],
  }),
}));

vi.mock("@/router/navigation", () => ({
  pushRoute: vi.fn(),
}));

vi.mock("@/utils/keyboardShortcuts", () => ({
  shouldIgnoreGlobalShortcut: () => false,
}));

const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollIntoView",
);
const scrollIntoView = vi.fn();

function searchResult(id: number): SearchResult {
  return {
    id,
    sessionId: `session-${id}`,
    contentType: "user_message",
    turnNumber: 1,
    eventIndex: 2,
    timestampUnix: null,
    toolName: null,
    snippet: `Session match ${id}`,
    metadataJson: null,
    sessionSummary: "Synthetic session",
    sessionRepository: null,
    sessionBranch: null,
    sessionUpdatedAt: null,
  };
}

async function press(input: HTMLInputElement, key: string) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  input.dispatchEvent(event);
  await flushPromises();
  expect(event.defaultPrevented).toBe(true);
}

describe("SearchPalette keyboard interaction", () => {
  beforeEach(() => {
    paletteState.query.value = "";
    paletteState.hasQuery.value = false;
    paletteState.hasResults.value = false;
    paletteState.groupedResults.value = [];
    paletteState.flatResults.value = [];
    sessionsState.sessions = [];
    paletteState.reset.mockClear();
    vi.mocked(pushRoute).mockClear();
    scrollIntoView.mockClear();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    // Clean DOM between runs so Teleport targets don't accumulate.
    document.body.innerHTML = "";
  });

  afterEach(() => {
    if (originalScrollIntoView) {
      Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScrollIntoView);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    }
  });

  it("keeps one selected option and unique IDs across navigation and session results", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const wrapper = mount(SearchPalette, { attachTo: document.body });
    try {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
      await flushPromises();
      paletteState.query.value = "session";
      paletteState.hasQuery.value = true;
      paletteState.hasResults.value = true;
      paletteState.flatResults.value = [searchResult(1), searchResult(2)];
      paletteState.groupedResults.value = [
        {
          contentType: "user_message",
          label: "Messages",
          color: "var(--accent-fg)",
          results: paletteState.flatResults.value,
        },
      ];
      await flushPromises();

      const input = document.querySelector<HTMLInputElement>(".palette-input")!;
      const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
      expect.soft(document.querySelectorAll('[role="listbox"]')).toHaveLength(1);
      expect.soft(new Set(options.map((option) => option.id)).size).toBe(options.length);

      const expectSelection = (index: number) => {
        expect(document.querySelectorAll('[aria-selected="true"]')).toHaveLength(1);
        expect(document.querySelector('[aria-selected="true"]')).toBe(options[index]);
        expect(document.getElementById(input.getAttribute("aria-activedescendant")!)).toBe(
          options[index],
        );
        expect(document.activeElement).toBe(input);
      };
      expect(options).toHaveLength(4);
      expectSelection(0);
      for (const index of [1, 2, 3, 0]) {
        await press(input, "ArrowDown");
        expectSelection(index);
        expect(scrollIntoView.mock.contexts.at(-1)).toBe(options[index]);
      }
      await press(input, "ArrowUp");
      expectSelection(3);
      await press(input, "Enter");
      expect(pushRoute).toHaveBeenCalledWith(expect.anything(), "session-conversation", {
        params: { id: "session-2" },
        query: { turn: "1", event: "2" },
      });
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(document.activeElement).toBe(opener);
    } finally {
      wrapper.unmount();
    }
  });

  it("scrolls navigation and recent-session options when arrows cross and wrap sections", async () => {
    sessionsState.sessions = [
      { id: "recent-session", summary: "Recent synthetic session", isRunning: false },
    ];
    const wrapper = mount(SearchPalette, { attachTo: document.body });
    try {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
      await flushPromises();
      const input = document.querySelector<HTMLInputElement>(".palette-input")!;
      const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
      expect(options).toHaveLength(3);
      for (const [key, index] of [
        ["ArrowUp", 2],
        ["ArrowDown", 0],
        ["ArrowDown", 1],
      ] as const) {
        await press(input, key);
        expect(document.querySelector('[aria-selected="true"]')).toBe(options[index]);
        expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest" });
        expect(scrollIntoView.mock.contexts.at(-1)).toBe(options[index]);
        expect(document.activeElement).toBe(input);
      }
      await press(input, "ArrowDown");
      await press(input, "Enter");
      expect(pushRoute).toHaveBeenCalledWith(expect.anything(), "session-conversation", {
        params: { id: "recent-session" },
      });
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    } finally {
      wrapper.unmount();
    }
  });

  it("Tab key cycles focus from input to clear button when the palette is open", async () => {
    const wrapper = mount(SearchPalette, { attachTo: document.body });
    try {
      // Open with Ctrl+K.
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
      await flushPromises();

      // Give the input content so the clear button is rendered.
      paletteState.query.value = "hello";
      await wrapper.vm.$nextTick();

      const input = document.querySelector<HTMLInputElement>(".palette-input");
      const clearBtn = document.querySelector<HTMLButtonElement>(".palette-clear-btn");
      expect(input).not.toBeNull();
      expect(clearBtn).not.toBeNull();

      input?.focus();
      expect(document.activeElement).toBe(input);

      // Dispatch Tab directly on the input — the palette-level keydown handler
      // runs because the event bubbles up to .palette-modal.
      // Real keyboard events are cancelable: the palette handles Tab before
      // the shared modal trap, which must respect that preventDefault.
      const tabEvent = new KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
        cancelable: true,
      });
      input?.dispatchEvent(tabEvent);
      await wrapper.vm.$nextTick();

      // The focus-trap must move focus to the next focusable element
      // (the clear button). Prior to the FU-25 fix the selector was
      // ".palette-dialog" which never matched, so focus did not move.
      expect(tabEvent.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(clearBtn);

      const reverseTabEvent = new KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      clearBtn?.dispatchEvent(reverseTabEvent);
      await wrapper.vm.$nextTick();
      expect(reverseTabEvent.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(input);
    } finally {
      wrapper.unmount();
    }
  });

  it("preserves Clear button keyboard activation and returns focus to the input", async () => {
    const wrapper = mount(SearchPalette, { attachTo: document.body });
    try {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
      await flushPromises();
      paletteState.query.value = "go";
      await wrapper.vm.$nextTick();

      const input = document.querySelector<HTMLInputElement>(".palette-input")!;
      const clearBtn = document.querySelector<HTMLButtonElement>(".palette-clear-btn")!;
      clearBtn.focus();
      const selected = document.querySelector('[aria-selected="true"]');
      expect(selected).not.toBeNull();

      for (const key of ["ArrowDown", "ArrowUp", "Enter"]) {
        const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
        clearBtn.dispatchEvent(event);
        await wrapper.vm.$nextTick();
        expect(event.defaultPrevented).toBe(false);
        expect(document.querySelector('[aria-selected="true"]')).toBe(selected);
        expect(vi.mocked(pushRoute)).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(clearBtn);
      }

      // DOM emulators do not synthesize the browser's click for Enter. Verify
      // its default is allowed above, then exercise that button activation.
      clearBtn.click();
      await wrapper.vm.$nextTick();
      expect(paletteState.query.value).toBe("");
      expect(document.querySelector(".palette-clear-btn")).toBeNull();
      expect(document.activeElement).toBe(input);
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
      expect(vi.mocked(pushRoute)).not.toHaveBeenCalled();
    } finally {
      wrapper.unmount();
    }
  });

  it("still navigates and opens results from the search input", async () => {
    const wrapper = mount(SearchPalette, { attachTo: document.body });
    try {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
      await flushPromises();
      const input = document.querySelector<HTMLInputElement>(".palette-input")!;
      const initialSelection = document.querySelector('[aria-selected="true"]');
      const down = new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      });
      input.dispatchEvent(down);
      await wrapper.vm.$nextTick();
      expect(down.defaultPrevented).toBe(true);
      expect(document.querySelector('[aria-selected="true"]')).not.toBe(initialSelection);

      const enter = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      });
      input.dispatchEvent(enter);
      await flushPromises();
      expect(enter.defaultPrevented).toBe(true);
      expect(vi.mocked(pushRoute)).toHaveBeenCalledOnce();
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    } finally {
      wrapper.unmount();
    }
  });
});
