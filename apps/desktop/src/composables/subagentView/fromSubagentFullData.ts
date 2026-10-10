// Adapter: SubagentFullData (cross-turn explore data) → SubagentView.
// Thin shape mapper; common derivations live in buildSubagentView.
import type { SubagentActivityInput, SubagentView } from "@tracepilot/ui";
import { agentStatusFromToolCall, inferAgentTypeFromToolCall } from "@tracepilot/ui";
import type { SubagentFullData } from "@/composables/useCrossTurnSubagents";
import { buildSubagentView } from "./buildSubagentView";

export function fromSubagentFullData(
  sa: SubagentFullData,
  communications?: SubagentActivityInput["communications"],
): SubagentView {
  const tc = sa.toolCall;
  const status = agentStatusFromToolCall(tc);

  return buildSubagentView({
    id: tc.toolCallId ?? sa.agentId,
    type: inferAgentTypeFromToolCall(tc),
    // Same name as the conversation card: the native tool (Claude Code's
    // `Agent`) when recorded, else the agent's display name.
    displayName: tc.nativeToolName || tc.agentDisplayName || tc.toolName || "Subagent",
    description: tc.agentDescription || undefined,
    toolCall: tc,
    messages: sa.childMessages,
    reasoning: sa.childReasoning,
    childTools: sa.childTools,
    communications,
    status,
    model: tc.model || undefined,
    requestedModel: tc.requestedModel || undefined,
    turnIndex: sa.turnIndex,
    isMainAgent: false,
  });
}
