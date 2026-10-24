import type { SearchResult } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import SearchResultExpandedDetails from "../../../components/search/SearchResultExpandedDetails.vue";

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
    expect(wrapper.text()).toContain(new Date(1700001234 * 1000).toLocaleString());
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

describe("SearchResultExpandedDetails timestamp in another timezone", () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it("shows the local date and time of the hit, not the UTC date", () => {
    // 20:00 on 23 Oct in Los Angeles (UTC-7) is already 24 Oct in UTC.
    process.env.TZ = "America/Los_Angeles";
    const moment = Date.UTC(2026, 9, 24, 3, 0, 0) / 1000;
    const wrapper = mount(SearchResultExpandedDetails, {
      props: { result: makeResult({ timestampUnix: moment }), sessionLink: "/x" },
      global: { stubs },
    });
    const items = wrapper.findAll(".expanded-item");
    const value = items
      .find((item) => item.get(".expanded-label").text() === "Timestamp")
      ?.get(".expanded-value")
      .text();
    expect(value).toBe(new Date(moment * 1000).toLocaleString());
    expect(value).toContain("23");
    expect(value).not.toContain("24");
    expect(value).toMatch(/\b(8|20):00\b/);
  });
});
