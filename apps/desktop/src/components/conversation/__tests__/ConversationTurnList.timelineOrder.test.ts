import { setupPinia } from "@tracepilot/test-utils";
import type { ConversationTurn, TurnToolCall } from "@tracepilot/types";
import { useConversationSections } from "@tracepilot/ui";
import { shallowMount } from "@vue/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { reactive } from "vue";
import ConversationTurnList from "../ConversationTurnList.vue";

const noop = { has: () => false, toggle: () => {} };

const shell = (id: string, eventIndex?: number): TurnToolCall => ({
  toolCallId: id,
  toolName: "powershell",
  eventIndex,
  isComplete: true,
  success: true,
});

// The synthetic "Ship the ripeness fix" turn: check the PR, reply, merge,
// push, open the follow-up PR, reply.
function shipTurn(withOrder = true): ConversationTurn {
  const at = (n: number) => (withOrder ? n : undefined);
  return {
    turnIndex: 0,
    userMessage: "Ship the ripeness fix",
    assistantMessages: [
      { content: "Its checks pass. Merging it.", eventIndex: at(5) },
      { content: "Merged #57 and opened #58.", eventIndex: at(12) },
    ],
    toolCalls: [
      shell("view", at(3)),
      shell("merge", at(7)),
      shell("push", at(9)),
      shell("create", at(11)),
    ],
    isComplete: true,
  } as ConversationTurn;
}

function mountList(turn: ConversationTurn, viewMode: "compact" | "timeline" = "timeline") {
  // One source for both, as ConversationTab passes `store.turns`.
  const turns = reactive([turn]);
  const { getSections } = useConversationSections(() => turns);
  return shallowMount(ConversationTurnList, {
    props: {
      turns,
      viewMode,
      getSections,
      getArgsSummary: () => "",
      findToolCallIndex: (t: ConversationTurn, tc: TurnToolCall) => t.toolCalls.indexOf(tc),
      expandedToolDetails: noop,
      expandedReasoning: noop,
      fullResults: new Map(),
      loadingResults: new Set(),
      failedResults: new Set(),
      richEnabledFor: () => false,
    },
    global: {
      stubs: {
        ToolCallItem: {
          props: ["tc"],
          template: '<div class="tool-stub">{{ tc.toolCallId }}</div>',
        },
      },
    },
  } as never);
}

/** Replies and tool calls in document order. */
function timelineOrder(wrapper: ReturnType<typeof mountList>): string[] {
  return wrapper
    .findAll(".tool-stub, .timeline-block.assistant .timeline-block-text")
    .map((el) => `${el.classes("tool-stub") ? "tool" : "reply"}:${el.text()}`);
}

describe("ConversationTurnList timeline order", () => {
  beforeEach(() => setupPinia());

  it("shows each reply between the tool calls it came after and before", () => {
    expect(timelineOrder(mountList(shipTurn()))).toEqual([
      "tool:view",
      "reply:Its checks pass. Merging it.",
      "tool:merge",
      "tool:push",
      "tool:create",
      "reply:Merged #57 and opened #58.",
    ]);
  });

  it("keeps tool calls before replies when the turn has no event order", () => {
    expect(timelineOrder(mountList(shipTurn(false)))).toEqual([
      "tool:view",
      "tool:merge",
      "tool:push",
      "tool:create",
      "reply:Its checks pass. Merging it.",
      "reply:Merged #57 and opened #58.",
    ]);
  });

  it("leaves compact mode's grouped tool pills after the replies", () => {
    const wrapper = mountList(shipTurn(), "compact");
    const body = wrapper.get(".compact-turn-body").element;
    const labels = [...body.children].map((el) => el.className).filter(Boolean);
    expect(labels).toEqual(["compact-turn-label", "compact-turn-label", "compact-tool-pills"]);
  });
});
