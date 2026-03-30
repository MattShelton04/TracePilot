/**
 * replayTransform — converts ConversationTurn[] into ReplayStep[] for replay.
 *
 * Each ConversationTurn becomes exactly one ReplayStep.
 * Model switches are detected and annotated inline (not as separate steps).
 */
import type { ConversationTurn, ReplayStep, TurnToolCall } from "@tracepilot/types";

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

      // Legacy simplified tool calls
      toolCalls: turn.toolCalls.map((tc) => ({
        name: tc.toolName,
        success: tc.success ?? true,
        durationMs: tc.durationMs ?? 0,
        command: extractToolCommand(tc),
        output: tc.resultContent ?? undefined,
      })),
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
    const args = intentCall.arguments as Record<string, unknown> | undefined;
    if (args?.intent && typeof args.intent === "string") {
      return args.intent;
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
    const args = tc.arguments as Record<string, unknown>;

    if (typeof args.path === "string" && args.path) {
      files.add(normalizePath(args.path));
    }
    if (typeof args.file === "string" && args.file) {
      files.add(normalizePath(args.file));
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

/** Extract a short command/summary string from tool call arguments. */
function extractToolCommand(tc: TurnToolCall): string | undefined {
  if (!tc.arguments || typeof tc.arguments !== "object") return undefined;
  const args = tc.arguments as Record<string, unknown>;

  switch (tc.toolName) {
    case "powershell":
    case "read_powershell":
    case "write_powershell":
      return typeof args.command === "string" ? args.command : undefined;
    case "edit":
    case "view":
    case "create":
      return typeof args.path === "string" ? `${tc.toolName} ${args.path}` : undefined;
    case "grep":
      return typeof args.pattern === "string" ? `grep "${args.pattern}"` : undefined;
    case "glob":
      return typeof args.pattern === "string" ? `glob "${args.pattern}"` : undefined;
    case "sql":
      return typeof args.query === "string"
        ? args.query.length > 80
          ? `${args.query.slice(0, 77)}…`
          : args.query
        : undefined;
    default:
      return tc.intentionSummary ?? undefined;
  }
}
