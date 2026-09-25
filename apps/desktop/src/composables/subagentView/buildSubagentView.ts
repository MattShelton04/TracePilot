// Shared core for SubagentView assembly. Both adapters (cross-turn slide-out
// and agent-tree inline) normalize their input into this shape so the field
// derivation (status, model substitution, activities, joined output, intent
// summary) lives in exactly one place.
import { getToolArgs, type TurnToolCall, toolArgString } from "@tracepilot/types";
import type { SubagentActivityInput, SubagentType, SubagentView } from "@tracepilot/ui";
import { buildSubagentActivities, hasFollowUpMessages } from "@tracepilot/ui";

export interface SubagentViewInput {
  id: string;
  type: SubagentType;
  displayName: string;
  description?: string;
  /** Parent tool call (absent only for the synthetic main-agent root in unified mode). */
  toolCall?: TurnToolCall;
  /** Final assistant messages (full content) joined into the Output section. */
  messages: { content: string; eventIndex?: number }[];
  /** Reasoning blocks attributable to this subagent, with eventIndex preserved. */
  reasoning: { content: string; agentDisplayName?: string; eventIndex?: number }[];
  /** Direct child tool calls (for the activity stream). */
  childTools: TurnToolCall[];
  /** Messages exchanged with other agents (see `communicationsFor`). */
  communications?: SubagentActivityInput["communications"];

  // Status / metadata fields that hosts may compute from richer sources.
  status: SubagentView["status"];
  model?: string;
  requestedModel?: string;
  durationMs?: number;
  totalTokens?: number;
  totalToolCalls?: number;
  turnIndex?: number;
  sourceTurnIndex?: number;
  isCrossTurnParent?: boolean;
  parallelGroupLabel?: string;
  isMainAgent?: boolean;
}

export function buildSubagentView(input: SubagentViewInput): SubagentView {
  const tc = input.toolCall;
  const args = tc ? getToolArgs(tc) : undefined;

  const intentSummary = tc
    ? tc.intentionSummary ||
      (args ? toolArgString(args, "description") || toolArgString(args, "name") : "") ||
      undefined
    : undefined;
  const prompt = tc && args ? toolArgString(args, "prompt") || undefined : undefined;
  const model = input.model || (tc && args ? toolArgString(args, "model") || undefined : undefined);

  const modelSubstituted =
    input.status !== "in-progress" &&
    !!model &&
    !!input.requestedModel &&
    model !== input.requestedModel;

  const activities = buildSubagentActivities({
    parentId: input.id,
    childTools: input.childTools,
    childReasoning: input.reasoning,
    communications: input.communications,
    childMessages: input.messages,
  });

  // A multi-turn agent streams each reply after the message that prompted it,
  // so Output holds only its latest reply rather than every turn joined.
  const multiTurn = hasFollowUpMessages(input.communications);
  const replies = input.messages.map((m) => m.content).filter((c) => c && c.trim().length > 0);
  const joined = multiTurn ? replies[replies.length - 1] : replies.join("\n\n");
  const output = joined || tc?.resultContent || undefined;

  return {
    id: input.id,
    type: input.type,
    displayName: input.displayName,
    description: input.description,
    intentSummary,
    status: input.status,
    model,
    requestedModel: input.requestedModel,
    modelSubstituted,
    durationMs: input.durationMs ?? tc?.durationMs ?? undefined,
    startedAt: tc?.startedAt ?? undefined,
    completedAt: tc?.completedAt ?? undefined,
    totalTokens: input.totalTokens ?? tc?.totalTokens ?? undefined,
    totalToolCalls: input.totalToolCalls ?? tc?.totalToolCalls ?? undefined,
    turnIndex: input.turnIndex,
    sourceTurnIndex: input.sourceTurnIndex,
    isCrossTurnParent: input.isCrossTurnParent ?? false,
    parallelGroupLabel: input.parallelGroupLabel,
    prompt,
    output,
    outputLabel: multiTurn ? "Latest response" : undefined,
    error: tc?.error || undefined,
    activities,
    toolCallRef: tc,
    isMainAgent: input.isMainAgent ?? false,
  };
}
