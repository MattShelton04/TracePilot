// Pure activity-stream builder for a subagent. Accepts a structural input
// (not `SubagentFullData`) so both the conversation and agent-tree adapters can
// produce activity items without synthesizing fake AttributedMessage objects.

import type { TurnToolCall } from "@tracepilot/types";
import type { AgentCommunication } from "../../utils/agentComms";
import { formatArgsSummary } from "../../utils/toolCall";
import type { SubagentActivityItem, SubagentActivityPillType } from "./types";

const PILL_TOOLS = new Set(["report_intent", "store_memory", "read_agent"]);

export interface SubagentActivityInput {
  parentId: string;
  childTools: TurnToolCall[];
  childReasoning: { content: string; agentDisplayName?: string; eventIndex?: number }[];
  /**
   * Exchanges with other agents (see `communicationsFor`). Launch prompts are
   * shown separately by hosts and are skipped here.
   */
  communications?: { inbound: AgentCommunication[]; outbound: AgentCommunication[] };
  /**
   * The agent's own replies. Streamed only when the agent received follow-up
   * messages, so each reply appears after the message that prompted it.
   */
  childMessages?: { content: string; eventIndex?: number }[];
}

/**
 * Builds an activity stream interleaving reasoning blocks with tool calls,
 * sorted by event index when available. Final assistant messages are NOT
 * included here — hosts render them in a separate "Output" section — unless
 * the agent held a multi-turn conversation (see {@link hasFollowUpMessages}).
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
  const sortKeyOf = (eventIndex: number | undefined) =>
    (eventIndex ?? Number.MAX_SAFE_INTEGER) + nextOrdinal() * 1e-6;

  for (let i = 0; i < input.childReasoning.length; i++) {
    const r = input.childReasoning[i];
    items.push({
      kind: "reasoning",
      key: `reasoning:${input.parentId}:${i}`,
      sortKey: sortKeyOf(r.eventIndex),
      content: r.content,
      agentName: r.agentDisplayName,
    });
  }

  const inbound = (input.communications?.inbound ?? []).filter((c) => c.kind === "message");
  for (const c of inbound) {
    const delivery = c.deliveries.find((d) => d.toKey === input.parentId);
    items.push({
      kind: "message",
      key: `message-in:${c.id}`,
      sortKey: sortKeyOf(delivery?.eventIndex ?? c.order),
      direction: "in",
      communication: c,
      delivery,
    });
  }

  const sent = new Map(
    (input.communications?.outbound ?? [])
      .filter((c) => c.kind === "message" && c.toolCallId)
      .map((c) => [c.toolCallId, c]),
  );
  for (let i = 0; i < input.childTools.length; i++) {
    const tc = input.childTools[i];
    const idKey = tc.toolCallId ?? `t:${input.parentId}:${i}`;
    const sortKey = sortKeyOf(tc.eventIndex);
    const message = tc.toolCallId ? sent.get(tc.toolCallId) : undefined;
    if (message) {
      items.push({
        kind: "message",
        key: `message-out:${idKey}`,
        sortKey,
        direction: "out",
        communication: message,
      });
      continue;
    }
    pushToolActivity(items, tc, idKey, sortKey);
  }

  if (inbound.length) {
    const replies = input.childMessages ?? [];
    for (let i = 0; i < replies.length; i++) {
      const m = replies[i];
      if (!m.content.trim()) continue;
      items.push({
        kind: "response",
        key: `response:${input.parentId}:${i}`,
        sortKey: sortKeyOf(m.eventIndex),
        content: m.content,
      });
    }
  }

  items.sort((a, b) => a.sortKey - b.sortKey);
  return items;
}

/** Whether the agent received messages after its launch prompt. */
export function hasFollowUpMessages(communications: SubagentActivityInput["communications"]) {
  return !!communications?.inbound.some((c) => c.kind === "message");
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
