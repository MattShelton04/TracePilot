import type { ContentTypeStyle } from "@tracepilot/ui";
import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import SearchGroupedResults from "../../../components/search/SearchGroupedResults.vue";
import type { SessionGroup } from "../../../stores/search";

vi.mock("@tracepilot/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tracepilot/ui")>();
  return {
    ...actual,
    formatRelativeTime: (ts: number) => `${ts}s ago`,
    formatDateMedium: (ts: number) => `2025-01-01 ${ts}`,
  };
});

const CONTENT_TYPE_CONFIG: Record<string, ContentTypeStyle> = {
  user_message: { label: "User Message", color: "#3b82f6" },
  tool_call: { label: "Tool Call", color: "#f59e0b" },
};

const MOCK_GROUP: SessionGroup = {
  sessionId: "sess-abc",
  sessionSummary: "OAuth Implementation",
  sessionRepository: "org/web",
  sessionBranch: "main",
  results: [
    {
      id: 1,
      sessionId: "sess-abc",
      sessionSummary: "OAuth Implementation",
      contentType: "user_message",
      snippet: "test <mark>highlight</mark>",
      turnNumber: 3,
      eventIndex: 5,
      toolName: null,
      timestampUnix: 1700000000,
      metadataJson: null,
      sessionRepository: "org/web",
      sessionBranch: "main",
      sessionUpdatedAt: null,
    },
    {
      id: 2,
      sessionId: "sess-abc",
      sessionSummary: "OAuth Implementation",
      contentType: "tool_call",
      snippet: "tool output",
      turnNumber: 4,
      eventIndex: 6,
      toolName: "read_file",
      timestampUnix: 1700000100,
      metadataJson: null,
      sessionRepository: "org/web",
      sessionBranch: "main",
      sessionUpdatedAt: null,
    },
  ],
};

const wrappers: VueWrapper[] = [];
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount();
  document.body.replaceChildren();
});

function mountResults(props: Record<string, unknown> = {}) {
  const wrapper = mount(SearchGroupedResults, {
    attachTo: document.body,
    props: {
      groupedResults: [MOCK_GROUP],
      collapsedGroups: new Set<string>(),
      expandedResults: new Set<number>(),
      resultIndexMap: new Map([
        [1, 0],
        [2, 1],
      ]),
      focusedResultIndex: null,
      hasMore: false,
      contentTypeConfig: CONTENT_TYPE_CONFIG,
      sessionLink: (sid: string, turn: number | null, evt: number | null) =>
        `/session/${sid}/turn/${turn ?? 0}/event/${evt ?? 0}`,
      ...props,
    },
    global: {
      stubs: { "router-link": { template: "<a><slot /></a>" } },
    },
  });
  wrappers.push(wrapper);
  return wrapper;
}

