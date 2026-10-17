import { setupPinia } from "@tracepilot/test-utils";
import type { ConversationTurn, TurnSessionEvent } from "@tracepilot/types";
import { shallowMount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { computed, ref } from "vue";
import ChatViewMode from "../ChatViewMode.vue";
import SessionEventRow from "../SessionEventRow.vue";
import { pairPermissionEvents } from "../sessionEventPairing";

const state = vi.hoisted(() => ({ turns: [] as ConversationTurn[] }));

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
    permissionDataFor: (t: ConversationTurn) => pairPermissionEvents(t.sessionEvents ?? []),
    showGap: () => false,
    gapCount: () => 0,
    revealEvent: () => {},
  }),
}));

function event(
  eventType: string,
  timestamp: string | undefined,
  summary: string,
): TurnSessionEvent {
  return { eventType, timestamp, severity: "info", summary };
}

/** The stream's user anchors, turn blocks and session events, in order. */
function stream(wrapper: ReturnType<typeof shallowMount>): string[] {
  const events = wrapper.findAllComponents(SessionEventRow);
  return [
    ...wrapper.element.querySelectorAll(
      "user-message-anchor-stub, turn-block-stub, session-event-row-stub",
    ),
  ].map((el) => {
    if (el.tagName === "USER-MESSAGE-ANCHOR-STUB") return "prompt";
    if (el.tagName === "TURN-BLOCK-STUB") return "turn";
    const row = events.find((e) => e.element === el);
    return (row?.props("event") as TurnSessionEvent).summary;
  });
}

describe("ChatViewMode session event placement", () => {
  beforeEach(() => setupPinia());

  it("shows an event logged while a turn ran after that turn's tool calls", () => {
    state.turns = [
      {
        turnIndex: 0,
        userMessage: "Tag the release and push it.",
        timestamp: "2026-03-14T03:20:07.000Z",
        assistantMessages: [],
        toolCalls: [],
        isComplete: true,
        sessionEvents: [event("session.start", "2026-03-14T03:20:07.000Z", "Session started")],
      },
      {
        // A tool round trip: the push started at 03:20:35 and was rejected at 03:20:42.
        turnIndex: 1,
        timestamp: "2026-03-14T03:20:35.000Z",
        assistantMessages: [],
        toolCalls: [],
        isComplete: true,
        sessionEvents: [
          event("session.warning", "2026-03-14T03:20:42.000Z", "Tool use rejected"),
          event("session.info", undefined, "Untimed note"),
        ],
      },
    ];
    expect(stream(shallowMount(ChatViewMode))).toEqual([
      "Session started",
      "prompt",
      "turn",
      // Untimed events keep their old place, above the turn.
      "Untimed note",
      "turn",
      "Tool use rejected",
    ]);
  });
});
