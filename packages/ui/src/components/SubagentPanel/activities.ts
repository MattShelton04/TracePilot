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
  childReasoning: { content: string; agentDisplayName?: string; eventIndex?: number }[];
}

/**
 * Builds an activity stream interleaving reasoning blocks with tool calls,
 * sorted by event index when available. Final assistant messages are NOT
 * included here — hosts render them in a separate "Output" section.
 *
 * Items with `eventIndex` use that as their primary sort key. Missing indices
 * fall back to MAX_SAFE_INTEGER so they sort to the end in input order
 * (reasoning before tools), which is the safe default for legacy data.
 */
export function buildSubagentActivities(input: SubagentActivityInput): SubagentActivityItem[] {
  const items: SubagentActivityItem[] = [];

  // Stable ordinal counter to preserve input order when event indices collide
  // (or are absent). Reasoning ordinals come first so a reasoning event tying
  // an event index with a tool call sorts just before that tool call.
  let ordinal = 0;
  const nextOrdinal = () => ordinal++;

  for (let i = 0; i < input.childReasoning.length; i++) {
    const r = input.childReasoning[i];
    const sortKey = (r.eventIndex ?? Number.MAX_SAFE_INTEGER) + nextOrdinal() * 1e-6;
    items.push({
      kind: "reasoning",
      key: `reasoning:${input.parentId}:${i}`,
      sortKey,
      content: r.content,
      agentName: r.agentDisplayName,
    });
  }

  for (let i = 0; i < input.childTools.length; i++) {
    const tc = input.childTools[i];
    const idKey = tc.toolCallId ?? `t:${input.parentId}:${i}`;
    const sortKey = (tc.eventIndex ?? Number.MAX_SAFE_INTEGER) + nextOrdinal() * 1e-6;
    pushToolActivity(items, tc, idKey, sortKey);
  }

  items.sort((a, b) => a.sortKey - b.sortKey);
  return items;
}

function pushToolActivity(
  items: SubagentActivityItem[],
  tc: TurnToolCall,
  idKey: string,
  sortKey: number,
): void {
  if (tc.isSubagent) {
    items.push({ kind: "nested-subagent", key: `nested:${idKey}`, sortKey, toolCall: tc });
    return;
  }
  if (PILL_TOOLS.has(tc.toolName)) {
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
    return;
  }
  items.push({ kind: "tool", key: `tool:${idKey}`, sortKey, toolCall: tc });
}
