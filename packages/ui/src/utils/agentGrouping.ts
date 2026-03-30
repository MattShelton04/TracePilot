/**
 * Agent grouping utility — groups a turn's content by owning agent.
 *
 * Takes a ConversationTurn and produces an ordered list of AgentSections,
 * each representing the content produced by a specific agent (main or subagent).
 */

import type { AttributedMessage, ConversationTurn, TurnToolCall } from "@tracepilot/types";
import {
  type AgentStatus,
  type AgentType,
  agentStatusFromToolCall,
  inferAgentType,
} from "./agentTypes";

export interface AgentSection {
  /** toolCallId of the subagent, or undefined for the main agent. */
  agentId: string | undefined;
  agentDisplayName: string;
  agentType: AgentType;
  model?: string;
  /** The subagent tool call itself (undefined for main agent section). */
  subagentToolCall?: TurnToolCall;
  /** Assistant message content strings from this agent. */
  messages: string[];
  /** Reasoning content strings from this agent. */
  reasoning: string[];
  /** Tool calls performed by this agent (children of subagent, or direct for main). */
  toolCalls: TurnToolCall[];
  status?: AgentStatus;
  durationMs?: number;
}

/**
 * Build a session-wide index of all subagent tool calls.
 *
 * This allows cross-turn attribution: when a subagent launches in turn N
 * but its child content appears in turn N+1 (after an assistant.turn_start
 * boundary), the grouping can still resolve ownership.
 */
export function buildSubagentIndex(turns: ConversationTurn[]): Map<string, TurnToolCall> {
  const map = new Map<string, TurnToolCall>();
  for (const turn of turns) {
    for (const tc of turn.toolCalls) {
      if (tc.isSubagent && tc.toolCallId) {
        map.set(tc.toolCallId, tc);
      }
    }
  }
  return map;
}

/**
 * Group a turn's content by owning agent.
 *
 * Returns an ordered array of AgentSections that preserves the chronological
 * interleaving between main and subagent content. Main-agent content that
 * appears BEFORE subagent messages is in an initial main section; content that
 * appears AFTER is in a trailing main section. Subagent sections are ordered
 * by startedAt timestamp and placed between the two main segments.
 *
 * @param turn The conversation turn to group.
 * @param globalSubagentMap Optional session-wide subagent index (from
 *   `buildSubagentIndex`). Enables cross-turn attribution when subagent
 *   launches and child content span different turns.
 */
export function groupTurnByAgent(
  turn: ConversationTurn,
  globalSubagentMap?: Map<string, TurnToolCall>,
): AgentSection[] {
  // Build per-turn subagent index
  const localSubagentMap = new Map<string, TurnToolCall>();
  for (const tc of turn.toolCalls) {
    if (tc.isSubagent && tc.toolCallId) {
      localSubagentMap.set(tc.toolCallId, tc);
    }
  }

  // Merge: local overrides global (same-turn entries are more current)
  const resolvedMap = globalSubagentMap
    ? new Map([...globalSubagentMap, ...localSubagentMap])
    : localSubagentMap;

  // Check if this turn has any subagent-related content at all.
  // This includes: local subagent launches, messages with parentToolCallId
  // pointing to a known subagent, or child tool calls with parentToolCallId.
  const hasSubagentContent =
    localSubagentMap.size > 0 ||
    turn.assistantMessages.some((m) => m.parentToolCallId && resolvedMap.has(m.parentToolCallId)) ||
    turn.toolCalls.some(
      (tc) => !tc.isSubagent && tc.parentToolCallId && resolvedMap.has(tc.parentToolCallId),
    );

  if (!hasSubagentContent) {
    return [buildMainSection(turn)];
  }

  // Split messages into pre-subagent / per-subagent / post-subagent segments
  // to preserve chronological ordering between main and subagent content.
  const mainBeforeMessages: string[] = [];
  const mainAfterMessages: string[] = [];
  const agentMessages = new Map<string, string[]>();
  let seenSubagentMessage = false;

  for (const msg of turn.assistantMessages) {
    const parentId = resolveParentId(msg, resolvedMap);
    if (parentId) {
      seenSubagentMessage = true;
      const msgs = agentMessages.get(parentId) ?? [];
      msgs.push(msg.content);
      agentMessages.set(parentId, msgs);
    } else if (seenSubagentMessage) {
      mainAfterMessages.push(msg.content);
    } else {
      mainBeforeMessages.push(msg.content);
    }
  }

  // Same split for reasoning
  const mainBeforeReasoning: string[] = [];
  const mainAfterReasoning: string[] = [];
  const agentReasoning = new Map<string, string[]>();
  let seenSubagentReasoning = false;

  for (const r of turn.reasoningTexts ?? []) {
    const parentId = resolveParentId(r, resolvedMap);
    if (parentId) {
      seenSubagentReasoning = true;
      const texts = agentReasoning.get(parentId) ?? [];
      texts.push(r.content);
      agentReasoning.set(parentId, texts);
    } else if (seenSubagentReasoning) {
      mainAfterReasoning.push(r.content);
    } else {
      mainBeforeReasoning.push(r.content);
    }
  }

  // Group child tool calls by parentToolCallId
  // Subagent launch tool calls stay in the main section
  const mainToolCalls: TurnToolCall[] = [];
  const agentToolCalls = new Map<string, TurnToolCall[]>();
  for (const tc of turn.toolCalls) {
    if (tc.isSubagent) {
      mainToolCalls.push(tc);
    } else if (tc.parentToolCallId && resolvedMap.has(tc.parentToolCallId)) {
      const calls = agentToolCalls.get(tc.parentToolCallId) ?? [];
      calls.push(tc);
      agentToolCalls.set(tc.parentToolCallId, calls);
    } else {
      mainToolCalls.push(tc);
    }
  }

  // Determine which subagents have actual content in THIS turn
  // (messages, reasoning, or child tool calls)
  const activeSubagentIds = new Set<string>();
  for (const [id, msgs] of agentMessages) {
    if (msgs.length > 0) activeSubagentIds.add(id);
  }
  for (const [id, texts] of agentReasoning) {
    if (texts.length > 0) activeSubagentIds.add(id);
  }
  for (const [id, calls] of agentToolCalls) {
    if (calls.length > 0) activeSubagentIds.add(id);
  }

  // Build sections: main-before → active subagents → main-after
  const sections: AgentSection[] = [];

  // Main agent "before" section (always present, may be empty)
  sections.push({
    agentId: undefined,
    agentDisplayName: "Copilot",
    agentType: "main",
    model: turn.model,
    messages: mainBeforeMessages,
    reasoning: mainBeforeReasoning,
    toolCalls: mainToolCalls,
  });

  // Active subagent sections, ordered by startedAt
  const activeSubagents = [...activeSubagentIds]
    .map((id) => resolvedMap.get(id))
    .filter((tc): tc is TurnToolCall => tc != null)
    .sort((a, b) => {
      const aTime = a.startedAt ? new Date(a.startedAt).getTime() : 0;
      const bTime = b.startedAt ? new Date(b.startedAt).getTime() : 0;
      return aTime - bTime;
    });

  for (const subTc of activeSubagents) {
    const id = subTc.toolCallId ?? `fallback-${Math.random()}`;
    sections.push({
      agentId: id,
      agentDisplayName: subTc.agentDisplayName ?? subTc.toolName ?? "Subagent",
      agentType: inferAgentType(subTc.agentDisplayName, subTc.toolName, subTc.arguments),
      model: subTc.model,
      subagentToolCall: subTc,
      messages: agentMessages.get(id) ?? [],
      reasoning: agentReasoning.get(id) ?? [],
      toolCalls: agentToolCalls.get(id) ?? [],
      status: agentStatusFromToolCall(subTc),
      durationMs: subTc.durationMs,
    });
  }

  // Main agent "after" section (only if there's continuation content)
  const hasAfterContent = mainAfterMessages.length > 0 || mainAfterReasoning.length > 0;
  if (hasAfterContent) {
    sections.push({
      agentId: undefined,
      agentDisplayName: "Copilot",
      agentType: "main",
      model: turn.model,
      messages: mainAfterMessages,
      reasoning: mainAfterReasoning,
      toolCalls: [],
    });
  }

  return sections;
}

