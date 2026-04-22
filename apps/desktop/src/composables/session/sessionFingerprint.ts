/**
 * Pure fingerprint helpers for session detail change-detection.
 *
 * These functions produce deterministic string/number fingerprints that are
 * used to decide whether a turn (or the on-disk events.jsonl file) has
 * meaningfully changed between refreshes. Extracted from useSessionDetail so
 * they can be unit-tested in isolation.
 */
import type { AttributedMessage, ConversationTurn, TurnToolCall } from "@tracepilot/types";

/** FNV-1a-ish 32-bit text hash (unsigned). */
export function hashText(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return hash >>> 0;
}

export type EventsFingerprint = { size: number; mtime: number | null };

export function buildEventsFingerprint(size: number, mtime?: number | null): EventsFingerprint {
  return { size, mtime: mtime ?? null };
}

export function isSameEventsFingerprint(a: EventsFingerprint, b: EventsFingerprint): boolean {
  return a.size === b.size && a.mtime === b.mtime;
}

export function messageFingerprint(msg: AttributedMessage): string {
  return [
    msg.parentToolCallId ?? "",
    msg.agentDisplayName ?? "",
    msg.content.length,
    hashText(msg.content),
  ].join("|");
}

export function toolCallFingerprint(tc: TurnToolCall): string {
  return [
    tc.toolCallId ?? "",
    tc.parentToolCallId ?? "",
    tc.toolName,
    tc.eventIndex ?? "",
    tc.isSubagent ? "1" : "0",
    tc.isComplete ? "1" : "0",
    tc.success == null ? "u" : tc.success ? "1" : "0",
    tc.startedAt ?? "",
    tc.completedAt ?? "",
    tc.durationMs ?? "",
    tc.error ?? "",
    tc.model ?? "",
    tc.argsSummary ?? "",
    tc.resultContent?.length ?? 0,
    tc.resultContent ? hashText(tc.resultContent) : "",
    tc.agentDisplayName ?? "",
  ].join("|");
}

export function turnFingerprint(turn: ConversationTurn): string {
  const reasoning = turn.reasoningTexts ?? [];
  const sessionEvents = turn.sessionEvents ?? [];
  return [
    turn.turnIndex,
    turn.eventIndex ?? "",
    turn.turnId ?? "",
    turn.interactionId ?? "",
    turn.model ?? "",
    turn.timestamp ?? "",
    turn.endTimestamp ?? "",
    turn.isComplete ? "1" : "0",
    turn.durationMs ?? "",
    turn.outputTokens ?? "",
    turn.userMessage?.length ?? 0,
    turn.assistantMessages.length,
    turn.assistantMessages.map(messageFingerprint).join(","),
    reasoning.length,
    reasoning.map(messageFingerprint).join(","),
    sessionEvents.length,
    sessionEvents
      .map(
        (evt) =>
          `${evt.eventType}:${evt.severity}:${evt.summary.length}:${hashText(evt.summary)}:${evt.timestamp ?? ""}`,
      )
      .join(","),
    turn.toolCalls.length,
    turn.toolCalls.map(toolCallFingerprint).join(","),
  ].join("||");
}

/**
 * Determine which turn indexes deserve a deep fingerprint comparison on the
 * next merge: always the last turn, plus any turn containing an in-flight
 * subagent tool call.
 */
export function computeDeepCompareIndexes(turnList: ConversationTurn[]): Set<number> {
  const indexes = new Set<number>();
  if (turnList.length > 0) {
    indexes.add(turnList.length - 1);
  }
  for (let i = 0; i < turnList.length; i++) {
    if (turnList[i]?.toolCalls.some((tc) => tc.isSubagent && !tc.isComplete)) {
      indexes.add(i);
    }
  }
  return indexes;
}
