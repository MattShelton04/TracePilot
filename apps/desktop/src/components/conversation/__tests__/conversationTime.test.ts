import { setupPinia } from "@tracepilot/test-utils";
import type { ConversationTurn, TurnSessionEvent } from "@tracepilot/types";
import { formatTime } from "@tracepilot/ui";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, type PropType } from "vue";
import ConversationTurnList from "../ConversationTurnList.vue";
import UserMessageAnchor from "../chat/UserMessageAnchor.vue";
import { conversationTimestamps, provideConversationDates } from "../conversationTime";
import SessionEventRow from "../SessionEventRow.vue";

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("@/__tests__/mocks/client");
  return createClientMock();
});

// Local times, so the day boundary holds in any time zone.
const lateNight = new Date(2026, 2, 14, 23, 10, 4).toISOString();
const nextMorning = new Date(2026, 2, 15, 9, 2, 11).toISOString();
const sameEvening = new Date(2026, 2, 14, 23, 40, 0).toISOString();

const noop = { has: () => false, toggle: () => {} };

function turn(turnIndex: number, timestamp: string, events: TurnSessionEvent[] = []) {
  return {
    turnIndex,
    userMessage: `Prompt ${turnIndex}`,
    timestamp,
    assistantMessages: [],
    toolCalls: [],
    isComplete: true,
    sessionEvents: events,
  } as unknown as ConversationTurn;
}

const resumed: TurnSessionEvent = {
  eventType: "session.resume",
  timestamp: nextMorning,
  severity: "info",
  summary: "Session resumed",
};

/** Provides the dates decision for `turns`, as the Conversation tab does, around `render`. */
function withProvider(turns: ConversationTurn[], render: () => ReturnType<typeof h>) {
  return mount(
    defineComponent({
      props: { turns: { type: Array as PropType<ConversationTurn[]>, required: true } },
      setup(props) {
        provideConversationDates(() => props.turns);
        return render;
      },
    }),
    {
      props: { turns },
      global: {
        stubs: {
          Badge: true,
          ToolCallItem: true,
          ReasoningBlock: true,
          AgentBadge: true,
          CacheLiveDivider: true,
          CacheResumeDivider: true,
          MessageCopyButton: true,
        },
      },
    },
  );
}

function turnList(turns: ConversationTurn[], viewMode: "compact" | "timeline") {
  return withProvider(turns, () =>
    h(ConversationTurnList, {
      turns,
      viewMode,
      getSections: () => [],
      getArgsSummary: () => "",
      findToolCallIndex: () => 0,
      expandedToolDetails: noop,
      expandedReasoning: noop,
      fullResults: new Map<string, string>(),
      loadingResults: new Set<string>(),
      failedResults: new Set<string>(),
      richEnabledFor: () => false,
    }),
  );
}

/** The clock labels a view shows, in order. */
function times(wrapper: ReturnType<typeof mount>): { text: string; title?: string }[] {
  return wrapper
    .findAll(".turn-meta")
    .filter((el) => /\d:\d\d:\d\d/.test(el.text()))
    .map((el) => ({ text: el.text(), title: el.attributes("title") }));
}

function dated(iso: string): string {
  const date = new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
  return `${date}, ${formatTime(iso)}`;
}

describe("conversation times across days", () => {
  beforeEach(() => setupPinia());

  it("collects turn and session event times", () => {
    expect(conversationTimestamps([turn(5, lateNight), turn(6, sameEvening, [resumed])])).toEqual([
      lateNight,
      sameEvening,
      nextMorning,
    ]);
  });

  it.each([
    "compact",
    "timeline",
  ] as const)("%s view dates every time when the session runs past midnight", (viewMode) => {
    const turns = [turn(5, lateNight), turn(6, nextMorning)];
    const labels = times(turnList(turns, viewMode));
    expect(labels.map((l) => l.text)).toEqual([dated(lateNight), dated(nextMorning)]);
    expect(labels[1].title).toBe(new Date(nextMorning).toLocaleString());
  });

  it.each([
    "compact",
    "timeline",
  ] as const)("%s view keeps clock-only times for a single-day session", (viewMode) => {
    const turns = [turn(5, lateNight), turn(6, sameEvening)];
    const labels = times(turnList(turns, viewMode));
    expect(labels.map((l) => l.text)).toEqual([formatTime(lateNight), formatTime(sameEvening)]);
    // The full date is still a hover away.
    expect(labels[0].title).toBe(new Date(lateNight).toLocaleString());
  });

  it("counts a session event logged the next day, and dates it in the timeline", () => {
    const turns = [turn(5, lateNight, [resumed])];
    const labels = times(turnList(turns, "timeline"));
    expect(labels.map((l) => l.text)).toEqual([dated(lateNight), dated(nextMorning)]);
  });

  it("dates chat view prompts and session events from the same decision", () => {
    const turns = [turn(5, lateNight), turn(6, nextMorning)];
    const wrapper = withProvider(turns, () =>
      h("div", [
        h(UserMessageAnchor, {
          content: "Prompt 6",
          turnIndex: 6,
          timestamp: nextMorning,
          renderMarkdown: false,
        }),
        h(SessionEventRow, { event: resumed }),
      ]),
    );
    expect(wrapper.get(".cv-user-time").text()).toBe(dated(nextMorning));
    expect(wrapper.get(".cv-session-event-time").text()).toBe(dated(nextMorning));
  });

  it("chat view stays clock-only for a single-day session", () => {
    const turns = [turn(5, lateNight), turn(6, sameEvening)];
    const wrapper = withProvider(turns, () =>
      h(UserMessageAnchor, {
        content: "Prompt 6",
        turnIndex: 6,
        timestamp: sameEvening,
        renderMarkdown: false,
      }),
    );
    const time = wrapper.get(".cv-user-time");
    expect(time.text()).toBe(formatTime(sameEvening));
    expect(time.attributes("title")).toBe(new Date(sameEvening).toLocaleString());
  });
});
