import type { ConversationTurn, TurnToolCall } from "@tracepilot/types";
import { expect, it } from "vitest";
import { computed } from "vue";
import { useCrossTurnSubagents } from "../useCrossTurnSubagents";
import { useSubagentCompletions } from "../useSubagentCompletions";

it("links a read_agent UUID to its launching tool call", () => {
  const launch: TurnToolCall = {
    toolCallId: "launch",
    agentId: "runtime-uuid",
    toolName: "task",
    isSubagent: true,
    isComplete: true,
    agentStatus: "idle",
    arguments: { name: "Worker" },
  };
  const turns = computed(
    () =>
      [
        {
          turnIndex: 0,
          isComplete: true,
          toolCalls: [launch],
          assistantMessages: [],
          reasoningTexts: [],
        },
        {
          turnIndex: 1,
          isComplete: true,
          toolCalls: [
            {
              toolCallId: "read",
              toolName: "read_agent",
              isComplete: true,
              arguments: { agent_id: "runtime-uuid" },
            },
          ],
          assistantMessages: [],
          reasoningTexts: [],
        },
      ] as ConversationTurn[],
  );
  const { subagentMap, allSubagents } = useCrossTurnSubagents(turns);
  const result = useSubagentCompletions(
    turns,
    subagentMap,
    allSubagents,
    computed(() => new Map()),
  );
  expect(result.completionsByTurn.value.get(1)).toEqual(["launch"]);
  expect(result.completionLabel("launch")).toContain("idle");
});
