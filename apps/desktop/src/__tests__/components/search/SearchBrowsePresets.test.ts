// biome-ignore-all assist/source/organizeImports: setup must register mocks before the store import.
import { setupPinia } from "@tracepilot/test-utils";
import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAllMocks, setupDefaultMocks } from "@/__tests__/stores/search/setup";
import SearchBrowsePresets from "@/components/search/SearchBrowsePresets.vue";
import { useSearchStore } from "@/stores/search";

let wrapper: VueWrapper | undefined;

function mountWithRecents() {
  const store = useSearchStore();
  store.recentSearches.splice(
    0,
    store.recentSearches.length,
    { query: "auth plugin", timestamp: 1, resultCount: 4 },
    { query: "refactor", timestamp: 0, resultCount: 1 },
  );
  wrapper = mount(SearchBrowsePresets, { attachTo: document.body });
  return { store, wrapper };
}

describe("SearchBrowsePresets recent searches", () => {
  beforeEach(() => {
    localStorage.clear();
    setupPinia();
    resetAllMocks();
    setupDefaultMocks();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    localStorage.clear();
  });

  it("gives each entry a separate, labelled remove button", () => {
    const { wrapper } = mountWithRecents();
    const remove = wrapper.findAll(".recent-remove");

    expect(remove).toHaveLength(2);
    for (const button of remove) {
      expect(button.element.tagName).toBe("BUTTON");
      expect(button.element.parentElement?.closest("button")).toBeNull();
    }
    expect(remove[0].attributes("aria-label")).toBe("Remove auth plugin from recent searches");
    expect(remove[0].text()).toBe("");
  });

  it("removes only that entry without running it", async () => {
    const { store, wrapper } = mountWithRecents();
    const apply = vi.spyOn(store, "applyRecentSearch");

    await wrapper.findAll(".recent-remove")[0].trigger("click");

    expect(apply).not.toHaveBeenCalled();
    expect(store.recentSearches.map((s) => s.query)).toEqual(["refactor"]);
    expect(wrapper.findAll(".recent-search-item")).toHaveLength(1);
  });

  it("still runs an entry from its own button", async () => {
    const { store, wrapper } = mountWithRecents();
    const apply = vi.spyOn(store, "applyRecentSearch").mockImplementation(() => {});

    await wrapper.findAll(".recent-search-item")[1].trigger("click");

    expect(apply).toHaveBeenCalledWith("refactor");
  });
});
