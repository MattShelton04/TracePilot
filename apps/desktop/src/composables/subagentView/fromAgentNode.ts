// Adapter: AgentNode (agent-tree builder output) → SubagentView.
import { getToolArgs, toolArgString } from "@tracepilot/types";
import type { SubagentView } from "@tracepilot/ui";
import { buildSubagentActivities } from "@tracepilot/ui";
import type { AgentNode } from "@/utils/agentTreeBuilder";

export function fromAgentNode(
  node: AgentNode,
  opts?: { parallelGroupLabel?: string },
): SubagentView {
  const tc = node.toolCallRef;
  const args = tc ? getToolArgs(tc) : ({} as ReturnType<typeof getToolArgs>);
  const isMain = node.type === "main";

  const intentSummary = tc
    ? tc.intentionSummary ||
      toolArgString(args, "description") ||
      toolArgString(args, "name") ||
      undefined
    : undefined;

  const prompt = tc ? toolArgString(args, "prompt") || undefined : undefined;
  const model = node.model || (tc ? toolArgString(args, "model") || undefined : undefined);
  const requestedModel = node.requestedModel;
  const modelSubstituted =
    node.status !== "in-progress" && !!model && !!requestedModel && model !== requestedModel;

  // Re-build activities for stream-mode use even though agent-tree primarily uses sections mode.
  // Reasoning entries carry eventIndex (preserved from AttributedMessage), so the
  // activity builder can sort chronologically across reasoning + tool calls.
  const childReasoning = node.reasoning.map((r) => ({
    content: r.content,
    agentDisplayName: r.agentDisplayName,
    eventIndex: r.eventIndex,
  }));
  const activities = buildSubagentActivities({
    parentId: node.id,
    childTools: node.toolCalls,
    childReasoning,
  });

  return {
    id: node.id,
    type: node.type,
    displayName: node.displayName,
    description: node.description,
    intentSummary,
    status: node.status,
    model,
    requestedModel,
    modelSubstituted,
    durationMs: node.durationMs,
    startedAt: tc?.startedAt ?? undefined,
    completedAt: tc?.completedAt ?? undefined,
    totalTokens: node.totalTokens,
    totalToolCalls: node.totalToolCalls,
    toolCount: node.toolCount,
    turnIndex: undefined,
    sourceTurnIndex: node.sourceTurnIndex,
    isCrossTurnParent: node.isCrossTurnParent,
    parallelGroupLabel: opts?.parallelGroupLabel,
    prompt,
    resultContent: tc?.resultContent || undefined,
    error: tc?.error || undefined,
    messages: node.messages.map((m) => m.content),
    reasoning: node.reasoning.map((r) => r.content),
    childTools: node.toolCalls,
    activities,
    toolCallRef: tc,
    isMainAgent: isMain,
  };
}
