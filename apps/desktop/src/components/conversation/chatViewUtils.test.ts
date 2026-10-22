import type { ConversationTurn, TurnToolCall } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import {
  chunkTurns,
  getCollapsedToolNames,
  orderTurnContent,
  segmentToolCalls,
  splitAtTurnStart,
} from "./chatViewUtils";

function makeToolCall(overrides: Partial<TurnToolCall>): TurnToolCall {
  return {
    toolName: "view",
    isComplete: true,
    ...overrides,
  };
}

it("shows native collapsed-tool tags while retaining Copilot names", () => {
  expect(
    getCollapsedToolNames(
      [
        { type: "tool", toolCall: makeToolCall({ nativeToolName: "Read" }) },
        { type: "tool", toolCall: makeToolCall({ toolName: "powershell" }) },
      ],
      0,
    ),
  ).toEqual(["Read", "powershell"]);
});

describe("segmentToolCalls", () => {
  it("keeps top-level read_agent visible as a tool-group item", () => {
    const segments = segmentToolCalls([
      makeToolCall({ toolName: "report_intent" }),
      makeToolCall({ toolName: "read_agent", arguments: { agent_id: "reviewer-1" } }),
      makeToolCall({ toolName: "ask_user" }),
    ]);

    expect(segments).toHaveLength(1);
    expect(segments[0]?.type).toBe("tool-group");

    if (segments[0]?.type !== "tool-group") return;
    expect(segments[0].items.map((item) => item.type)).toEqual([
      "intent",
      "read-agent",
      "ask-user",
    ]);
  });

  it("still skips child read_agent calls inside subagent internals", () => {
    const segments = segmentToolCalls([
      makeToolCall({ toolName: "task", toolCallId: "parent-1", isSubagent: true }),
      makeToolCall({
        toolName: "read_agent",
        parentToolCallId: "parent-1",
        arguments: { agent_id: "parent-1" },
      }),
      makeToolCall({ toolName: "view", parentToolCallId: "parent-1" }),
      makeToolCall({ toolName: "powershell" }),
    ]);

    expect(segments).toHaveLength(2);
    expect(segments[0]?.type).toBe("subagent-group");
    expect(segments[1]?.type).toBe("tool-group");

    if (segments[1]?.type !== "tool-group") return;
    expect(segments[1].items).toHaveLength(1);
    expect(segments[1].items[0]?.type).toBe("tool");
    expect(segments[1].items[0]?.toolCall.toolName).toBe("powershell");
  });
});

