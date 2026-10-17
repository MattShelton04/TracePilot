import type { TurnToolCall } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import {
  chunkTurns,
  getCollapsedToolNames,
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
