import { setupPinia } from "@tracepilot/test-utils";
import type { SearchResult } from "@tracepilot/types";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SearchResultCard from "../../../components/search/SearchResultCard.vue";
import { useSessionsStore } from "../../../stores/sessions";

const { getResultContext } = vi.hoisted(() => ({
  getResultContext: vi.fn(async () => [[], []] as unknown[]),
}));

vi.mock("@tracepilot/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tracepilot/client")>()),
  getResultContext,
}));

const RESULT: SearchResult = {
  id: 1,
  sessionId: "sess-1",
  contentType: "user_message",
  turnNumber: 1,
  eventIndex: 2,
  timestampUnix: null,
  toolName: null,
  snippet: "a <mark>match</mark>",
  metadataJson: null,
  sessionSummary: "Summary",
  sessionRepository: "org/web",
  sessionBranch: "main",
  sessionUpdatedAt: null,
  source: "copilot",
};

function mountCard(result: SearchResult = RESULT) {
  return mount(SearchResultCard, {
    props: { result, index: 0, expanded: false, focused: false, sessionLink: "/x" },
    global: { stubs: { "router-link": { template: "<a><slot /></a>" } } },
  });
}

function headerBadges(result: SearchResult = RESULT) {
  const wrapper = mountCard(result);
  const badges = wrapper.findAll(".result-header .badge").map((b) => b.text());
  wrapper.unmount();
  return badges;
}

describe("SearchResultCard source chip", () => {
  beforeEach(() => setupPinia());

  it("names a Claude Code row's source from the row itself", () => {
    // The session list does not know the session: the row's source decides.
    useSessionsStore().sessions = [];
    expect(headerBadges({ ...RESULT, source: "claudeCode" })).toEqual([
      "Claude Code",
      "org/web",
      "main",
    ]);
  });

  it("adds no chip for a Copilot row", () => {
    useSessionsStore().sessions = [
      { id: "sess-1", eventCount: 1, turnCount: 1, isRunning: false, source: "claudeCode" },
    ];
    expect(headerBadges()).toEqual(["org/web", "main"]);
  });
});

describe("SearchResultCard context strip", () => {
  beforeEach(() => setupPinia());

  it("names neighbouring tool rows by their native name, canonical on hover", async () => {
    getResultContext.mockResolvedValueOnce([
      [
        {
          contentType: "tool_call",
          turnNumber: 1,
          toolName: "shell",
          nativeToolName: "Bash",
          preview: "ls",
        },
        { contentType: "tool_call", turnNumber: 1, toolName: "view", preview: "a.ts" },
      ],
      [],
    ]);
    const wrapper = mountCard({ ...RESULT, source: "claudeCode" });
    await wrapper.setProps({ expanded: true });
    await flushPromises();
    const tools = wrapper.findAll(".context-tool");
    expect(tools.map((t) => t.text())).toEqual(["Bash", "view"]);
    expect(tools[0].attributes("title")).toBe("shell");
    wrapper.unmount();
  });

  it("loads context for a card that mounts already expanded", async () => {
    // Expansion is kept across pages and view modes, so a card can come back
    // expanded without ever seeing the expanded prop change.
    getResultContext.mockClear();
    getResultContext.mockResolvedValueOnce([
      [{ contentType: "user_message", turnNumber: 1, preview: "asked" }],
      [{ contentType: "assistant_message", turnNumber: 1, preview: "answered" }],
    ]);
    const wrapper = mount(SearchResultCard, {
      props: { result: RESULT, index: 0, expanded: true, focused: false, sessionLink: "/x" },
      global: { stubs: { "router-link": { template: "<a><slot /></a>" } } },
    });
    await flushPromises();
    expect(getResultContext).toHaveBeenCalledWith(1, 2);
    expect(wrapper.findAll(".context-preview").map((p) => p.text())).toEqual(["asked", "answered"]);
    wrapper.unmount();
  });

  it("replaces the context when the card is reused for another result", async () => {
    getResultContext.mockClear();
    getResultContext.mockResolvedValueOnce([
      [{ contentType: "user_message", turnNumber: 1, preview: "first" }],
      [],
    ]);
    const wrapper = mount(SearchResultCard, {
      props: { result: RESULT, index: 0, expanded: true, focused: false, sessionLink: "/x" },
      global: { stubs: { "router-link": { template: "<a><slot /></a>" } } },
    });
    await flushPromises();
    expect(wrapper.find(".context-preview").text()).toBe("first");

    getResultContext.mockResolvedValueOnce([
      [{ contentType: "user_message", turnNumber: 4, preview: "second" }],
      [],
    ]);
    await wrapper.setProps({ result: { ...RESULT, id: 2 } });
    await flushPromises();
    expect(getResultContext).toHaveBeenLastCalledWith(2, 2);
    expect(wrapper.findAll(".context-preview").map((p) => p.text())).toEqual(["second"]);
    wrapper.unmount();
  });
});

describe("SearchResultCard date in another timezone", () => {
  const originalTz = process.env.TZ;
  beforeEach(() => setupPinia());
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it("titles the relative time with the hit's local date and time", () => {
    // 20:00 on 23 Oct in Los Angeles (UTC-7) is already 24 Oct in UTC.
    process.env.TZ = "America/Los_Angeles";
    const moment = Date.UTC(2026, 9, 24, 3, 0, 0) / 1000;
    const wrapper = mountCard({ ...RESULT, timestampUnix: moment });
    const title = wrapper.get(".result-date").attributes("title");
    expect(title).toBe(new Date(moment * 1000).toLocaleString());
    expect(title).not.toContain("24");
    wrapper.unmount();
  });
});
