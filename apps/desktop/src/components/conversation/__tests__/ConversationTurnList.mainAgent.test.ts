import { setupPinia } from "@tracepilot/test-utils";
import type { ConversationTurn } from "@tracepilot/types";
import { MAIN_AGENT_LABEL_KEY } from "@tracepilot/ui";
import { shallowMount } from "@vue/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { computed } from "vue";
import ConversationTurnList from "../ConversationTurnList.vue";

const turn = {
  turnIndex: 0,
  userMessage: "Check the retry path",
  assistantMessages: [{ content: "The retry path looks fine." }],
  toolCalls: [],
  isComplete: true,
} as unknown as ConversationTurn;

const noop = { has: () => false, toggle: () => {} };

function mountList(viewMode: "compact" | "timeline", label?: string) {
  return shallowMount(ConversationTurnList, {
    props: {
      turns: [turn],
      viewMode,
      getSections: () => [
        {
          agentId: undefined,
          agentType: "main",
          messages: ["The retry path looks fine."],
          reasoning: [],
          toolCalls: [],
        },
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
    global: label
      ? { provide: { [MAIN_AGENT_LABEL_KEY as symbol]: computed(() => label) } }
      : undefined,
  } as never);
}

describe("ConversationTurnList main-agent label", () => {
  beforeEach(() => setupPinia());

  it("labels compact main-agent replies Copilot by default", () => {
    expect(mountList("compact").get(".compact-turn-label-prefix.assistant").text()).toBe(
      "Copilot:",
    );
  });

  it("labels compact main-agent replies from the session source", () => {
    const prefix = mountList("compact", "Claude Code").get(".compact-turn-label-prefix.assistant");
    expect(prefix.text()).toBe("Claude Code:");
  });

  it("labels timeline main-agent replies from the session source", () => {
    const label = mountList("timeline", "Claude Code").get(".timeline-block-label.assistant");
    expect(label.text()).toBe("Claude Code");
  });
});