/**
 * Check if a turn has any subagent content worth grouping.
 */
export function hasSubagents(turn: ConversationTurn): boolean {
  return turn.toolCalls.some((tc) => tc.isSubagent);
}

/**
 * Resolve a message's parentToolCallId to a valid subagent ID.
 * Returns undefined if the parent doesn't exist (orphan → main agent).
 */
function resolveParentId(
  msg: AttributedMessage,
  subagentMap: Map<string, TurnToolCall>,
): string | undefined {
  if (!msg.parentToolCallId) return undefined;
  // Only attribute to a known subagent; orphans fall to main
  return subagentMap.has(msg.parentToolCallId) ? msg.parentToolCallId : undefined;
}

/**
 * Build a main-agent-only section from the full turn (fast path for no subagents).
 */
function buildMainSection(turn: ConversationTurn): AgentSection {
  return {
    agentId: undefined,
    agentDisplayName: "Copilot",
    agentType: "main",
    model: turn.model,
    messages: turn.assistantMessages.map((m) => m.content),
    reasoning: (turn.reasoningTexts ?? []).map((r) => r.content),
    toolCalls: turn.toolCalls,
  };
}

// ---------------------------------------------------------------------------
// Session-wide subagent content aggregation
// ---------------------------------------------------------------------------

/** Aggregated output content for a single subagent across all turns. */
export interface SubagentContent {
  messages: string[];
  reasoning: string[];
}

/**
 * Build a session-wide index of subagent output content.
 *
 * Aggregates assistant messages and reasoning texts across ALL turns,
 * attributed to each subagent via `parentToolCallId`. This handles the
 * cross-turn case where a subagent launches in turn N but produces
 * output in turn N+1 (or later).
 *
 * @returns Map from subagent toolCallId → aggregated content.
 */
export function buildSubagentContentIndex(turns: ConversationTurn[]): Map<string, SubagentContent> {
  // Collect all known subagent tool call IDs across the session
  const subagentIds = new Set<string>();
  for (const turn of turns) {
    for (const tc of turn.toolCalls) {
      if (tc.isSubagent && tc.toolCallId) {
        subagentIds.add(tc.toolCallId);
      }
    }
  }

  const map = new Map<string, SubagentContent>();

  for (const turn of turns) {
    for (const msg of turn.assistantMessages) {
      if (msg.parentToolCallId && subagentIds.has(msg.parentToolCallId)) {
        let entry = map.get(msg.parentToolCallId);
        if (!entry) {
          entry = { messages: [], reasoning: [] };
          map.set(msg.parentToolCallId, entry);
        }
        entry.messages.push(msg.content);
      }
    }
    for (const r of turn.reasoningTexts ?? []) {
      if (r.parentToolCallId && subagentIds.has(r.parentToolCallId)) {
        let entry = map.get(r.parentToolCallId);
        if (!entry) {
          entry = { messages: [], reasoning: [] };
          map.set(r.parentToolCallId, entry);
        }
        entry.reasoning.push(r.content);
      }
    }
  }

  return map;
}