describe("orderTurnContent", () => {
  function turn(overrides: Partial<ConversationTurn>): ConversationTurn {
    return { turnIndex: 0, assistantMessages: [], toolCalls: [], isComplete: true, ...overrides };
  }
  const shell = (eventIndex?: number) => makeToolCall({ toolName: "powershell", eventIndex });

  /** Each rendered item, by its text or its tools' event indexes. */
  function layout(content: ReturnType<typeof orderTurnContent>): string[] {
    return content.order.map((ref) => {
      if (ref.kind === "reasoning") return `think:${content.reasoning[ref.index]}`;
      if (ref.kind === "message") return `reply:${content.messages[ref.index].content}`;
      const segment = content.segments[ref.index];
      return segment.type === "tool-group"
        ? `tools:${segment.items.map((i) => i.toolCall.eventIndex).join(",")}`
        : `agents:${segment.subagents.map((s) => s.eventIndex).join(",")}`;
    });
  }

  it("places replies between the tool calls they followed, splitting the tool group", () => {
    // The Copilot fixture: two tool calls, a reply, two more, a final reply.
    const content = orderTurnContent(
      turn({
        assistantMessages: [
          { content: "Found it", eventIndex: 7 },
          { content: "Fixed", eventIndex: 12 },
        ],
        reasoningTexts: [{ content: "plan", eventIndex: 7 }],
        toolCalls: [shell(3), shell(5), shell(8), shell(10)],
      }),
    );
    expect(layout(content)).toEqual([
      "tools:3,5",
      "think:plan",
      "reply:Found it",
      "tools:8,10",
      "reply:Fixed",
    ]);
  });

  it("keeps a reply that came before any tool call above them", () => {
    const content = orderTurnContent(
      turn({
        assistantMessages: [{ content: "Let me look", eventIndex: 2 }],
        toolCalls: [shell(3), shell(4)],
      }),
    );
    expect(layout(content)).toEqual(["reply:Let me look", "tools:3,4"]);
  });

  it("ignores subagent children and subagent text when placing main replies", () => {
    const content = orderTurnContent(
      turn({
        assistantMessages: [
          { content: "child says", eventIndex: 6, parentToolCallId: "agent-1" },
          { content: "Agent done", eventIndex: 9 },
        ],
        toolCalls: [
          makeToolCall({
            toolName: "task",
            toolCallId: "agent-1",
            isSubagent: true,
            eventIndex: 4,
          }),
          makeToolCall({ toolName: "view", parentToolCallId: "agent-1" }),
          shell(11),
        ],
      }),
    );
    expect(layout(content)).toEqual(["agents:4", "reply:Agent done", "tools:11"]);
  });

  it("keeps the previous layout when an item has no event index", () => {
    const content = orderTurnContent(
      turn({
        assistantMessages: [{ content: "streamed" }],
        reasoningTexts: [{ content: "plan", eventIndex: 1 }],
        toolCalls: [shell(3), shell(5)],
      }),
    );
    expect(layout(content)).toEqual(["think:plan", "reply:streamed", "tools:3,5"]);
  });
});

describe("chunkTurns", () => {
  const turns = Array.from({ length: 23 }, (_, i) => ({ turnIndex: i + 5 }));

  it("splits turns into fixed-size chunks keyed by first turn index", () => {
    const chunks = chunkTurns(turns, 10);
    expect(chunks.map((c) => c.turns.length)).toEqual([10, 10, 3]);
    expect(chunks.map((c) => c.key)).toEqual([5, 15, 25]);
    expect(chunks.map((c) => c.start)).toEqual([0, 10, 20]);
    expect(chunks.flatMap((c) => c.turns)).toEqual(turns);
  });

  it("keeps existing chunk keys stable when turns are appended", () => {
    const before = chunkTurns(turns.slice(0, 12), 10).map((c) => c.key);
    const after = chunkTurns(turns, 10).map((c) => c.key);
    expect(after.slice(0, before.length)).toEqual(before);
  });

  it("returns no chunks for an empty conversation", () => {
    expect(chunkTurns([], 10)).toEqual([]);
  });
});

describe("splitAtTurnStart", () => {
  const at = (timestamp?: string) => ({ timestamp });
  const time = (item: { timestamp?: string }) => item.timestamp;

  it("puts events at or before the turn start above it and later ones after", () => {
    const start = at("2026-03-14T03:20:07.000Z");
    const same = at("2026-03-14T03:20:35.000Z");
    const warning = at("2026-03-14T03:20:42.000Z");
    const split = splitAtTurnStart(
      [start, same, warning],
      "2026-03-14T03:20:35.000Z",
      time,
      "after",
    );
    expect(split.before).toEqual([start, same]);
    expect(split.after).toEqual([warning]);
  });

  it("sends untimed events, or every event of an untimed turn, to the given side", () => {
    const untimed = at();
    const timed = at("2026-03-14T03:20:42.000Z");
    expect(splitAtTurnStart([untimed, timed], "2026-03-14T03:20:35.000Z", time, "before")).toEqual({
      before: [untimed],
      after: [timed],
    });
    expect(splitAtTurnStart([untimed, timed], undefined, time, "after")).toEqual({
      before: [],
      after: [untimed, timed],
    });
  });
});
