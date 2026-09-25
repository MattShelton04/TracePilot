import type { TurnToolCall } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import { chunkTurns, segmentToolCalls } from "./chatViewUtils";

function makeToolCall(overrides: Partial<TurnToolCall>): TurnToolCall {
  return {
    toolName: "view",
    isComplete: true,
    ...overrides,
  };
}

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
