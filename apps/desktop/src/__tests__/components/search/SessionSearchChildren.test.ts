import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { nextTick } from "vue";
import SearchSyntaxHelpModal from "../../../components/search/SearchSyntaxHelpModal.vue";
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

  it("shows the sort browse results really use, and the picked one once a query returns", async () => {
    const props = {
      query: "",
      filtersOpen: true,
      activeFilterCount: 1,
      sortBy: "relevance",
      isBrowseMode: true,
    };
    const wrapper = mount(SessionSearchHero, { props });
    const select = () => wrapper.get<HTMLSelectElement>(".sort-select").element;
    // Nothing to rank by relevance without a query, so browse results are newest first.
    expect(select().value).toBe("newest");

    await wrapper.setProps({ query: "retry", isBrowseMode: false });
    expect(select().value).toBe("relevance");

    await wrapper.setProps({ query: "", isBrowseMode: true, sortBy: "oldest" });
    expect(select().value).toBe("oldest");
  });

  it("keeps showing Newest when Relevance is picked with no query", async () => {
    const wrapper = mount(SessionSearchHero, {
      props: {
        query: "",
        filtersOpen: true,
        activeFilterCount: 0,
        sortBy: "relevance",
        isBrowseMode: true,
      },
    });
    const select = wrapper.get<HTMLSelectElement>(".sort-select");
    // The pick changes nothing (the store already holds relevance), so no re-render.
    await select.setValue("relevance");
    expect(wrapper.emitted("update:sortBy")?.[0]).toEqual(["relevance"]);
    await nextTick();
    expect(select.element.value).toBe("newest");
  });

  it("shows the source switch only when asked and emits the picked source", async () => {
    const props = {
      query: "",
      filtersOpen: true,
      activeFilterCount: 0,
      sortBy: "relevance",
      isBrowseMode: false,
      sources: ["copilot", "claudeCode"] as const,
    };
    const hidden = mount(SessionSearchHero, { props });
    expect(hidden.find('[data-testid="search-source-filter"]').exists()).toBe(false);

    const wrapper = mount(SessionSearchHero, { props: { ...props, showSource: true } });
    await wrapper.find('[data-source="claudeCode"]').trigger("click");
    expect(wrapper.emitted("update:source")?.[0]).toEqual(["claudeCode"]);
  });

  it("explains a leading NOT instead of silently searching the inverse", async () => {
    const props = {
      query: "NOT jwt",
      filtersOpen: true,
      activeFilterCount: 0,
      sortBy: "relevance",
      isBrowseMode: false,
    };
    const plain = mount(SessionSearchHero, { props });
    expect(plain.find('[data-testid="search-not-hint"]').exists()).toBe(false);

    const wrapper = mount(SessionSearchHero, { props: { ...props, startsWithNot: true } });
    const hint = wrapper.get('[data-testid="search-not-hint"]');
    expect(hint.attributes("role")).toBe("status");
    expect(hint.text()).toContain("needs a term before it, like error NOT timeout");
    // Non-blocking: the input stays editable.
    await wrapper.find("input").setValue("error NOT jwt");
    expect(wrapper.emitted("update:query")?.[0]).toEqual(["error NOT jwt"]);
  });
});

describe("SearchSyntaxHelpModal", () => {
  it("documents NOT between two terms and no unsupported NEAR syntax", () => {
    const wrapper = mount(SearchSyntaxHelpModal, {
      props: { visible: true },
      attachTo: document.body,
    });
    const examples = [...document.querySelectorAll(".syntax-row code")].map((c) => c.textContent);
    expect(examples).toContain("term1 NOT term2");
    expect(examples).not.toContain("NOT term");
    expect(document.body.textContent).not.toContain("NEAR");
    wrapper.unmount();
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
    expect(groupedBtn.attributes("aria-label")).toBe("Grouped by session");
    expect(groupedBtn.attributes("aria-pressed")).toBe("false");
    expect(wrapper.get('[aria-label="Flat list"]').attributes("aria-pressed")).toBe("true");
    expect(wrapper.get('[aria-label="Clear search"] svg').attributes("aria-hidden")).toBe("true");
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

  it("shows no result count when the query has no searchable terms", () => {
    const wrapper = mount(SessionSearchResultsHeader, {
      props: {
        hasResults: true,
        isBrowseMode: false,
        totalCount: 309,
        groupedCount: 7,
        latencyMs: 3,
        resultViewMode: "flat",
        totalPages: 7,
        page: 1,
        noSearchableTerms: true,
      },
    });
    expect(wrapper.text()).toContain("No searchable terms");
    expect(wrapper.text()).not.toContain("309");
    expect(wrapper.text()).not.toContain("page 1 of 7");
    expect(wrapper.find('[aria-label="Copy all results"]').exists()).toBe(false);
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
    expect(wrapper.find('nav[aria-label="Search results pagination"]').exists()).toBe(true);
    expect(wrapper.get('[aria-label="Page 2"]').attributes("aria-current")).toBe("page");
    expect(wrapper.get('[aria-label="Previous page"]').attributes("disabled")).toBeUndefined();
    expect(wrapper.get(".pagination-info").attributes("aria-live")).toBe("polite");
    await buttons[0].trigger("click");
    expect(wrapper.emitted("prev")).toBeTruthy();
    await buttons[buttons.length - 1].trigger("click");
    expect(wrapper.emitted("next")).toBeTruthy();
    await wrapper.find(".pagination-btn.active").trigger("click");
    expect(wrapper.emitted("go")?.[0]).toEqual([2]);
  });
});
