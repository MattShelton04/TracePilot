import { setupPinia } from "@tracepilot/test-utils";
import type { ConversationTurn } from "@tracepilot/types";
import { shallowMount } from "@vue/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import ConversationTurnList from "../ConversationTurnList.vue";

const noop = { has: () => false, toggle: () => {} };

/** Claude Code's `/cost`: no model call, its output logged after it. */
const command: ConversationTurn = {
  turnIndex: 1,
  eventIndex: 4,
  userMessage: "/cost",
  timestamp: "2026-10-07T10:00:35.000Z",
  assistantMessages: [],
  toolCalls: [],
  isComplete: true,
  systemMessages: ["Total cost: $0.00"],
  commandOutputEventIndices: [6],
};

function mountList(viewMode: "compact" | "timeline", turn: ConversationTurn) {
  return shallowMount(ConversationTurnList, {
    props: {
      turns: [turn],
      viewMode,
      getSections: () => [],
      getArgsSummary: () => "",
      findToolCallIndex: () => 0,
      expandedToolDetails: noop,
      expandedReasoning: noop,
      fullResults: new Map(),
      loadingResults: new Set(),
      failedResults: new Set(),
      richEnabledFor: () => false,
    },
  } as never);
}

describe("ConversationTurnList slash command output", () => {
  beforeEach(() => setupPinia());

  it.each([
    "compact",
    "timeline",
  ] as const)("%s view shows the output after the command, as a deep-link target", (viewMode) => {
    const root = mountList(viewMode, command).element as HTMLElement;
    const text = root.textContent ?? "";
    expect(text.indexOf("Total cost: $0.00")).toBeGreaterThan(text.indexOf("/cost"));
    const target = root.querySelector('[data-event-idx="6"]');
    expect(target?.textContent).toContain("Total cost: $0.00");
    expect(text).not.toContain("Incomplete");
  });

  it.each([
    "compact",
    "timeline",
  ] as const)("%s view still leaves system prompts out", (viewMode) => {
    const prompted = {
      ...command,
      userMessage: "Review it",
      systemMessages: ["You are a reviewer."],
      commandOutputEventIndices: undefined,
    };
    const root = mountList(viewMode, prompted).element as HTMLElement;
    expect(root.textContent).not.toContain("You are a reviewer.");
    expect(root.querySelector(".command-output")).toBeNull();
  });
});
