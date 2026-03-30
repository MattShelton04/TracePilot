import type { TurnToolCall } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import { segmentToolCalls } from "./chatViewUtils";

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
