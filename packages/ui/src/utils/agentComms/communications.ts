// Communication log: every exchange between agents in a session, in order.
//
// Evidence comes from both ends of each exchange:
// - the sender's tool calls: `task` launches, `write_agent` messages and
//   `read_agent` reads (present in every CLI version), and
// - the recipient's delivered messages (`ConversationTurn.agentMessages`,
//   1.0.78+), which add delivery time, queueing and sibling senders.
// A sent message is matched to its deliveries by sender, recipient and text.

import type { AgentMessage, ConversationTurn, TurnToolCall } from "@tracepilot/types";
import { getToolArgs, toolArgString } from "@tracepilot/types";
import { type AgentDirectory, type AgentDirectoryEntry, MAIN_AGENT_KEY } from "./directory";
import {
  type AgentRuntimeStatus,
  parseReadAgentResult,
  parseWriteAgentResult,
  writeAgentTarget,
} from "./parsers";

/**
 * `launch` — a task prompt starting an agent.
 * `message` — a `write_agent` message (or a delivery with no recorded send).
 * `read` — a `read_agent` call pulling a worker's state back to the reader.
 */
export type AgentCommKind = "launch" | "message" | "read";

/**
 * `down` — to an agent the sender launched (directly or transitively).
 * `up` — to one of the sender's ancestors (reads flow this way).
 * `peer` — between agents in different branches, typically siblings.
 */
export type AgentCommRelation = "down" | "up" | "peer";

export interface AgentCommDelivery {
  toKey: string;
  /** `idle` or `queued` when the recipient's log recorded the delivery. */
  delivery?: string;
  deliveredAt?: string;
  eventIndex?: number;
}

export interface AgentCommunication {
  id: string;
  kind: AgentCommKind;
  fromKey: string;
  toKeys: string[];
  relation: AgentCommRelation;
  /** `siblings` / `children` for scoped broadcasts. */
  scope?: string;
  content: string;
  /** When the exchange started (send time, or read completion for reads). */
  at?: string;
  /** Position in the event stream, for stable ordering. */
  order: number;
  /** The tool call that carried the exchange, when one was recorded. */
  toolCallId?: string;
  deliveries: AgentCommDelivery[];
  failed: boolean;
  /** Reads only: whether the worker had output to return (not a timed-out poll). */
  returned?: boolean;
  /** Reads only: the worker's state when read. */
  readStatus?: AgentRuntimeStatus;
}

interface OrderedToolCall {
  tc: TurnToolCall;
  order: number;
}

function orderOf(eventIndex: number | undefined, fallback: number): number {
  return eventIndex ?? Number.MAX_SAFE_INTEGER - 1_000_000 + fallback;
}

function classify(
  directory: AgentDirectory,
  fromKey: string,
  toKeys: readonly string[],
): AgentCommRelation {
  if (!toKeys.length) return "down";
  if (toKeys.every((to) => directory.isAncestor(fromKey, to))) return "down";
  if (toKeys.every((to) => directory.isAncestor(to, fromKey))) return "up";
  return "peer";
}

function senderKey(directory: AgentDirectory, tc: TurnToolCall): string {
  return (tc.parentToolCallId && directory.get(tc.parentToolCallId)?.key) || MAIN_AGENT_KEY;
}

function messageSenderKey(directory: AgentDirectory, message: AgentMessage): string {
  if (message.senderToolCallId && directory.get(message.senderToolCallId)) {
    return message.senderToolCallId;
  }
  return directory.resolve(message.senderAgentId)?.key ?? MAIN_AGENT_KEY;
}

