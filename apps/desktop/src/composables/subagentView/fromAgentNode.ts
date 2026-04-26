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

  const joined = node.messages
    .map((m) => m.content)
    .filter((c) => c && c.trim().length > 0)
    .join("\n\n");
  const output = joined || tc?.resultContent || undefined;

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
    turnIndex: undefined,
    sourceTurnIndex: node.sourceTurnIndex,
    isCrossTurnParent: node.isCrossTurnParent,
    parallelGroupLabel: opts?.parallelGroupLabel,
    prompt,
    output,
    error: tc?.error || undefined,
    activities,
    toolCallRef: tc,
    isMainAgent: isMain,
  };
}