describe("SearchGroupedResults", () => {
  it("renders session group with header", () => {
    const wrapper = mountResults();
    expect(wrapper.find(".session-group-title").text()).toBe("OAuth Implementation");
  });

  it("renders repository and branch badges", () => {
    const wrapper = mountResults();
    const badges = wrapper.findAll(".badge");
    expect(badges.length).toBe(2);
    expect(badges[0].text()).toBe("org/web");
    expect(badges[1].text()).toBe("main");
  });

  it("renders result count", () => {
    const wrapper = mountResults();
    expect(wrapper.find(".session-group-count").text()).toContain("2 matches");
  });

  it("renders results with content type badges", () => {
    const wrapper = mountResults();
    const badges = wrapper.findAll(".ct-badge");
    expect(badges.length).toBe(2);
    expect(badges[0].text()).toBe("User Message");
    expect(badges[1].text()).toBe("Tool Call");
  });

  it("renders tool name badge when present", () => {
    const wrapper = mountResults();
    expect(wrapper.find(".tool-name-badge").text()).toBe("read_file");
  });

  it("hides results when group is collapsed", () => {
    const wrapper = mountResults({
      collapsedGroups: new Set(["sess-abc"]),
    });
    expect(wrapper.get(".session-group-results").isVisible()).toBe(false);
    expect(wrapper.findAll(".session-group-result")).toHaveLength(0);
    expect(wrapper.find(".session-group-chevron").classes()).toContain("collapsed");
  });

  it("exposes a native collapse button associated with the current result region", async () => {
    const wrapper = mountResults();
    const toggle = wrapper.get<HTMLButtonElement>(".session-group-toggle");
    expect(toggle.element.tagName).toBe("BUTTON");
    expect(toggle.element.type).toBe("button");
    expect(toggle.element.tabIndex).toBe(0);
    expect(toggle.attributes("aria-expanded")).toBe("true");
    expect(toggle.attributes("aria-controls")).toBe(
      wrapper.get(".session-group-results").attributes("id"),
    );
    expect(toggle.attributes("aria-label")).toBe("Collapse matches for OAuth Implementation");
    expect(toggle.findAll("button, a, input")).toHaveLength(0);
    await toggle.trigger("click");
    expect(wrapper.emitted("toggle-group-collapse")).toEqual([["sess-abc"]]);
    await wrapper.setProps({ collapsedGroups: new Set(["sess-abc"]) });
    expect(toggle.attributes("aria-expanded")).toBe("false");
    expect(toggle.attributes("aria-label")).toBe("Expand matches for OAuth Implementation");
    expect(wrapper.get(".session-group-results").isVisible()).toBe(false);
    await wrapper.setProps({ collapsedGroups: new Set<string>() });
    expect(wrapper.get(".session-group-results").isVisible()).toBe(true);
    expect(wrapper.findAll(".session-group-result")).toHaveLength(2);
  });

  it("emits toggle-expand on result click", async () => {
    const wrapper = mountResults();
    await wrapper.findAll(".session-group-result")[0].trigger("click");
    expect(wrapper.emitted("toggle-expand")).toEqual([[1]]);
  });

  it("emits filter-by-session on filter button click", async () => {
    const wrapper = mountResults();
    await wrapper.find(".session-group-filter-btn").trigger("click");
    expect(wrapper.emitted("filter-by-session")).toEqual([["sess-abc", "OAuth Implementation"]]);
    expect(wrapper.emitted("toggle-group-collapse")).toBeUndefined();
  });

  it("keeps session navigation separate from collapse", async () => {
    const wrapper = mountResults();
    const link = wrapper.get(".session-group-goto-btn");
    expect(link.attributes("to")).toBe("/session/sess-abc/conversation");
    await link.trigger("click");
    expect(wrapper.emitted("toggle-group-collapse")).toBeUndefined();
    expect(wrapper.emitted("filter-by-session")).toBeUndefined();
  });

  it("uses distinct controlled regions for different groups", () => {
    const group = { ...MOCK_GROUP, sessionId: "second-session" };
    const first = mountResults({ groupedResults: [MOCK_GROUP, group] });
    const controls = first
      .findAll(".session-group-toggle")
      .map((toggle) => toggle.attributes("aria-controls"));
    expect(controls).toHaveLength(2);
    expect(controls.every(Boolean)).toBe(true);
    expect(new Set(controls).size).toBe(2);
  });

  it("shows expanded details for expanded results", () => {
    const wrapper = mountResults({
      expandedResults: new Set([1]),
    });
    const expanded = wrapper.find(".session-group-expanded");
    expect(expanded.exists()).toBe(true);
    expect(expanded.text()).toContain("OAuth Implementation");
    expect(expanded.text()).toContain("sess-abc");
  });

  it('renders "+" suffix on count when hasMore is true', () => {
    const wrapper = mountResults({ hasMore: true });
    expect(wrapper.find(".session-group-count").text()).toContain("2+");
  });

  it("renders truncated session ID when no summary", () => {
    const noSummaryGroup = {
      ...MOCK_GROUP,
      sessionSummary: null,
    };
    const wrapper = mountResults({ groupedResults: [noSummaryGroup] });
    expect(wrapper.find(".session-group-title").text()).toContain("sess-abc");
  });

  it("renders empty state when no groups", () => {
    const wrapper = mountResults({ groupedResults: [] });
    expect(wrapper.findAll(".session-group")).toHaveLength(0);
  });
});
