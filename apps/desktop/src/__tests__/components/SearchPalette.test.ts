import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import SearchPalette from "@/components/chrome/SearchPalette.vue";
import { pushRoute } from "@/router/navigation";

// Mock the search composable so we don't hit the real search IPC.
const paletteState = {
  query: ref(""),
  totalCount: ref(0),
  latencyMs: ref(0),
  loading: ref(false),
  searchError: ref<string | null>(null),
  groupedResults: ref([]),
  flatResults: ref([]),
  hasResults: ref(false),
  hasQuery: ref(false),
  uniqueSessionCount: () => 0,
  reset: vi.fn(),
  dispose: vi.fn(),
};
vi.mock("@/composables/useSearchPaletteSearch", () => ({
  useSearchPaletteSearch: () => paletteState,
}));

vi.mock("@/stores/sessions", () => ({
  useSessionsStore: () => ({ sessions: [] }),
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

describe("SearchPalette focus trap (FU-25)", () => {
  beforeEach(() => {
    paletteState.query.value = "";
    paletteState.reset.mockClear();
    vi.mocked(pushRoute).mockClear();
    // Clean DOM between runs so Teleport targets don't accumulate.
    document.body.innerHTML = "";
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
