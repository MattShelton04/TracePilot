import { setupPinia } from "@tracepilot/test-utils";
import type { SearchResult } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SearchResultCard from "../../../components/search/SearchResultCard.vue";
import { useSessionsStore } from "../../../stores/sessions";

vi.mock("@tracepilot/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tracepilot/client")>()),
  getResultContext: vi.fn(async () => [[], []]),
}));

// The backend's search rows carry no `source`, as here.
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
};

function headerBadges() {
  const wrapper = mount(SearchResultCard, {
    props: { result: RESULT, index: 0, expanded: false, focused: false, sessionLink: "/x" },
    global: { stubs: { "router-link": { template: "<a><slot /></a>" } } },
  });
  const badges = wrapper.findAll(".result-header .badge").map((b) => b.text());
  wrapper.unmount();
  return badges;
}

describe("SearchResultCard source chip", () => {
  beforeEach(() => setupPinia());

  it("names a Claude Code session's source from the session list", () => {
    useSessionsStore().sessions = [
      { id: "sess-1", eventCount: 1, turnCount: 1, isRunning: false, source: "claudeCode" },
    ];
    expect(headerBadges()).toEqual(["Claude Code", "org/web", "main"]);
  });

  it("adds no chip for a Copilot session", () => {
    useSessionsStore().sessions = [{ id: "sess-1", eventCount: 1, turnCount: 1, isRunning: false }];
    expect(headerBadges()).toEqual(["org/web", "main"]);
  });
});
