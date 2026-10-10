import { setupPinia } from "@tracepilot/test-utils";
import type { ConversationTurn } from "@tracepilot/types";
import { shallowMount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { computed, ref } from "vue";
import ChatViewMode from "../ChatViewMode.vue";
import TaskNotificationCard from "../chat/TaskNotificationCard.vue";
import TurnBlock from "../chat/TurnBlock.vue";
import UserMessageAnchor from "../chat/UserMessageAnchor.vue";

const state = vi.hoisted(() => ({
  turns: [] as ConversationTurn[],
  revealEvent: (_turn: number, _event?: number) => {},
}));

vi.mock("@/composables/useChatViewModeData", () => ({
  useChatViewModeData: () => ({
    store: { sessionId: "s-1", detail: { id: "s-1", source: "claudeCode" } },
    turns: ref(state.turns),
    allSubagents: [],
    subagentMap: new Map(),
    panel: {
      isPanelOpen: computed(() => false),
      selectedAgentId: ref(null),
      selectedSubagent: ref(null),
      selectedIndex: ref(-1),
      hasPrev: ref(false),
      hasNext: ref(false),
      openSubagent: vi.fn(),
    },
    renderMd: false,
    fullResults: new Map(),
    loadingResults: new Set(),
    failedResults: new Set(),
    completionLabel: () => "",
    findToolCallIndex: () => 0,
    getArgsSummary: () => "",
    completionsByTurn: new Map(),
    subagentTurnColors: new Map(),
    renderDataFor: () => ({}),
    permissionDataFor: () => ({ entries: [], permissionByToolCallId: new Map() }),
    showGap: () => false,
    gapCount: () => 0,
    revealEvent: (turn: number, event?: number) => state.revealEvent(turn, event),
  }),
}));

function turn(overrides: Partial<ConversationTurn>): ConversationTurn {
  return {
    turnIndex: 0,
    assistantMessages: [],
    toolCalls: [],
    isComplete: true,
    ...overrides,
  };
}

describe("ChatViewMode notification turns", () => {
  beforeEach(() => setupPinia());

  it("renders a Claude notification wake as a card and links it to the launch", async () => {
    const reveal = vi.fn();
    state.revealEvent = reveal;
    state.turns = [
      turn({
        turnIndex: 0,
        userMessage: "Map it.",
        toolCalls: [
          {
            toolCallId: "toolu_ag1",
            toolName: "task",
            eventIndex: 7,
            isComplete: true,
          },
        ],
      }),
      turn({
        turnIndex: 1,
        userMessage: 'Agent "Map it" finished',
        systemInitiated: true,
        notifications: [
          { kind: "agent", toolUseId: "toolu_ag1", status: "completed" },
          { kind: "shell", toolUseId: "toolu_gone", status: "failed", exitCode: 1 },
        ],
      }),
    ];
    const wrapper = shallowMount(ChatViewMode);
    const anchors = wrapper.findAllComponents(UserMessageAnchor);
    expect(anchors.map((a) => a.props("content"))).toEqual(["Map it."]);
    const card = wrapper.getComponent(TaskNotificationCard);
    expect(card.props("turnIndex")).toBe(1);
    expect(card.props("notifications")).toHaveLength(2);
    const canReveal = card.props("canRevealLaunch")!;
    expect(canReveal("toolu_ag1")).toBe(true);
    expect(canReveal("toolu_gone")).toBe(false);

    card.vm.$emit("revealLaunch", "toolu_ag1");
    expect(reveal).toHaveBeenCalledWith(0, 7);
  });

  it("keeps the plain user anchor for a Copilot <system_notification> turn", () => {
    state.turns = [
      turn({
        turnIndex: 3,
        userMessage: "<system_notification>Agent completed</system_notification>",
        systemInitiated: true,
      }),
    ];
    const wrapper = shallowMount(ChatViewMode);
    expect(wrapper.findAllComponents(TaskNotificationCard)).toHaveLength(0);
    const anchor = wrapper.getComponent(UserMessageAnchor);
    expect(anchor.props("content")).toBe(
      "<system_notification>Agent completed</system_notification>",
    );
  });

  it("labels every model round trip by its turn index, so user turns never seem to skip", () => {
    // One prompt, a tool call, then the reply in the next round trip (turn 1).
    state.turns = [
      turn({ turnIndex: 0, userMessage: "Run the tests." }),
      turn({ turnIndex: 1 }),
      turn({ turnIndex: 2, userMessage: "Now lint." }),
    ];
    const wrapper = shallowMount(ChatViewMode);
    expect(wrapper.findAllComponents(UserMessageAnchor).map((a) => a.props("turnIndex"))).toEqual([
      0, 2,
    ]);
    // The round trip without its own anchor shows its label, which the anchors leave out.
    expect(wrapper.findAllComponents(TurnBlock).map((b) => b.props("showTurnLabel"))).toEqual([
      false,
      true,
      false,
    ]);
  });
});
