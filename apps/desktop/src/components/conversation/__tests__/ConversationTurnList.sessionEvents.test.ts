import { setupPinia } from "@tracepilot/test-utils";
import type { ConversationTurn, TurnSessionEvent } from "@tracepilot/types";
import { shallowMount } from "@vue/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import ConversationTurnList from "../ConversationTurnList.vue";

const noop = { has: () => false, toggle: () => {} };

const sessionStart: TurnSessionEvent = {
  eventType: "session.start",
  timestamp: "2026-03-14T03:20:07.000Z",
  severity: "info",
  summary: "Session started",
};
const rejected: TurnSessionEvent = {
  eventType: "session.warning",
  timestamp: "2026-03-14T03:20:42.000Z",
  severity: "warning",
  summary: "Tool use rejected by the user",
};

const turn = {
  turnIndex: 0,
  userMessage: "Tag the release",
  timestamp: "2026-03-14T03:20:07.000Z",
  assistantMessages: [{ content: "Tagging it." }],
  toolCalls: [],
  isComplete: true,
  sessionEvents: [sessionStart, rejected],
} as unknown as ConversationTurn;

function mountList(viewMode: "compact" | "timeline", overrides: Partial<ConversationTurn> = {}) {
  return shallowMount(ConversationTurnList, {
    props: {
      turns: [{ ...turn, ...overrides }],
      viewMode,
      getSections: () => [
        { agentType: "main", messages: ["Tagging it."], reasoning: [], toolCalls: [] },
      ],
      getArgsSummary: () => "",
      findToolCallIndex: () => 0,
      expandedToolDetails: noop,
      expandedReasoning: noop,
      fullResults: new Map(),
      loadingResults: new Set(),
      failedResults: new Set(),
      richEnabledFor: () => false,
    },
    global: { renderStubDefaultSlot: true },
  } as never);
}

/** The prompt, the reply and each session event, in document order. */
function order(root: Element): string[] {
  const nodes = root.querySelectorAll(
    ".compact-turn-user-text, .compact-turn-label, .timeline-block-text, .session-event-summary",
  );
  return [...nodes].map((node) => {
    const text = node.textContent ?? "";
    if (text.includes("Session started")) return "session.start";
    if (text.includes("rejected")) return "warning";
    if (text.includes("Tag the release")) return "prompt";
    return "reply";
  });
}

describe("ConversationTurnList session event placement", () => {
  beforeEach(() => setupPinia());

  it.each([
    "compact",
    "timeline",
  ] as const)("%s view shows events from before the turn above the prompt and later ones after the reply", (viewMode) => {
    expect(order(mountList(viewMode).element)).toEqual([
      "session.start",
      "prompt",
      "reply",
      "warning",
    ]);
  });

  it("keeps every event after the reply when the turn has no timestamp", () => {
    expect(order(mountList("compact", { timestamp: undefined }).element)).toEqual([
      "prompt",
      "reply",
      "session.start",
      "warning",
    ]);
  });
});

describe("ConversationTurnList rate limits", () => {
  beforeEach(() => setupPinia());

  const rateLimit: TurnSessionEvent = {
    eventType: "session.error",
    timestamp: "2026-03-14T03:20:30.000Z",
    severity: "warning",
    summary: "You've hit your usage limit · resets 6pm",
  };
  const failure: TurnSessionEvent = {
    ...rateLimit,
    severity: "error",
    summary: "Connection reset",
  };

  it.each([
    "compact",
    "timeline",
  ] as const)("%s view labels a rate limit as an amber Rate limit and other errors as red", (viewMode) => {
    const wrapper = mountList(viewMode, { sessionEvents: [rateLimit, failure] });
    const badges = wrapper.findAll(".session-event-row badge-stub");
    expect(badges.map((b) => [b.attributes("variant"), b.text()])).toEqual([
      ["warning", "Rate limit"],
      ["danger", "Error"],
    ]);
  });
});