function resolveKeys(directory: AgentDirectory, ids: readonly string[]): string[] {
  const keys: string[] = [];
  for (const id of ids) {
    const key = directory.resolve(id)?.key;
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

/** Recipients a scope addressed, as the directory understands the tree. */
function scopeRecipients(
  directory: AgentDirectory,
  fromKey: string,
  scope: string,
): AgentDirectoryEntry[] {
  const from = directory.get(fromKey);
  if (scope === "children") {
    return directory.entries.filter((e) => !e.isMain && directory.isAncestor(fromKey, e.key));
  }
  if (scope === "siblings" && from && !from.isMain) {
    return directory.entries.filter(
      (e) => !e.isMain && e.key !== fromKey && e.parentKey === from.parentKey,
    );
  }
  return [];
}

export function buildAgentCommunications(
  turns: readonly ConversationTurn[],
  directory: AgentDirectory,
): AgentCommunication[] {
  const calls: OrderedToolCall[] = [];
  const delivered: AgentMessage[] = [];
  let fallback = 0;
  for (const turn of turns) {
    for (const tc of turn.toolCalls) calls.push({ tc, order: orderOf(tc.eventIndex, fallback++) });
    if (turn.agentMessages) delivered.push(...turn.agentMessages);
  }
  const unmatched = new Set(delivered);
  const takeDelivery = (predicate: (m: AgentMessage) => boolean): AgentMessage | undefined => {
    for (const m of unmatched) {
      if (predicate(m)) {
        unmatched.delete(m);
        return m;
      }
    }
    return undefined;
  };
  const toDelivery = (m: AgentMessage): AgentCommDelivery => ({
    toKey: m.recipientToolCallId,
    delivery: m.delivery,
    deliveredAt: m.timestamp,
    eventIndex: m.eventIndex,
  });

  const log: AgentCommunication[] = [];
  for (const { tc, order } of calls) {
    if (tc.mcpServerName) continue;
    const fromKey = senderKey(directory, tc);
    const args = getToolArgs(tc);

    if (tc.isSubagent && tc.toolCallId && directory.get(tc.toolCallId)) {
      const launch = takeDelivery((m) => m.isLaunch && m.recipientToolCallId === tc.toolCallId);
      log.push({
        id: `launch:${tc.toolCallId}`,
        kind: "launch",
        fromKey,
        toKeys: [tc.toolCallId],
        relation: "down",
        content: toolArgString(args, "prompt") || launch?.content || "",
        at: tc.startedAt,
        order,
        toolCallId: tc.toolCallId,
        deliveries: launch ? [toDelivery(launch)] : [],
        failed: tc.success === false && !tc.agentId,
      });
      continue;
    }

    if (tc.toolName === "write_agent") {
      const content = toolArgString(args, "message");
      const target = writeAgentTarget(args);
      const result = parseWriteAgentResult(tc.resultContent);
      let toKeys =
        target.kind === "agents"
          ? resolveKeys(directory, target.agentIds)
          : resolveKeys(directory, result?.deliveries.map((d) => d.agentId) ?? []);
      if (!toKeys.length && target.kind === "scope") {
        toKeys = scopeRecipients(directory, fromKey, target.scope).map((e) => e.key);
      }
      const deliveries: AgentCommDelivery[] = [];
      const sent = content.trim();
      for (;;) {
        const match = takeDelivery(
          (m) =>
            !m.isLaunch &&
            m.content.trim() === sent &&
            messageSenderKey(directory, m) === fromKey &&
            (toKeys.length === 0 || toKeys.includes(m.recipientToolCallId)) &&
            !deliveries.some((d) => d.toKey === m.recipientToolCallId) &&
            (m.eventIndex == null || tc.eventIndex == null || m.eventIndex > tc.eventIndex),
        );
        if (!match) break;
        deliveries.push(toDelivery(match));
        if (toKeys.length && deliveries.length >= toKeys.length) break;
      }
      for (const d of deliveries) if (!toKeys.includes(d.toKey)) toKeys.push(d.toKey);
      log.push({
        id: `message:${tc.toolCallId ?? order}`,
        kind: "message",
        fromKey,
        toKeys,
        relation: classify(directory, fromKey, toKeys),
        scope: target.kind === "scope" ? target.scope : undefined,
        content,
        at: tc.startedAt,
        order,
        toolCallId: tc.toolCallId,
        deliveries,
        failed:
          tc.success === false ||
          (!!result?.deliveries.length && !result.deliveries.some((d) => d.delivered)),
      });
      continue;
    }

    if (tc.toolName === "read_agent") {
      const read = parseReadAgentResult(tc.resultContent);
      const worker = directory.resolve(
        read?.agentId ?? (toolArgString(args, "agent_id") || toolArgString(args, "agent_name")),
      );
      if (!worker || worker.key === fromKey) continue;
      const lastTurn = read?.turns[read.turns.length - 1];
      const returned =
        tc.success !== false && !!read && read.status !== "running" && read.status !== "pending";
      log.push({
        id: `read:${tc.toolCallId ?? order}`,
        kind: "read",
        fromKey: worker.key,
        toKeys: [fromKey],
        relation: classify(directory, worker.key, [fromKey]),
        content: lastTurn?.response || read?.body || "",
        at: tc.completedAt ?? tc.startedAt,
        order,
        toolCallId: tc.toolCallId,
        deliveries: [{ toKey: fromKey, deliveredAt: tc.completedAt }],
        failed: tc.success === false,
        returned,
        readStatus: read?.status,
      });
    }
  }

  // Deliveries whose send was not recorded (e.g. a truncated sender log).
  for (const m of unmatched) {
    if (!directory.get(m.recipientToolCallId)) continue;
    const fromKey = messageSenderKey(directory, m);
    log.push({
      id: `delivery:${m.messageId ?? m.eventIndex ?? log.length}`,
      kind: m.isLaunch ? "launch" : "message",
      fromKey,
      toKeys: [m.recipientToolCallId],
      relation: classify(directory, fromKey, [m.recipientToolCallId]),
      content: m.content,
      at: m.timestamp,
      order: orderOf(m.eventIndex, fallback++),
      deliveries: [toDelivery(m)],
      failed: false,
    });
  }

  return log.sort((a, b) => a.order - b.order);
}

export interface AgentCommStats {
  /** `write_agent` messages, including broadcasts. */
  messages: number;
  /** Messages exchanged between agents in different branches. */
  peerMessages: number;
  broadcasts: number;
  /** Messages that waited for a busy recipient. */
  queued: number;
  failed: number;
  /** Reads that returned output. */
  reads: number;
  /** Reads that returned while the worker was still running. */
  polls: number;
  /** Distinct agents that sent or received a message. */
  participants: number;
}

export function summarizeAgentCommunications(log: readonly AgentCommunication[]): AgentCommStats {
  const participants = new Set<string>();
  const stats: AgentCommStats = {
    messages: 0,
    peerMessages: 0,
    broadcasts: 0,
    queued: 0,
    failed: 0,
    reads: 0,
    polls: 0,
    participants: 0,
  };
  for (const c of log) {
    if (c.kind === "read") {
      if (c.returned) stats.reads++;
      else if (!c.failed) stats.polls++;
      continue;
    }
    if (c.kind !== "message") continue;
    stats.messages++;
    if (c.relation === "peer") stats.peerMessages++;
    if (c.scope || c.toKeys.length > 1) stats.broadcasts++;
    if (c.failed) stats.failed++;
    stats.queued += c.deliveries.filter((d) => d.delivery === "queued").length;
    participants.add(c.fromKey);
    for (const to of c.toKeys) participants.add(to);
  }
  stats.participants = participants.size;
  return stats;
}

/** Exchanges an agent sent or received, for per-agent views. */
export function communicationsFor(
  log: readonly AgentCommunication[],
  key: string,
): { inbound: AgentCommunication[]; outbound: AgentCommunication[] } {
  return {
    inbound: log.filter((c) => c.toKeys.includes(key)),
    outbound: log.filter((c) => c.fromKey === key),
  };
}
