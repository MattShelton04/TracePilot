/**
 * Pure tree-data builders for the agent tree view.
 *
 * Converts raw `ConversationTurn` + `TurnToolCall` data into the hierarchical
 * `AgentNode`/`TreeData` shape consumed by the horizontal tree layout. Extracted
 * from `AgentTreeView.vue` (Wave 37) so the (surprisingly intricate) tree
 * construction can be reasoned about and tested independently of the component.
 */

import type { AttributedMessage, ConversationTurn, TurnToolCall } from "@tracepilot/types";
import {
  agentStatusFromToolCall,
  inferAgentTypeFromToolCall,
  type SubagentContent,
} from "@tracepilot/ui";

export interface AgentNode {
  id: string;
  type: "main" | "explore" | "general-purpose" | "code-review" | "rubber-duck" | "task";
  displayName: string;
  description?: string;
  model?: string;
  requestedModel?: string;
  durationMs?: number;
  toolCount: number;
  totalTokens?: number;
  totalToolCalls?: number;
  status: "completed" | "failed" | "in-progress";
  toolCalls: TurnToolCall[];
  toolCallRef?: TurnToolCall;
  children?: AgentNode[];
  parallelGroup?: string;
  messages: AttributedMessage[];
  reasoning: AttributedMessage[];
  isCrossTurnParent?: boolean;
  sourceTurnIndex?: number;
}

export interface TreeData {
  root: AgentNode;
  children: AgentNode[];
}

export interface AgentTreeBuilderContext {
  allToolCalls: TurnToolCall[];
  subagentContentIndex: Map<string, SubagentContent>;
  subagentSourceTurn: Map<string, number>;
  allSubagentToolCalls: Map<string, TurnToolCall>;
  allSubagentIds: Set<string>;
}

export function buildAgentNode(
  tc: TurnToolCall,
  fallbackIdx: number,
  ctx: AgentTreeBuilderContext,
  isCrossTurnParent = false,
): AgentNode {
  const nodeId = tc.toolCallId ?? `subagent-${fallbackIdx}`;
  const childTools = tc.toolCallId
    ? ctx.allToolCalls.filter((t) => t.parentToolCallId === tc.toolCallId)
    : [];
  const agentType = inferAgentTypeFromToolCall(tc);
  const content = ctx.subagentContentIndex.get(nodeId);
  return {
    id: nodeId,
    type: agentType,
    displayName: tc.agentDisplayName ?? `${agentType} #${fallbackIdx + 1}`,
    description: tc.agentDescription,
    model: tc.model,
    requestedModel: tc.requestedModel,
    durationMs: tc.durationMs,
    toolCount: childTools.length,
    totalTokens: tc.totalTokens,
    totalToolCalls: tc.totalToolCalls,
    status: agentStatusFromToolCall(tc),
    toolCalls: childTools,
    toolCallRef: tc,
    children: [],
    messages: content?.messages ?? [],
    reasoning: content?.reasoning ?? [],
    isCrossTurnParent,
    sourceTurnIndex: ctx.subagentSourceTurn.get(nodeId),
  };
}

/** Build the tree for the paginated view (single turn + cross-turn parents). */
export function buildPaginatedTree(
  turn: ConversationTurn | undefined,
  ctx: AgentTreeBuilderContext,
): TreeData | null {
  if (!turn) return null;

  const subagentCalls = turn.toolCalls.filter((tc) => tc.isSubagent);
  const subagentIdSet = new Set(subagentCalls.map((tc) => tc.toolCallId).filter(Boolean));

  const nodeMap = new Map<string, AgentNode>();
  for (let idx = 0; idx < subagentCalls.length; idx++) {
    const tc = subagentCalls[idx];
    const nodeId = tc.toolCallId ?? `subagent-${idx}`;
    nodeMap.set(nodeId, buildAgentNode(tc, idx, ctx));
  }

  const crossTurnParents = new Map<string, AgentNode>();
  for (const [, node] of nodeMap) {
    const parentId = node.toolCallRef?.parentToolCallId;
    if (!parentId || subagentIdSet.has(parentId) || nodeMap.has(parentId)) continue;

    let currentParentId: string | undefined = parentId;
    const visited = new Set<string>();
    while (
      currentParentId &&
      !nodeMap.has(currentParentId) &&
      !crossTurnParents.has(currentParentId)
    ) {
      if (visited.has(currentParentId)) break;
      visited.add(currentParentId);
      const parentTc = ctx.allSubagentToolCalls.get(currentParentId);
      if (!parentTc) break;
      const parentNode = buildAgentNode(parentTc, crossTurnParents.size, ctx, true);
      crossTurnParents.set(currentParentId, parentNode);
      currentParentId = parentTc.parentToolCallId ?? undefined;
    }
  }

  for (const [id, node] of crossTurnParents) {
    nodeMap.set(id, node);
  }

  const expandedSubagentIdSet = new Set([...subagentIdSet, ...crossTurnParents.keys()]);
  const rootChildren: AgentNode[] = [];
  for (const [, node] of nodeMap) {
    const tc = node.toolCallRef;
    const parentId = tc?.parentToolCallId;
    if (parentId && expandedSubagentIdSet.has(parentId) && nodeMap.has(parentId)) {
      nodeMap.get(parentId)?.children?.push(node);
    } else {
      rootChildren.push(node);
    }
  }

  const directTools = turn.toolCalls.filter((tc) => !tc.isSubagent && !tc.parentToolCallId);
  const subagentSpawnTools = turn.toolCalls.filter((tc) => tc.isSubagent && !tc.parentToolCallId);
  const mainToolCalls = [...subagentSpawnTools, ...directTools];

  const mainStatus: "completed" | "failed" | "in-progress" = !turn.isComplete
    ? "in-progress"
    : "completed";

  const knownSubagentIds = ctx.allSubagentIds;
  const mainMessages = turn.assistantMessages.filter(
    (m) => !m.parentToolCallId || !knownSubagentIds.has(m.parentToolCallId),
  );
  const mainReasoning = (turn.reasoningTexts ?? []).filter(
    (r) => !r.parentToolCallId || !knownSubagentIds.has(r.parentToolCallId),
  );

  const root: AgentNode = {
    id: "main",
    type: "main",
    displayName: "Main Agent",
    model: turn.model,
    durationMs: turn.durationMs,
    toolCount: mainToolCalls.length,
    status: mainStatus,
    toolCalls: mainToolCalls,
    children: [],
    messages: mainMessages,
    reasoning: mainReasoning,
  };

  return { root, children: rootChildren };
}

