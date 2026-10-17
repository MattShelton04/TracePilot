import type { ContentTypeStyle } from "@tracepilot/ui";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import SearchActiveFilters from "../../../components/search/SearchActiveFilters.vue";

const CONTENT_TYPE_CONFIG: Record<string, ContentTypeStyle> = {
  user_message: { label: "User Message", color: "#3b82f6" },
  tool_call: { label: "Tool Call", color: "#f59e0b" },
};

function mountFilters(props: Record<string, unknown> = {}) {
  return mount(SearchActiveFilters, {
    props: {
      activeContentTypeChips: [],
      repository: null,
      toolName: null,
      sessionId: null,
      sessionDisplayName: null,
      activeFilterCount: 0,
      contentTypeConfig: CONTENT_TYPE_CONFIG,
      ...props,
    },
  });
}

describe("SearchActiveFilters", () => {
  it("renders nothing when no filters are active", () => {
    const wrapper = mountFilters();
    expect(wrapper.find(".active-filters-bar").exists()).toBe(false);
  });

  it("renders content type include chips", () => {
    const wrapper = mountFilters({
      activeContentTypeChips: [{ type: "user_message", mode: "include" }],
    });
    expect(wrapper.find(".active-filters-bar").exists()).toBe(true);
    expect(wrapper.find(".filter-chip-include").text()).toContain("User Message");
  });

  it("renders content type exclude chips with NOT prefix", () => {
    const wrapper = mountFilters({
      activeContentTypeChips: [{ type: "tool_call", mode: "exclude" }],
    });
    const chip = wrapper.find(".filter-chip-exclude");
    expect(chip.exists()).toBe(true);
    expect(chip.text()).toContain("NOT");
    expect(chip.text()).toContain("Tool Call");
  });

  it("renders repository filter chip", () => {
    const wrapper = mountFilters({ repository: "org/repo" });
    expect(wrapper.find(".filter-chip-neutral").text()).toContain("Repo: org/repo");
  });

  it("names a folder-only project filter by its folder", () => {
    const wrapper = mountFilters({ repository: "project:harbor" });
    const chip = wrapper.find(".filter-chip-neutral").text();
    expect(chip).toContain("Folder: harbor");
    expect(chip).not.toContain("project:");
  });

  it("renders tool name filter chip", () => {
    const wrapper = mountFilters({ toolName: "read_file" });
    expect(wrapper.find(".filter-chip-neutral").text()).toContain("Tool: read_file");
  });

  it("renders session filter chip", () => {
    const wrapper = mountFilters({
      sessionId: "abc-123",
      sessionDisplayName: "My Session",
    });
    expect(wrapper.find(".filter-chip-include").text()).toContain("Session: My Session");
  });

  it("emits remove-content-type when chip remove button clicked", async () => {
    const wrapper = mountFilters({
      activeContentTypeChips: [{ type: "user_message", mode: "include" }],
    });
    await wrapper.find(".filter-chip-remove").trigger("click");
    expect(wrapper.emitted("remove-content-type")).toEqual([["user_message"]]);
  });

  it("emits clear-repository when repo chip remove clicked", async () => {
    const wrapper = mountFilters({ repository: "org/repo" });
    await wrapper.find(".filter-chip-remove").trigger("click");
    expect(wrapper.emitted("clear-repository")).toBeTruthy();
  });

  it("renders a source chip that clears the source", async () => {
    const wrapper = mountFilters({ source: "claudeCode", activeFilterCount: 1 });
    const chip = wrapper.find('[data-testid="search-source-chip"]');
    expect(chip.text()).toContain("Source: Claude Code");
    await chip.find(".filter-chip-remove").trigger("click");
    expect(wrapper.emitted("clear-source")).toHaveLength(1);
  });

  it("renders a date chip on its own that clears the date range", async () => {
    const from = new Date(2026, 9, 6, 14, 30).toISOString();
    const wrapper = mountFilters({ dateFrom: from, activeFilterCount: 1 });
    const chip = wrapper.find('[data-testid="search-date-chip"]');
    expect(wrapper.find(".active-filters-bar").exists()).toBe(true);
    expect(chip.text()).toContain("Date: Since Oct 6, 2026");
    await chip.find(".filter-chip-remove").trigger("click");
    expect(wrapper.emitted("clear-date-range")).toHaveLength(1);
  });

  it("labels until-only and bounded date ranges", () => {
    const until = mountFilters({ dateTo: "2026-10-10" });
    expect(until.find('[data-testid="search-date-chip"]').text()).toContain(
      "Date: Until Oct 10, 2026",
    );
    const bounded = mountFilters({ dateFrom: "2026-10-01", dateTo: "2026-10-10" });
    expect(bounded.find('[data-testid="search-date-chip"]').text()).toContain(
      "Date: Oct 1, 2026 – Oct 10, 2026",
    );
  });

  it("hides the date chip for blank dates", () => {
    const wrapper = mountFilters({ dateFrom: "  ", dateTo: null });
    expect(wrapper.find(".active-filters-bar").exists()).toBe(false);
  });

  it("shows clear-all button when multiple filters active", () => {
    const wrapper = mountFilters({
      activeContentTypeChips: [{ type: "user_message", mode: "include" }],
      repository: "org/repo",
      activeFilterCount: 2,
    });
    expect(wrapper.find(".filter-chip-clear-all").exists()).toBe(true);
  });

  it("emits clear-all when clear-all button clicked", async () => {
    const wrapper = mountFilters({
      activeContentTypeChips: [{ type: "user_message", mode: "include" }],
      repository: "org/repo",
      activeFilterCount: 2,
    });
    await wrapper.find(".filter-chip-clear-all").trigger("click");
    expect(wrapper.emitted("clear-all")).toBeTruthy();
  });

  it("hides clear-all button when only one filter active", () => {
    const wrapper = mountFilters({
      repository: "org/repo",
      activeFilterCount: 1,
    });
    expect(wrapper.find(".filter-chip-clear-all").exists()).toBe(false);
  });
});
