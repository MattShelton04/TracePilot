// Adapter: SubagentFullData (cross-turn explore data) → SubagentView.
// Thin shape mapper; common derivations live in buildSubagentView.
import type { SubagentView } from "@tracepilot/ui";
import { inferAgentTypeFromToolCall } from "@tracepilot/ui";
import type { SubagentFullData } from "@/composables/useCrossTurnSubagents";
import { buildSubagentView } from "./buildSubagentView";

export function fromSubagentFullData(sa: SubagentFullData): SubagentView {
  const tc = sa.toolCall;
  const status: SubagentView["status"] =
    tc.success === false ? "failed" : tc.isComplete ? "completed" : "in-progress";

  return buildSubagentView({
    id: tc.toolCallId ?? sa.agentId,
    type: inferAgentTypeFromToolCall(tc),
    displayName: tc.agentDisplayName || tc.toolName || "Subagent",
    description: tc.agentDescription || undefined,
    toolCall: tc,
    messages: sa.childMessages,
    reasoning: sa.childReasoning,
    childTools: sa.childTools,
    status,
    model: tc.model || undefined,
    requestedModel: tc.requestedModel || undefined,
    turnIndex: sa.turnIndex,
    isMainAgent: false,
  });
}
