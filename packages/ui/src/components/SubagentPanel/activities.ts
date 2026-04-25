// Pure activity-stream builder for a subagent. Accepts a structural input
// (not `SubagentFullData`) so both the conversation and agent-tree adapters can
// produce activity items without synthesizing fake AttributedMessage objects.

import type { TurnToolCall } from "@tracepilot/types";
import { formatArgsSummary } from "../../utils/toolCall";
import type { SubagentActivityItem, SubagentActivityPillType } from "./types";

const PILL_TOOLS = new Set(["report_intent", "store_memory", "read_agent"]);

export interface SubagentActivityInput {
  parentId: string;
  childTools: TurnToolCall[];
  childMessages: { content: string; agentDisplayName?: string }[];
  childReasoning: { content: string; agentDisplayName?: string }[];
}

export function buildSubagentActivities(input: SubagentActivityInput): SubagentActivityItem[] {
  const items: SubagentActivityItem[] = [];

  // Interleave reasoning with tool calls by index. Reasoning typically precedes
  // its corresponding tool call in the underlying event stream, so reasoning[i]
  // is emitted just before tool[i]. Trailing reasoning (more reasoning than
  // tools) lands after the last tool. Final assistant messages always render
  // last (sortKey = +Infinity).
  const maxPaired = Math.max(input.childReasoning.length, input.childTools.length);

  for (let i = 0; i < maxPaired; i++) {
    const r = input.childReasoning[i];
    if (r) {
      items.push({
        kind: "reasoning",
        key: `reasoning:${input.parentId}:${i}`,
        sortKey: i,
        content: r.content,
        agentName: r.agentDisplayName,
      });
    }

    const tc = input.childTools[i];
    if (tc) {
      const sortKey = i + 0.5;
      const idKey = tc.toolCallId ?? `t:${input.parentId}:${i}`;

      if (tc.isSubagent) {
        items.push({ kind: "nested-subagent", key: `nested:${idKey}`, sortKey, toolCall: tc });
      } else if (PILL_TOOLS.has(tc.toolName)) {
        const pillType: SubagentActivityPillType =
          tc.toolName === "report_intent"
            ? "intent"
            : tc.toolName === "store_memory"
              ? "memory"
              : "read_agent";
        const label = formatArgsSummary(tc.arguments, tc.toolName) || tc.toolName;
        items.push({
          kind: "pill",
          key: `pill:${idKey}`,
          sortKey,
          type: pillType,
          label,
          toolCall: tc,
        });
      } else {
        items.push({ kind: "tool", key: `tool:${idKey}`, sortKey, toolCall: tc });
      }
    }
  }

  for (let i = 0; i < input.childMessages.length; i++) {
    const m = input.childMessages[i];
    items.push({
      kind: "message",
      key: `message:${input.parentId}:${i}`,
      sortKey: Number.POSITIVE_INFINITY,
      content: m.content,
      agentName: m.agentDisplayName,
    });
  }

  items.sort((a, b) => a.sortKey - b.sortKey);
  return items;
}
