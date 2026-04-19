/**
 * useLiveSdkSession — reactive live state derived from the SDK event stream.
 *
 * Watches `sdk.sessionEvents(sessionId)` and accumulates all in-flight
 * state for a single session: streaming message deltas, active tool
 * executions, compaction status, token usage, model changes, and more.
 *
 * Designed to be called once per linked session (e.g. in ChatViewMode
 * or SdkSteeringPanel) and shared via provide/inject where multiple
 * children need the same reactive state.
 *
 * Dedup strategy: WeakSet keyed on the event object itself — same
 * pattern as useAlertWatcher, avoids hashing large event data.
 */

import type { BridgeEvent } from "@tracepilot/types";
import { computed, inject, reactive, ref, watch, type InjectionKey, type Ref } from "vue";
import { useSdkStore } from "@/stores/sdk";

// ─── Data shapes ────────────────────────────────────────────────────

export interface StreamingMessage {
  content: string;
  turnId: string | null;
  parentToolCallId: string | null;
}

export interface StreamingReasoning {
  content: string;
  turnId: string | null;
}

export interface ActiveTool {
  toolCallId: string;
  toolName: string;
  arguments: unknown;
  progressMessage: string | null;
  partialOutput: string;
  startedAt: number;
  parentToolCallId: string | null;
  mcpServerName: string | null;
  mcpToolName: string | null;
}

export interface CompactionState {
  status: "idle" | "compacting";
  preTokens: number | null;
  postTokens: number | null;
  checkpointNumber: number | null;
  summaryContent: string | null;
  lastCompletedAt: number | null;
}

export interface TokenUsage {
  currentTokens: number;
  tokenLimit: number;
  messagesLength: number;
  /** currentTokens / tokenLimit, 0–1 */
  ratio: number;
}

export interface TurnStats {
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  cost: number | null;
  durationMs: number | null;
}

export interface TruncationInfo {
  tokensRemoved: number;
  preTruncationTokens: number;
  postTruncationTokens: number;
  performedBy: string;
  occurredAt: number;
}

export interface HandoffInfo {
  sourceType: "remote" | "local";
  repository: { owner: string; name: string; branch?: string } | null;
  summary: string | null;
  remoteSessionId: string | null;
}

// ─── Composable ─────────────────────────────────────────────────────

