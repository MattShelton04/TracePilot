import type { SearchResult } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import SearchResultMeta from "../../../components/search/SearchResultMeta.vue";

vi.mock("@tracepilot/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tracepilot/ui")>();
  return {
    ...actual,
    formatRelativeTime: (ts: number) => `${ts}s ago`,
    formatDateMedium: (ts: number) => `2025-01-01 ${ts}`,
  };
});

function makeResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: 1,
    sessionId: "sess-1",
    sessionSummary: "OAuth Implementation",
    contentType: "user_message",
    snippet: "hello",
    turnNumber: 3,
    eventIndex: 5,
    toolName: null,
    timestampUnix: 1700000000,
    metadataJson: null,
    sessionRepository: "org/web",
    sessionBranch: "main",
    sessionUpdatedAt: null,
    ...overrides,
  } as SearchResult;
}

describe("SearchResultMeta", () => {
  it("renders truncated session summary, turn, and content type", () => {
    const wrapper = mount(SearchResultMeta, { props: { result: makeResult() } });
    expect(wrapper.find(".result-session-summary").text()).toBe("OAuth Implementation");
    expect(wrapper.text()).toContain("Turn 3");
    expect(wrapper.text()).toContain("user message");
  });

  it("renders tool-name badge when toolName is present", () => {
    const wrapper = mount(SearchResultMeta, {
      props: { result: makeResult({ toolName: "read_file" }) },
    });
    expect(wrapper.find(".tool-name-badge").text()).toBe("read_file");
  });

  it("renders timeline spark only when sessionEventCount provided", () => {
    const without = mount(SearchResultMeta, { props: { result: makeResult() } });
    expect(without.find(".timeline-spark").exists()).toBe(false);

    const withCount = mount(SearchResultMeta, {
      props: { result: makeResult(), sessionEventCount: 10 },
    });
    expect(withCount.find(".timeline-spark").exists()).toBe(true);
  });

  it("truncates long session summaries to 50 chars + ellipsis", () => {
    const long = "a".repeat(80);
    const wrapper = mount(SearchResultMeta, {
      props: { result: makeResult({ sessionSummary: long }) },
    });
    expect(wrapper.find(".result-session-summary").text()).toBe(`${"a".repeat(50)}…`);
  });
});
