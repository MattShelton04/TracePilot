import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import SessionSearchHero from "../../../components/search/SessionSearchHero.vue";
import SessionSearchIndexingBanner from "../../../components/search/SessionSearchIndexingBanner.vue";
import SessionSearchPagination from "../../../components/search/SessionSearchPagination.vue";
import SessionSearchResultsHeader from "../../../components/search/SessionSearchResultsHeader.vue";

describe("SessionSearchHero", () => {
  it("mounts with default props and emits update:query on input", async () => {
    const wrapper = mount(SessionSearchHero, {
      props: {
        query: "",
        filtersOpen: true,
        activeFilterCount: 0,
        sortBy: "relevance",
        isBrowseMode: false,
      },
    });
    expect(wrapper.find('[data-testid="search-input"]').exists()).toBe(true);
    await wrapper.find("input").setValue("hello");
    expect(wrapper.emitted("update:query")?.[0]).toEqual(["hello"]);
  });

  it("shows active filter count badge when > 0", () => {
    const wrapper = mount(SessionSearchHero, {
      props: {
        query: "",
        filtersOpen: true,
        activeFilterCount: 3,
        sortBy: "newest",
        isBrowseMode: false,
      },
    });
    expect(wrapper.find(".filter-count-badge").text()).toBe("3");
  });
});

describe("SessionSearchIndexingBanner", () => {
  it("renders nothing when idle", () => {
    const wrapper = mount(SessionSearchIndexingBanner, {
      props: {
        isIndexing: false,
        searchIndexing: false,
        rebuilding: false,
        indexingProgress: null,
        searchIndexingProgress: null,
      },
    });
    expect(wrapper.find(".indexing-banner").exists()).toBe(false);
  });

  it("renders banner with progress when indexing", () => {
    const wrapper = mount(SessionSearchIndexingBanner, {
      props: {
        isIndexing: true,
        searchIndexing: false,
        rebuilding: false,
        indexingProgress: {
          current: 5,
          total: 10,
          sessionRepo: null,
          sessionBranch: null,
          sessionModel: null,
          sessionTokens: null,
        } as never,
        searchIndexingProgress: null,
      },
    });
    expect(wrapper.find(".indexing-banner").exists()).toBe(true);
    expect(wrapper.text()).toContain("5 / 10");
  });
});

describe("SessionSearchResultsHeader", () => {
  it("shows totals and emits view-mode changes", async () => {
    const wrapper = mount(SessionSearchResultsHeader, {
      props: {
        hasResults: true,
        isBrowseMode: false,
        totalCount: 42,
        groupedCount: 3,
        latencyMs: 12.5,
        resultViewMode: "flat",
        totalPages: 1,
        page: 1,
      },
    });
    expect(wrapper.text()).toContain("42");
    const groupedBtn = wrapper.find('[title="Grouped by session"]');
    await groupedBtn.trigger("click");
    expect(wrapper.emitted("update:resultViewMode")?.[0]).toEqual(["grouped"]);
  });

  it("shows 'No results found' when hasResults is false", () => {
    const wrapper = mount(SessionSearchResultsHeader, {
      props: {
        hasResults: false,
        isBrowseMode: false,
        totalCount: 0,
        groupedCount: 0,
        latencyMs: 0,
        resultViewMode: "flat",
        totalPages: 0,
        page: 1,
      },
    });
    expect(wrapper.text()).toContain("No results found");
  });
});

describe("SessionSearchPagination", () => {
  it("renders nothing when totalPages <= 1", () => {
    const wrapper = mount(SessionSearchPagination, {
      props: {
        page: 1,
        totalPages: 1,
        totalCount: 10,
        hasMore: false,
        visiblePages: [],
        pageStart: 1,
        pageEnd: 10,
      },
    });
    expect(wrapper.find(".pagination").exists()).toBe(false);
  });

  it("emits go/prev/next events", async () => {
    const wrapper = mount(SessionSearchPagination, {
      props: {
        page: 2,
        totalPages: 5,
        totalCount: 250,
        hasMore: true,
        visiblePages: [1, 2, 3, null, 5],
        pageStart: 51,
        pageEnd: 100,
      },
    });
    const buttons = wrapper.findAll(".pagination-btn");
    await buttons[0].trigger("click");
    expect(wrapper.emitted("prev")).toBeTruthy();
    await buttons[buttons.length - 1].trigger("click");
    expect(wrapper.emitted("next")).toBeTruthy();
    await wrapper.find(".pagination-btn.active").trigger("click");
    expect(wrapper.emitted("go")?.[0]).toEqual([2]);
  });
});
