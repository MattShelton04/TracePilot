// Agent directory: one lookup for every way a session log names an agent.
//
// Agent-control tools address workers by runtime ID (a UUID since 1.0.20, a
// name-style ID such as "docs-cleanup" before that), agent messages name their
// sender by runtime ID or session ID, and TracePilot keys subagents by the tool
// call that launched them. The directory resolves all of these to one entry.

import type { ConversationTurn, TurnToolCall } from "@tracepilot/types";
import { getToolArgs, toolArgString } from "@tracepilot/types";
import {
  type AgentStatus,
  type AgentType,
  agentStatusFromToolCall,
  inferAgentTypeFromToolCall,
} from "../agentTypes";

/** Directory key of the main (top-level) agent. */
export const MAIN_AGENT_KEY = "main";

export interface AgentDirectoryEntry {
  /** Launching tool-call ID, or {@link MAIN_AGENT_KEY}. */
  key: string;
  name: string;
  type: AgentType;
  status: AgentStatus;
  isMain: boolean;
  /** Runtime agent ID used by the agent-control tools. */
  agentId?: string;
  /** Key of the agent that launched this one; absent for the main agent. */
  parentKey?: string;
  /** 0 for the main agent, 1 for its workers, and so on. */
  depth: number;
  description?: string;
  model?: string;
  startedAt?: string;
  completedAt?: string;
  turnIndex?: number;
  toolCall?: TurnToolCall;
}

export interface AgentDirectory {
  main: AgentDirectoryEntry;
  /** Main agent first, then workers in launch order. */
  entries: AgentDirectoryEntry[];
  get(key: string): AgentDirectoryEntry | undefined;
  /** Resolve any identifier (runtime ID, legacy name, launch call, session ID). */
  resolve(identifier: string | undefined | null): AgentDirectoryEntry | undefined;
  /** True when `ancestorKey` launched `key`, directly or through descendants. */
  isAncestor(ancestorKey: string, key: string): boolean;
}

// 1.0.x background launches report the runtime ID in their result text.
const LAUNCH_RESULT_ID = /agent_id:\s*([^\s.,]+)/;

function launchResultAgentId(tc: TurnToolCall): string | undefined {
  return tc.resultContent ? LAUNCH_RESULT_ID.exec(tc.resultContent)?.[1] : undefined;
}

export function buildAgentDirectory(
  turns: readonly ConversationTurn[],
  options: { sessionId?: string } = {},
): AgentDirectory {
  const main: AgentDirectoryEntry = {
    key: MAIN_AGENT_KEY,
    name: "Main agent",
    type: "main",
    status: turns.length && !turns[turns.length - 1].isComplete ? "in-progress" : "completed",
    isMain: true,
    depth: 0,
  };
  const byKey = new Map<string, AgentDirectoryEntry>([[MAIN_AGENT_KEY, main]]);
  const entries: AgentDirectoryEntry[] = [main];

  for (const turn of turns) {
    for (const tc of turn.toolCalls) {
      if (!tc.isSubagent || !tc.toolCallId || byKey.has(tc.toolCallId)) continue;
      const args = getToolArgs(tc);
      const entry: AgentDirectoryEntry = {
        key: tc.toolCallId,
        // The launch name ("explore-project-structure") beats the type-level
        // display name ("Explore Agent") that every agent of a type shares.
        name: toolArgString(args, "name") || tc.agentDisplayName || tc.toolName || "Subagent",
        type: inferAgentTypeFromToolCall(tc),
        status: agentStatusFromToolCall(tc),
        isMain: false,
        agentId: tc.agentId ?? launchResultAgentId(tc),
        parentKey: tc.parentToolCallId ?? MAIN_AGENT_KEY,
        depth: 1,
        // The task's description, not the agent type's boilerplate one.
        description: toolArgString(args, "description") || tc.agentDescription || undefined,
        model: tc.model || undefined,
        startedAt: tc.startedAt,
        completedAt: tc.completedAt,
        turnIndex: turn.turnIndex,
        toolCall: tc,
      };
      byKey.set(entry.key, entry);
      entries.push(entry);
    }
  }

  // Parents can be recorded after their children; resolve depth afterwards.
  for (const entry of entries) {
    let depth = 0;
    let cursor: AgentDirectoryEntry | undefined = entry;
    const seen = new Set<string>();
    while (cursor && !cursor.isMain && !seen.has(cursor.key)) {
      seen.add(cursor.key);
      depth++;
      cursor = cursor.parentKey ? byKey.get(cursor.parentKey) : undefined;
    }
    entry.depth = depth;
    if (entry.parentKey && !byKey.has(entry.parentKey)) entry.parentKey = MAIN_AGENT_KEY;
  }

  // Strongest identifiers first; a weaker alias never overrides a stronger one.
  const aliases = new Map<string, AgentDirectoryEntry>();
  const claim = (alias: string | undefined, entry: AgentDirectoryEntry) => {
    const trimmed = alias?.trim();
    if (trimmed && !aliases.has(trimmed)) aliases.set(trimmed, entry);
  };
  for (const entry of entries) claim(entry.key, entry);
  for (const entry of entries) claim(entry.agentId, entry);
  if (options.sessionId) claim(options.sessionId, main);
  for (const entry of entries) {
    if (entry.toolCall) claim(toolArgString(getToolArgs(entry.toolCall), "name"), entry);
  }

  return {
    main,
    entries,
    get: (key) => byKey.get(key),
    resolve: (identifier) => (identifier ? aliases.get(identifier.trim()) : undefined),
    isAncestor(ancestorKey, key) {
      const seen = new Set<string>();
      let cursor = byKey.get(key)?.parentKey;
      while (cursor && !seen.has(cursor)) {
        if (cursor === ancestorKey) return true;
        seen.add(cursor);
        cursor = byKey.get(cursor)?.parentKey;
      }
      return false;
    },
  };
}
