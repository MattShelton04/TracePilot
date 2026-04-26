// Adapter: AgentNode (agent-tree builder output) → SubagentView.
// Thin shape mapper; common derivations live in buildSubagentView.
import type { SubagentView } from "@tracepilot/ui";
import type { AgentNode } from "@/utils/agentTreeBuilder";
import { buildSubagentView } from "./buildSubagentView";

export function fromAgentNode(
  node: AgentNode,
  opts?: { parallelGroupLabel?: string },
): SubagentView {
  return buildSubagentView({
    id: node.id,
    type: node.type,
    displayName: node.displayName,
    description: node.description,
    toolCall: node.toolCallRef,
    messages: node.messages,
    reasoning: node.reasoning,
    childTools: node.toolCalls,
    status: node.status,
    model: node.model,
    requestedModel: node.requestedModel,
    durationMs: node.durationMs,
    totalTokens: node.totalTokens,
    totalToolCalls: node.totalToolCalls,
    sourceTurnIndex: node.sourceTurnIndex,
    isCrossTurnParent: node.isCrossTurnParent,
    parallelGroupLabel: opts?.parallelGroupLabel,
    isMainAgent: node.type === "main",
  });
}
