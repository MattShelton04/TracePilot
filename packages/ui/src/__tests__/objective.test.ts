import type { TurnToolCall } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import type { SubagentActivityItem } from "../components/SubagentPanel/types";
import {
  getCurrentObjective,
  getMainAgentObjective,
  getSubagentObjective,
} from "../utils/objective";

function intentCall(intent: string, partial: Partial<TurnToolCall> = {}): TurnToolCall {
  return {
    toolName: "report_intent",
    isComplete: true,
    arguments: { intent },
    ...partial,
  };
}

describe("getCurrentObjective", () => {
  it("returns null when there are no tool calls", () => {
    expect(getCurrentObjective([])).toBeNull();
  });

  it("returns null when there are no report_intent calls", () => {
    const calls: TurnToolCall[] = [
      { toolName: "view", isComplete: true, arguments: { path: "/x" } },
      { toolName: "grep", isComplete: true, arguments: {} },
    ];
    expect(getCurrentObjective(calls)).toBeNull();
  });

  it("ignores empty / whitespace intents", () => {
    const calls = [intentCall("   "), intentCall("")];
    expect(getCurrentObjective(calls)).toBeNull();
  });

  it("returns the latest intent ordered by eventIndex", () => {
    const calls = [
      intentCall("first", { eventIndex: 1, toolCallId: "a" }),
      intentCall("middle", { eventIndex: 5, toolCallId: "b" }),
      intentCall("latest", { eventIndex: 9, toolCallId: "c" }),
      intentCall("older", { eventIndex: 4, toolCallId: "d" }),
    ];
    const obj = getCurrentObjective(calls);
    expect(obj).not.toBeNull();
    expect(obj!.text).toBe("latest");
    expect(obj!.toolCallId).toBe("c");
    expect(obj!.eventIndex).toBe(9);
    expect(obj!.updateCount).toBe(4);
  });

  it("falls back to timestamp when eventIndex is missing", () => {
    const calls = [
      intentCall("a", { startedAt: "2024-01-01T10:00:00Z" }),
      intentCall("b", { startedAt: "2024-01-01T11:00:00Z" }),
      intentCall("c", { startedAt: "2024-01-01T09:00:00Z" }),
    ];
    expect(getCurrentObjective(calls)!.text).toBe("b");
  });

  it("falls back to input order when neither eventIndex nor timestamp is set", () => {
    const calls = [intentCall("first"), intentCall("second"), intentCall("third")];
    expect(getCurrentObjective(calls)!.text).toBe("third");
  });

  it("trims surrounding whitespace from the intent text", () => {
    const calls = [intentCall("  Building things  ", { eventIndex: 1 })];
    expect(getCurrentObjective(calls)!.text).toBe("Building things");
  });

  it("does not count consecutive duplicate intent text as a new update", () => {
    const calls = [
      intentCall("building", { eventIndex: 1 }),
      intentCall("building", { eventIndex: 2 }),
      intentCall("testing", { eventIndex: 3 }),
    ];
    expect(getCurrentObjective(calls)!.updateCount).toBe(2);
  });
});

describe("getMainAgentObjective", () => {
  it("scopes to tool calls without a parentToolCallId", () => {
    const turns = [
      {
        toolCalls: [
          intentCall("subagent intent", { eventIndex: 5, parentToolCallId: "p1" }),
          intentCall("main intent", { eventIndex: 6 }),
        ],
      },
      {
        toolCalls: [intentCall("nested", { eventIndex: 12, parentToolCallId: "p2" })],
      },
    ];
    expect(getMainAgentObjective(turns)!.text).toBe("main intent");
  });

  it("returns null when only sub-agents have intents", () => {
    const turns = [
      {
        toolCalls: [intentCall("child only", { eventIndex: 1, parentToolCallId: "p" })],
      },
    ];
    expect(getMainAgentObjective(turns)).toBeNull();
  });

  it("prefers eventIndex chronology over timestamp fallback when records are mixed", () => {
    const turns = [
      {
        toolCalls: [
          intentCall("timestamp-only", { startedAt: "2099-01-01T00:00:00Z" }),
          intentCall("event-indexed", { eventIndex: 1, startedAt: "2024-01-01T00:00:00Z" }),
        ],
      },
    ];
    expect(getMainAgentObjective(turns)!.text).toBe("event-indexed");
  });

  it("counts every main-agent intent update", () => {
    const turns = [
      {
        toolCalls: [intentCall("a", { eventIndex: 1 }), intentCall("b", { eventIndex: 4 })],
      },
      { toolCalls: [intentCall("c", { eventIndex: 9 })] },
    ];
    const obj = getMainAgentObjective(turns)!;
    expect(obj.text).toBe("c");
    expect(obj.updateCount).toBe(3);
  });
});

describe("getSubagentObjective", () => {
  function pill(intent: string, eventIndex?: number): SubagentActivityItem {
    return {
      kind: "pill",
      key: `pill-${intent}`,
      sortKey: eventIndex ?? 0,
      type: "intent",
      label: intent,
      toolCall: {
        toolName: "report_intent",
        isComplete: true,
        arguments: { intent },
        eventIndex,
      },
    };
  }

  it("returns null when there are no intent pills", () => {
    const activities: SubagentActivityItem[] = [
      { kind: "reasoning", key: "r", sortKey: 0, content: "thinking" },
    ];
    expect(getSubagentObjective(activities)).toBeNull();
  });

  it("returns latest intent pill", () => {
    const activities: SubagentActivityItem[] = [
      pill("first", 2),
      { kind: "reasoning", key: "r", sortKey: 3, content: "..." },
      pill("second", 10),
      pill("third", 7),
    ];
    const obj = getSubagentObjective(activities)!;
    expect(obj.text).toBe("second");
    expect(obj.updateCount).toBe(3);
  });

  it("ignores non-intent pills", () => {
    const activities: SubagentActivityItem[] = [
      pill("real", 1),
      {
        kind: "pill",
        key: "mem",
        sortKey: 5,
        type: "memory",
        label: "saved fact",
        toolCall: {
          toolName: "store_memory",
          isComplete: true,
          arguments: { fact: "x" },
          eventIndex: 5,
        },
      },
    ];
    expect(getSubagentObjective(activities)!.text).toBe("real");
  });

  it("falls back to the pill label when the args lack an intent string", () => {
    const activities: SubagentActivityItem[] = [
      {
        kind: "pill",
        key: "p",
        sortKey: 1,
        type: "intent",
        label: "Label fallback",
        toolCall: { toolName: "report_intent", isComplete: true, arguments: {}, eventIndex: 1 },
      },
    ];
    expect(getSubagentObjective(activities)!.text).toBe("Label fallback");
  });
});