export function useLiveSdkSession(sessionIdRef: Ref<string | null>) {
  const sdk = useSdkStore();

  // ── Streaming state ──────────────────────────────────────────
  /** In-flight assistant message deltas, keyed by messageId. */
  const streamingMessages = reactive(new Map<string, StreamingMessage>());
  /** In-flight reasoning deltas, keyed by reasoningId. */
  const streamingReasoning = reactive(new Map<string, StreamingReasoning>());
  /** Currently executing tools, keyed by toolCallId. */
  const activeTools = reactive(new Map<string, ActiveTool>());

  // ── Turn lifecycle ───────────────────────────────────────────
  const isAgentRunning = ref(false);
  const activeTurnId = ref<string | null>(null);

  // ── Abort ────────────────────────────────────────────────────
  const abortReason = ref<string | null>(null);

  // ── Model ────────────────────────────────────────────────────
  const liveModel = ref<string | null>(null);

  // ── Compaction ───────────────────────────────────────────────
  const compaction = reactive<CompactionState>({
    status: "idle",
    preTokens: null,
    postTokens: null,
    checkpointNumber: null,
    summaryContent: null,
    lastCompletedAt: null,
  });

  // ── Token budget ─────────────────────────────────────────────
  const tokenUsage = ref<TokenUsage | null>(null);

  // ── Per-turn stats ───────────────────────────────────────────
  const lastTurnStats = ref<TurnStats | null>(null);

  // ── Truncation ───────────────────────────────────────────────
  const lastTruncation = ref<TruncationInfo | null>(null);

  // ── Handoff ──────────────────────────────────────────────────
  const pendingHandoff = ref<HandoffInfo | null>(null);

  // ── Snapshot rewind ──────────────────────────────────────────
  const lastSnapshotRewind = ref<{ eventsRemoved: number } | null>(null);

  // ── Dedup ────────────────────────────────────────────────────
  const seen = new WeakSet<object>();

  // ── Derived helpers ──────────────────────────────────────────

  /** True when there is any streaming content or active tools. */
  const hasLiveActivity = computed(
    () => streamingMessages.size > 0 || streamingReasoning.size > 0 || activeTools.size > 0 || isAgentRunning.value,
  );

  // ── Event processor ──────────────────────────────────────────

  function processEvent(event: BridgeEvent) {
    if (seen.has(event as object)) return;
    seen.add(event as object);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = event.data as any;

    // ── Ephemeral (streaming fragments) ──────────────────────
    if (event.ephemeral) {
      switch (event.eventType) {
        case "assistant.message_delta": {
          const existing = streamingMessages.get(d.messageId);
          streamingMessages.set(d.messageId, {
            content: (existing?.content ?? "") + (d.deltaContent ?? ""),
            turnId: activeTurnId.value,
            parentToolCallId: d.parentToolCallId ?? null,
          });
          break;
        }
        case "assistant.reasoning_delta": {
          const existing = streamingReasoning.get(d.reasoningId);
          streamingReasoning.set(d.reasoningId, {
            content: (existing?.content ?? "") + (d.deltaContent ?? ""),
            turnId: activeTurnId.value,
          });
          break;
        }
        case "tool.execution_progress": {
          const tool = activeTools.get(d.toolCallId);
          if (tool) {
            activeTools.set(d.toolCallId, { ...tool, progressMessage: d.progressMessage ?? null });
          }
          break;
        }
        case "tool.execution_partial_result": {
          const tool = activeTools.get(d.toolCallId);
          if (tool) {
            activeTools.set(d.toolCallId, {
              ...tool,
              partialOutput: tool.partialOutput + (d.partialOutput ?? ""),
            });
          }
          break;
        }
      }
      return;
    }

    // ── Non-ephemeral (terminal / structural events) ─────────
    switch (event.eventType) {
      case "assistant.turn_start":
        isAgentRunning.value = true;
        activeTurnId.value = d.turnId ?? null;
        abortReason.value = null;
        break;

      case "assistant.message":
        // Terminal message: replace streamed accumulation with canonical content.
        streamingMessages.delete(d.messageId);
        break;

      case "assistant.reasoning":
        // Terminal reasoning: replace with canonical content.
        streamingReasoning.delete(d.reasoningId);
        break;

      case "assistant.turn_end":
        // Turn complete — clear all streaming state for this turn.
        streamingMessages.clear();
        streamingReasoning.clear();
        activeTurnId.value = null;
        break;

      case "assistant.usage":
        lastTurnStats.value = {
          model: d.model ?? null,
          inputTokens: d.inputTokens ?? null,
          outputTokens: d.outputTokens ?? null,
          cacheReadTokens: d.cacheReadTokens ?? null,
          cacheWriteTokens: d.cacheWriteTokens ?? null,
          cost: d.cost ?? null,
          durationMs: d.duration != null ? Math.round(d.duration) : null,
        };
        break;

      case "session.idle":
        isAgentRunning.value = false;
        activeTurnId.value = null;
        // Flush any remaining streaming state (turn_end should have cleared it,
        // but guard in case events arrive out of order).
        streamingMessages.clear();
        streamingReasoning.clear();
        activeTools.clear();
        break;

      case "session.error":
        isAgentRunning.value = false;
        streamingMessages.clear();
        streamingReasoning.clear();
        activeTools.clear();
        break;

      case "abort":
        abortReason.value = d.reason ?? "Aborted";
        isAgentRunning.value = false;
        streamingMessages.clear();
        streamingReasoning.clear();
        activeTools.clear();
        break;

      case "session.model_change":
        liveModel.value = d.newModel ?? null;
        break;

      case "session.compaction_start":
        compaction.status = "compacting";
        compaction.preTokens = null;
        compaction.postTokens = null;
        compaction.checkpointNumber = null;
        compaction.summaryContent = null;
        break;

      case "session.compaction_complete":
        compaction.status = "idle";
        compaction.preTokens = d.preCompactionTokens ?? null;
        compaction.postTokens = d.postCompactionTokens ?? null;
        compaction.checkpointNumber = d.checkpointNumber ?? null;
        compaction.summaryContent = d.summaryContent ?? null;
        compaction.lastCompletedAt = Date.now();
        break;

      case "session.usage_info":
        if (d.tokenLimit && d.currentTokens != null) {
          tokenUsage.value = {
            currentTokens: d.currentTokens,
            tokenLimit: d.tokenLimit,
            messagesLength: d.messagesLength ?? 0,
            ratio: Math.min(1, d.currentTokens / d.tokenLimit),
          };
        }
        break;

      case "session.truncation":
        lastTruncation.value = {
          tokensRemoved: d.tokensRemovedDuringTruncation ?? 0,
          preTruncationTokens: d.preTruncationTokensInMessages ?? 0,
          postTruncationTokens: d.postTruncationTokensInMessages ?? 0,
          performedBy: d.performedBy ?? "unknown",
          occurredAt: Date.now(),
        };
        break;

      case "session.handoff":
        pendingHandoff.value = {
          sourceType: d.sourceType ?? "remote",
          repository: d.repository ?? null,
          summary: d.summary ?? null,
          remoteSessionId: d.remoteSessionId ?? null,
        };
        break;

      case "session.snapshot_rewind":
        lastSnapshotRewind.value = { eventsRemoved: d.eventsRemoved ?? 0 };
        break;

      case "tool.execution_start":
        activeTools.set(d.toolCallId, {
          toolCallId: d.toolCallId,
          toolName: d.toolName ?? "unknown",
          arguments: d.arguments ?? null,
          progressMessage: null,
          partialOutput: "",
          startedAt: Date.now(),
          parentToolCallId: d.parentToolCallId ?? null,
          mcpServerName: null,
          mcpToolName: null,
        });
        break;

      case "tool.execution_complete":
        activeTools.delete(d.toolCallId);
        break;
    }
  }

  // ── Watcher ──────────────────────────────────────────────────

  /** Reset all live state when navigating to a different session. */
  watch(sessionIdRef, () => {
    streamingMessages.clear();
    streamingReasoning.clear();
    activeTools.clear();
    isAgentRunning.value = false;
    activeTurnId.value = null;
    abortReason.value = null;
    liveModel.value = null;
    compaction.status = "idle";
    compaction.preTokens = null;
    compaction.postTokens = null;
    compaction.checkpointNumber = null;
    compaction.summaryContent = null;
    compaction.lastCompletedAt = null;
    tokenUsage.value = null;
    lastTurnStats.value = null;
    lastTruncation.value = null;
    pendingHandoff.value = null;
    lastSnapshotRewind.value = null;
  });

  watch(
    () => {
      const sid = sessionIdRef.value;
      return sid ? sdk.sessionEvents(sid) : ([] as BridgeEvent[]);
    },
    (events) => {
      for (const event of events) {
        processEvent(event);
      }
    },
    { deep: false },
  );

  // ─── Actions ────────────────────────────────────────────────

  function clearAbort() {
    abortReason.value = null;
  }

  function clearCompaction() {
    compaction.lastCompletedAt = null;
  }

  function clearHandoff() {
    pendingHandoff.value = null;
  }

  function clearRewind() {
    lastSnapshotRewind.value = null;
  }

  function clearTruncation() {
    lastTruncation.value = null;
  }

  return {
    // streaming
    streamingMessages,
    streamingReasoning,
    activeTools,
    // turn lifecycle
    isAgentRunning,
    activeTurnId,
    // abort
    abortReason,
    // model
    liveModel,
    // compaction
    compaction,
    // token budget
    tokenUsage,
    // per-turn stats
    lastTurnStats,
    // truncation
    lastTruncation,
    // handoff
    pendingHandoff,
    // snapshot rewind
    lastSnapshotRewind,
    // derived
    hasLiveActivity,
    // actions
    clearAbort,
    clearCompaction,
    clearHandoff,
    clearRewind,
    clearTruncation,
  };
}

export type LiveSdkSession = ReturnType<typeof useLiveSdkSession>;

export const SdkLiveSessionKey: InjectionKey<LiveSdkSession> = Symbol("SdkLiveSession");

export function useSdkLiveSessionContext(): LiveSdkSession | null {
  return inject(SdkLiveSessionKey, null);
}
