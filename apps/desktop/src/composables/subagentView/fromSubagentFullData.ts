// Adapter: SubagentFullData (cross-turn explore data) → SubagentView.
import { getToolArgs, toolArgString } from "@tracepilot/types";
import type { SubagentView } from "@tracepilot/ui";
import { buildSubagentActivities, inferAgentTypeFromToolCall } from "@tracepilot/ui";
import type { SubagentFullData } from "@/composables/useCrossTurnSubagents";

export function fromSubagentFullData(sa: SubagentFullData): SubagentView {
  const tc = sa.toolCall;
  const args = getToolArgs(tc);
  const type = inferAgentTypeFromToolCall(tc);

  const status: SubagentView["status"] =
    tc.success === false ? "failed" : tc.isComplete ? "completed" : "in-progress";

  const model = tc.model || toolArgString(args, "model") || undefined;
  const requestedModel = tc.requestedModel || undefined;
  const modelSubstituted =
    !!tc.isComplete && !!model && !!requestedModel && model !== requestedModel;

  const id = tc.toolCallId ?? sa.agentId;

  const childReasoning = sa.childReasoning.map((r) => ({
    content: r.content,
    agentDisplayName: r.agentDisplayName,
    eventIndex: r.eventIndex,
  }));

  const activities = buildSubagentActivities({
    parentId: id,
    childTools: sa.childTools,
    childReasoning,
  });

  return {
    id,
    type,
    displayName: tc.agentDisplayName || tc.toolName || "Subagent",
    description: tc.agentDescription || undefined,
    intentSummary:
      tc.intentionSummary ||
      toolArgString(args, "description") ||
      toolArgString(args, "name") ||
      undefined,
    status,
    model,
    requestedModel,
    modelSubstituted,
    durationMs: tc.durationMs ?? undefined,
    startedAt: tc.startedAt ?? undefined,
    completedAt: tc.completedAt ?? undefined,
    totalTokens: tc.totalTokens ?? undefined,
    totalToolCalls: tc.totalToolCalls ?? undefined,
    toolCount: sa.childTools.length,
    turnIndex: sa.turnIndex,
    sourceTurnIndex: undefined,
    isCrossTurnParent: false,
    parallelGroupLabel: undefined,
    prompt: toolArgString(args, "prompt") || undefined,
    resultContent: tc.resultContent || undefined,
    error: tc.error || undefined,
    messages: sa.childMessages.map((m) => m.content),
    reasoning: sa.childReasoning.map((r) => r.content),
    childTools: sa.childTools,
    activities,
    toolCallRef: tc,
    isMainAgent: false,
  };
}
