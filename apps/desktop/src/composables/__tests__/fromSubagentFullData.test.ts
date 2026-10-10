import type { TurnToolCall } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import { fromSubagentFullData } from "@/composables/subagentView";

function view(toolCall: TurnToolCall) {
  return fromSubagentFullData({
    agentId: "a1",
    turnIndex: 18,
    toolCall,
    childTools: [],
    childMessages: [],
    childReasoning: [],
  });
}

describe("fromSubagentFullData panel title", () => {
  const base: TurnToolCall = { toolName: "task", toolCallId: "a1", isSubagent: true };

  it("titles a Claude Code agent by its native tool, as its card does", () => {
    expect(view({ ...base, nativeToolName: "Agent" }).displayName).toBe("Agent");
  });

  it("keeps Copilot's agent display name", () => {
    expect(view({ ...base, agentDisplayName: "Explore Agent" }).displayName).toBe("Explore Agent");
  });
});
