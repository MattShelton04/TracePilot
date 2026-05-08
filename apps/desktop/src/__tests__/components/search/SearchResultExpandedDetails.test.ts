import type { SearchResult } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import SearchResultExpandedDetails from "../../../components/search/SearchResultExpandedDetails.vue";

vi.mock("@tracepilot/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tracepilot/ui")>();
  return {
    ...actual,
    formatDateMedium: (ts: number) => `ts:${ts}`,
  };
});

function makeResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: 7,
    sessionId: "sess-xyz",
    sessionSummary: "Implement auth",
    contentType: "tool_call",
    snippet: "x",
    turnNumber: 12,
    eventIndex: 99,
    toolName: "edit",
    timestampUnix: 1700001234,
    metadataJson: null,
    sessionRepository: null,
    sessionBranch: null,
    sessionUpdatedAt: null,
    ...overrides,
  } as SearchResult;
}

const stubs = { "router-link": { template: "<a><slot /></a>" } };

describe("SearchResultExpandedDetails", () => {
  it("renders all populated fields with default (card) variant", () => {
    const wrapper = mount(SearchResultExpandedDetails, {
      props: { result: makeResult(), sessionLink: "/session/sess-xyz" },
      global: { stubs },
    });
    expect(wrapper.text()).toContain("Implement auth");
    expect(wrapper.text()).toContain("sess-xyz");
    expect(wrapper.text()).toContain("12");
    expect(wrapper.text()).toContain("edit");
    expect(wrapper.text()).toContain("99");
    expect(wrapper.text()).toContain("ts:1700001234");
    expect(wrapper.find(".expanded-grid--card").exists()).toBe(true);
    expect(wrapper.find(".expanded-view-btn--card").exists()).toBe(true);
  });

  it("uses grouped variant classes when variant=grouped", () => {
    const wrapper = mount(SearchResultExpandedDetails, {
      props: {
        result: makeResult(),
        sessionLink: "/x",
        variant: "grouped",
      },
      global: { stubs },
    });
    expect(wrapper.find(".expanded-grid--grouped").exists()).toBe(true);
    expect(wrapper.find(".expanded-view-btn--grouped").exists()).toBe(true);
  });

  it("omits optional fields when null/undefined", () => {
    const wrapper = mount(SearchResultExpandedDetails, {
      props: {
        result: makeResult({
          sessionSummary: null,
          turnNumber: null,
          toolName: null,
          eventIndex: null,
          timestampUnix: null,
        }),
        sessionLink: "/x",
      },
      global: { stubs },
    });
    const labels = wrapper.findAll(".expanded-label").map((n) => n.text());
    expect(labels).toEqual(["Session ID"]);
  });
});
