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

describe("ConversationTurnList model badge", () => {
  beforeEach(() => setupPinia());

  function badge(viewMode: "compact" | "timeline", source?: "claudeCode" | "copilot") {
    const wrapper = shallowMount(ConversationTurnList, {
      props: {
        turns: [{ ...turn, model: "claude-opus-5-5" }],
        viewMode,
        source,
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
      global: { stubs: { Badge: { template: "<span class='badge'><slot /></span>" } } },
    } as never);
    return wrapper.get(".badge[title='claude-opus-5-5']").text();
  }

  it("names a Claude Code model as cards do in both views", () => {
    expect(badge("compact", "claudeCode")).toBe("claude-opus-5.5");
    expect(badge("timeline", "claudeCode")).toBe("claude-opus-5.5");
  });

  it("keeps the recorded id for Copilot", () => {
    expect(badge("compact", "copilot")).toBe("claude-opus-5-5");
    expect(badge("timeline")).toBe("claude-opus-5-5");
  });
});
