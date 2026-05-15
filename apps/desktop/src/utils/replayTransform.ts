/**
 * replayTransform — converts ConversationTurn[] into ReplayStep[] for replay.
 *
 * Each ConversationTurn becomes exactly one ReplayStep.
 * Model switches are detected and annotated inline (not as separate steps).
 */
import type { ConversationTurn, ReplayStep, TurnToolCall } from "@tracepilot/types";
import { getToolArgs, toolArgString } from "@tracepilot/types";

/**
 * Convert an array of ConversationTurns into ReplaySteps.
 *
 * Each turn maps 1:1 to a step. The step title is derived from:
 * 1. The user message (if present)
 * 2. The first assistant message
 * 3. The intention summary of the first tool call
 * 4. A fallback like "Turn N"
 */
export function turnsToReplaySteps(turns: ConversationTurn[]): ReplayStep[] {
  const steps: ReplayStep[] = [];
  let prevModel: string | undefined;

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];

    const stepType = turn.userMessage
      ? "user"
      : turn.toolCalls.length > 0 && turn.assistantMessages.length === 0
        ? "tool"
        : "assistant";

    const title = deriveStepTitle(turn, stepType);
    const filesModified = extractFilesModified(turn.toolCalls);
    const hasSubagents = turn.toolCalls.some((tc) => tc.isSubagent);

    // Detect model switch
    let modelSwitchFrom: string | undefined;
    if (prevModel && turn.model && turn.model !== prevModel) {
      modelSwitchFrom = prevModel;
    }
    prevModel = turn.model || prevModel;

    const step: ReplayStep = {
      index: i,
      turnIndex: turn.turnIndex,
      title,
      type: stepType,
      timestamp: turn.timestamp ?? "",
      durationMs: turn.durationMs ?? 0,
      tokens: turn.outputTokens ?? 0,
      model: turn.model,

      // Rich content
      userMessage: turn.userMessage,
      assistantMessages: turn.assistantMessages,
      reasoningTexts: turn.reasoningTexts,
      richToolCalls: turn.toolCalls,
      sessionEvents: turn.sessionEvents,

      // Enrichments
      filesModified: filesModified.length > 0 ? filesModified : undefined,
      hasSubagents: hasSubagents || undefined,
      modelSwitchFrom,
    };

    steps.push(step);
  }

  return steps;
}

/** Derive a human-readable title for a replay step. */
function deriveStepTitle(turn: ConversationTurn, stepType: string): string {
  if (turn.userMessage) {
    const msg = turn.userMessage.trim();
    return msg.length > 100 ? `${msg.slice(0, 97)}…` : msg;
  }

  // Check for report_intent tool call
  const intentCall = turn.toolCalls.find((tc) => tc.toolName === "report_intent" && tc.arguments);
  if (intentCall) {
    const intent = toolArgString(getToolArgs(intentCall), "intent");
    if (intent) {
      return intent;
    }
  }

  // First assistant message
  if (turn.assistantMessages.length > 0) {
    const msg = turn.assistantMessages[0].content.trim();
    return msg.length > 100 ? `${msg.slice(0, 97)}…` : msg;
  }

  // First tool call intention
  if (turn.toolCalls.length > 0 && turn.toolCalls[0].intentionSummary) {
    return turn.toolCalls[0].intentionSummary;
  }

  // Fallback
  if (stepType === "tool" && turn.toolCalls.length > 0) {
    return `${turn.toolCalls.length} tool call${turn.toolCalls.length !== 1 ? "s" : ""}`;
  }

  return `Turn ${turn.turnIndex}`;
}

/** Extract file paths from mutating tool call arguments only. */
function extractFilesModified(toolCalls: TurnToolCall[]): string[] {
  const MUTATING_TOOLS = new Set([
    "edit",
    "create",
    "apply_patch",
    "delete",
    "move",
    "rename",
    "write",
  ]);
  const files = new Set<string>();

  for (const tc of toolCalls) {
    if (!tc.arguments || typeof tc.arguments !== "object") continue;
    if (!MUTATING_TOOLS.has(tc.toolName)) continue;
    const args = getToolArgs(tc);

    const path = toolArgString(args, "path");
    if (path) {
      files.add(normalizePath(path));
    }
    const file = toolArgString(args, "file");
    if (file) {
      files.add(normalizePath(file));
    }
  }

  return [...files];
}

/** Normalize a file path for display (strip long prefixes). */
function normalizePath(path: string): string {
  // Strip common prefixes for display
  const parts = path.replace(/\\/g, "/").split("/");
  if (parts.length > 4) {
    return `…/${parts.slice(-3).join("/")}`;
  }
  return path.replace(/\\/g, "/");
}