/** Build the tree for the unified session view (all turns aggregated). */
export function buildUnifiedTree(
  allTurns: ConversationTurn[],
  ctx: AgentTreeBuilderContext,
): TreeData | null {
  if (allTurns.length === 0) return null;

  const subagentCalls = allTurns.flatMap((t) => t.toolCalls.filter((tc) => tc.isSubagent));
  const subagentIdSet = new Set(
    subagentCalls.map((tc) => tc.toolCallId).filter(Boolean) as string[],
  );

  const nodeMap = new Map<string, AgentNode>();
  for (let idx = 0; idx < subagentCalls.length; idx++) {
    const tc = subagentCalls[idx];
    const nodeId = tc.toolCallId ?? `subagent-${idx}`;
    nodeMap.set(nodeId, buildAgentNode(tc, idx, ctx));
  }

  const rootChildren: AgentNode[] = [];
  for (const [, node] of nodeMap) {
    const tc = node.toolCallRef;
    const parentId = tc?.parentToolCallId;
    if (parentId && subagentIdSet.has(parentId) && nodeMap.has(parentId)) {
      nodeMap.get(parentId)?.children?.push(node);
    } else {
      rootChildren.push(node);
    }
  }

  const directTools = allTurns.flatMap((t) =>
    t.toolCalls.filter((tc) => !tc.isSubagent && !tc.parentToolCallId),
  );
  const subagentSpawnTools = allTurns.flatMap((t) =>
    t.toolCalls.filter((tc) => tc.isSubagent && !tc.parentToolCallId),
  );
  const mainToolCalls = [...subagentSpawnTools, ...directTools];

  const knownSubagentIds = ctx.allSubagentIds;
  const mainMessages = allTurns.flatMap((t) =>
    t.assistantMessages.filter(
      (m) => !m.parentToolCallId || !knownSubagentIds.has(m.parentToolCallId),
    ),
  );
  const mainReasoning = allTurns.flatMap((t) =>
    (t.reasoningTexts ?? []).filter(
      (r) => !r.parentToolCallId || !knownSubagentIds.has(r.parentToolCallId),
    ),
  );

  const lastTurn = allTurns[allTurns.length - 1];
  const mainStatus: "completed" | "failed" | "in-progress" = !lastTurn.isComplete
    ? "in-progress"
    : "completed";

  const totalDuration = allTurns.reduce((acc, t) => acc + (t.durationMs ?? 0), 0);
  const mainModel = allTurns.find((t) => t.model)?.model;

  const root: AgentNode = {
    id: "main",
    type: "main",
    displayName: "Main Agent",
    model: mainModel,
    durationMs: totalDuration,
    toolCount: mainToolCalls.length,
    status: mainStatus,
    toolCalls: mainToolCalls,
    children: [],
    messages: mainMessages,
    reasoning: mainReasoning,
  };

  return { root, children: rootChildren };
}

/** Recursively find a node by id anywhere in the tree (incl. root). */
export function findAgentNode(tree: TreeData, id: string): AgentNode | null {
  if (tree.root.id === id) return tree.root;
  function walk(nodes: AgentNode[]): AgentNode | null {
    for (const n of nodes) {
      if (n.id === id) return n;
      if (n.children?.length) {
        const found = walk(n.children);
        if (found) return found;
      }
    }
    return null;
  }
  return walk(tree.children);
}

/** Whether any node in the tree (including root) is currently in progress. */
export function treeHasInProgress(tree: TreeData): boolean {
  if (tree.root.status === "in-progress") return true;
  function check(nodes: AgentNode[]): boolean {
    return nodes.some(
      (n) => n.status === "in-progress" || (n.children?.length && check(n.children)),
    );
  }
  return check(tree.children);
}
