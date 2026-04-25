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
  let idx = 0;

  for (let i = 0; i < input.childReasoning.length; i++) {
    const r = input.childReasoning[i];
    items.push({
      kind: "reasoning",
      key: `reasoning:${input.parentId}:${i}`,
      sortKey: -1000 + idx,
      content: r.content,
      agentName: r.agentDisplayName,
    });
    idx++;
  }

  for (let i = 0; i < input.childTools.length; i++) {
    const tc = input.childTools[i];
    const sortKey = tc.eventIndex ?? idx;
    const idKey = tc.toolCallId ?? `t:${input.parentId}:${i}`;

    if (tc.isSubagent) {
      items.push({
        kind: "nested-subagent",
        key: `nested:${idKey}`,
        sortKey,
        toolCall: tc,
      });
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
    idx++;
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
