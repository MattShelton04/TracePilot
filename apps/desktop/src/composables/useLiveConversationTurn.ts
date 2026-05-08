import type { ConversationTurn, SessionLiveState } from "@tracepilot/types";
import { type ComputedRef, computed, watch } from "vue";
import type { SdkLiveTurn } from "@/stores/sdk/liveTurns";
import { normalizeToolPartialOutput } from "@/utils/normalizeToolPartialOutput";

export interface UseLiveConversationTurnOptions {
  /** Active session id (null/undefined when no session is loaded). */
  sessionId: () => string | null | undefined;
  /** Persisted (session.jsonl-backed) turns from the session detail store. */
  persistedTurns: () => ConversationTurn[];
  /** SDK live-turn accumulator map keyed by sessionId. */
  liveTurnsBySessionId: () => Record<string, SdkLiveTurn>;
  /** SDK per-session live state (used to surface streaming tool output). */
  sessionStatesById: () => Record<string, SessionLiveState>;
  /** Releases the SDK live-turn entry once the dedupe step has hidden it. */
  clearLiveTurn: (sessionId: string) => void;
}

export interface UseLiveConversationTurnResult {
  /** Synthetic in-flight turn appended to the feed, or null when superseded. */
  liveConversationTurn: ComputedRef<ConversationTurn | null>;
  /** Persisted turns + the optional live turn (read-only). */
  turns: ComputedRef<ConversationTurn[]>;
  /** Map keyed by `toolCallId` of in-flight tool partial output text. */
  liveToolPartialOutputs: ComputedRef<Map<string, string>>;
  /** Stops the internal cleanup watcher (effect-scope safe). */
  dispose: () => void;
}

/**
 * Owns the live-turn merge / dedupe logic for the conversation feed.
 * Pure logic — no DOM access, no Pinia/store imports — so it can be
 * exercised with `effectScope` in tests.
 */
export function useLiveConversationTurn(
  opts: UseLiveConversationTurnOptions,
): UseLiveConversationTurnResult {
  const liveConversationTurn = computed<ConversationTurn | null>(() => {
    const sessionId = opts.sessionId();
    if (!sessionId) return null;
    const live = opts.liveTurnsBySessionId()[sessionId];
    if (!live) return null;
    const liveText = live.assistantText.trim();
    const liveReasoning = live.reasoningText.trim();
    if (!liveText && !liveReasoning) return null;

    // Hide the placeholder once the streamed text is already in the most
    // recent persisted turn. Content-based check is the simplest robust
    // dedup: we don't depend on bridge ids matching session.jsonl turn ids,
    // and it's evaluated synchronously inside the computed so there's no
    // post-render race when auto-refresh and streaming overlap.
    const persisted = opts.persistedTurns();
    const last = persisted[persisted.length - 1];
    const persistedAssistant = (last?.assistantMessages ?? [])
      .map((m) => m.content)
      .join("")
      .trim();
    const persistedReasoning = (last?.reasoningTexts ?? [])
      .map((r) => r.content)
      .join("")
      .trim();
    const assistantSuperseded = liveText ? persistedAssistant.startsWith(liveText) : true;
    const reasoningSuperseded = liveReasoning ? persistedReasoning.startsWith(liveReasoning) : true;
    if (assistantSuperseded && reasoningSuperseded) return null;

    return {
      turnIndex: (last?.turnIndex ?? 0) + 1,
      turnId: live.turnId ?? undefined,
      assistantMessages: liveText ? [{ content: live.assistantText }] : [],
      reasoningTexts: liveReasoning ? [{ content: live.reasoningText }] : [],
      toolCalls: [],
      timestamp: live.updatedAt,
      isComplete: false,
    };
  });

  const turns = computed<ConversationTurn[]>(() => {
    const liveTurn = liveConversationTurn.value;
    const persisted = opts.persistedTurns();
    return liveTurn ? [...persisted, liveTurn] : persisted;
  });

  // Free the live entry from the store once it's been hidden by the dedup
  // above (post-render, just to release memory and reset for next turn).
  const stopWatch = watch(
    () =>
      liveConversationTurn.value === null && !!opts.liveTurnsBySessionId()[opts.sessionId() ?? ""],
    (shouldClear) => {
      const sessionId = opts.sessionId();
      if (sessionId && shouldClear) opts.clearLiveTurn(sessionId);
    },
  );

  // Live partial output (streaming stdout from in-flight tool calls), keyed
  // by toolCallId. Sourced from the SDK live-state reducer's per-session
  // `ToolProgressSummary[]`.
  const liveToolPartialOutputs = computed<Map<string, string>>(() => {
    const sessionId = opts.sessionId();
    const map = new Map<string, string>();
    if (!sessionId) return map;
    const state = opts.sessionStatesById()[sessionId];
    if (!state) return map;
    for (const tool of state.tools ?? []) {
      if (!tool.toolCallId || tool.partialResult == null) continue;
      const text = normalizeToolPartialOutput(tool.partialResult);
      if (text.length > 0) map.set(tool.toolCallId, text);
    }
    return map;
  });

  return {
    liveConversationTurn,
    turns,
    liveToolPartialOutputs,
    dispose: stopWatch,
  };
}
