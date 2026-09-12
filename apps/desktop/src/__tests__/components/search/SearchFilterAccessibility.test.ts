import type { SearchContentType } from "@tracepilot/types";
import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computed, defineComponent, h, reactive, ref } from "vue";
import SearchFilterSidebar from "@/components/search/SearchFilterSidebar.vue";
import SessionSearchHero from "@/components/search/SessionSearchHero.vue";
import { useSearchKeyboardNavigation } from "@/composables/useSearchKeyboardNavigation";

vi.mock("@/stores/search", () => ({ useSearchStore: () => store }));
vi.mock("@/stores/sessions", () => ({ useSessionsStore: () => ({ repositories: [] }) }));

const store = reactive({
  contentTypes: [] as SearchContentType[],
  excludeContentTypes: [] as SearchContentType[],
  stats: null,
  facets: null,
  availableRepositories: ["audit/demo"],
  availableToolNames: ["read_file"],
  repository: null as string | null,
  toolName: null as string | null,
  setDateRange: vi.fn(),
});

let wrapper: VueWrapper | undefined;
let setOpen: (value: boolean) => void;
let keyboard: ReturnType<typeof useSearchKeyboardNavigation>;
const toggleResult = vi.fn();

beforeEach(() => {
  store.contentTypes = [];
  store.excludeContentTypes = [];
  store.repository = null;
  store.toolName = null;
  toggleResult.mockClear();
});

afterEach(() => {
  wrapper?.unmount();
  document.body.innerHTML = "";
});

function renderFilters() {
  wrapper = mount(
    defineComponent({
      setup() {
        const open = ref(true);
        const hero = ref<InstanceType<typeof SessionSearchHero> | null>(null);
        keyboard = useSearchKeyboardNavigation({
          searchInputRef: computed(() => hero.value?.inputRef ?? null),
          results: ref([{ id: 1 }]),
          hasQuery: ref(true),
          onClearAll: vi.fn(),
          onToggleExpand: toggleResult,
        });
        setOpen = (value) => {
          open.value = value;
        };
        return () =>
          h("div", [
            h(SessionSearchHero, {
              ref: hero,
              query: "",
              filtersOpen: open.value,
              filtersId: "audit-search-filters",
              activeFilterCount: 0,
              sortBy: "newest",
              isBrowseMode: false,
              "onUpdate:filtersOpen": setOpen,
            }),
            h(SearchFilterSidebar, {
              id: "audit-search-filters",
              collapsed: !open.value,
              onRestoreFocus: () => hero.value?.focusFilterToggle(),
            }),
            h("button", { id: "outside" }, "Next content"),
          ]);
      },
    }),
    { attachTo: document.body },
  );
  return wrapper;
}

describe("Search filter accessibility", () => {
  it("links the expanded toggle to filters and makes collapsed controls inert", async () => {
    const view = renderFilters();
    const toggle = view.get('[aria-label="Toggle filters"]');
    const sidebar = view.get("aside");
    expect(toggle.attributes("aria-controls")).toBe(sidebar.attributes("id"));
    expect(toggle.attributes("aria-expanded")).toBe("true");
    await toggle.trigger("click");
    expect(toggle.attributes("aria-expanded")).toBe("false");
    expect(sidebar.attributes("aria-hidden")).toBe("true");
    expect(sidebar.attributes("inert")).toBeDefined();
    await toggle.trigger("click");
    expect(sidebar.attributes("aria-hidden")).toBe("false");
    expect(sidebar.attributes("inert")).toBeUndefined();
  });

  it("restores focus before hiding a focused filter and leaves outside focus alone", async () => {
    const view = renderFilters();
    const selectAll = view.get(".filter-select-all-btn");
    (selectAll.element as HTMLButtonElement).focus();
    setOpen(false);
    await view.vm.$nextTick();
    expect(document.activeElement).toBe(view.get('[aria-label="Toggle filters"]').element);

    setOpen(true);
    await view.vm.$nextTick();
    const outside = view.get("#outside");
    (outside.element as HTMLButtonElement).focus();
    setOpen(false);
    await view.vm.$nextTick();
    expect(document.activeElement).toBe(outside.element);
  });

  it("uses native buttons that announce and cycle all three content-filter states", async () => {
    const view = renderFilters();
    const filter = view.get('button[aria-label="User Message: off"]');
    expect(filter.element).toBeInstanceOf(HTMLButtonElement);
    const hint = document.getElementById(filter.attributes("aria-describedby") ?? "");
    expect(hint?.textContent).toContain("Enter or Space");
    await filter.trigger("click");
    expect(store.contentTypes).toEqual(["user_message"]);
    expect(filter.attributes("aria-label")).toBe("User Message: include");
    await filter.trigger("click");
    expect(store.contentTypes).toEqual([]);
    expect(store.excludeContentTypes).toEqual(["user_message"]);
    expect(filter.attributes("aria-label")).toBe("User Message: exclude");
    await filter.trigger("click");
    expect(store.excludeContentTypes).toEqual([]);
    expect(filter.attributes("aria-label")).toBe("User Message: off");
  });

  it("leaves Enter on filter buttons available after keyboard result navigation", () => {
    const view = renderFilters();
    keyboard.focusedResultIndex.value = 0;
    const filter = view.get('button[aria-label="User Message: off"]');
    (filter.element as HTMLButtonElement).focus();
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    filter.element.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(toggleResult).not.toHaveBeenCalled();
  });

  it("associates repository and tool labels with working selects", async () => {
    const view = renderFilters();
    for (const [name, value, key] of [
      ["Repository", "audit/demo", "repository"],
      ["Tool", "read_file", "toolName"],
    ] as const) {
      const label = view.findAll("label").find((item) => item.text() === name)!;
      expect(label).toBeDefined();
      const select = view.get(`select[id="${label.attributes("for")}"]`);
      await select.setValue(value);
      expect(store[key]).toBe(value);
    }
  });
});
