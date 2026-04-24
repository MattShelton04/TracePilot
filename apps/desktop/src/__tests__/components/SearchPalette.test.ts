import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import SearchPalette from "@/components/SearchPalette.vue";

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

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
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
    // Clean DOM between runs so Teleport targets don't accumulate.
    document.body.innerHTML = "";
  });

  it("Tab key cycles focus from input to clear button when the palette is open", async () => {
    const wrapper = mount(SearchPalette, { attachTo: document.body });

    // Open with Ctrl+K.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
    await wrapper.vm.$nextTick();

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
    const tabEvent = new KeyboardEvent("keydown", { key: "Tab", bubbles: true });
    input?.dispatchEvent(tabEvent);
    await wrapper.vm.$nextTick();

    // The focus-trap must move focus to the next focusable element
    // (the clear button). Prior to the FU-25 fix the selector was
    // ".palette-dialog" which never matched, so focus did not move.
    expect(document.activeElement).toBe(clearBtn);

    wrapper.unmount();
  });
});
