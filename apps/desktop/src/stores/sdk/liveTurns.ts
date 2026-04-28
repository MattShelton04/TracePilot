import type { BridgeEvent } from "@tracepilot/types";
import { shallowRef } from "vue";

// Reorder window for delta events. The pinned Copilot SDK
// (`client.rs::setup_handlers`) `tokio::spawn`s a fresh task per
// `session.event` notification, so adjacent deltas can race into
// `event_tx.send` in non-source order. We hold the most recent N
// deltas in a buffer sorted by their source-side `event.timestamp`;
// once a newer delta pushes one out of the window it's committed.
// The visible `assistantText` is committed + sorted-pending, so the
// UI sees ordered text but with up to N deltas of "shifting tail".
// The final `assistant.message` event drains+snaps the tail.
const DELTA_REORDER_WINDOW = 4;

interface PendingDelta {
  delta: string;
  timestamp: string;
}

export interface SdkLiveTurn {
  sessionId: string;
  turnId: string | null;
  /** Visible text (committed prefix + pending sorted by timestamp). */
  assistantText: string;
  reasoningText: string;
  /** Internal: text that has been drained out of the reorder buffer. */
  assistantCommitted: string;
  reasoningCommitted: string;
  /** Internal: pending deltas, sorted ascending by timestamp. */
  assistantPending: PendingDelta[];
  reasoningPending: PendingDelta[];
  /** Set once `assistant.message` / `assistant.reasoning` lands; late deltas
   * arriving after the canonical text are dropped to avoid re-corrupting it. */
  assistantFinalized: boolean;
  reasoningFinalized: boolean;
  updatedAt: string;
}

function stringField(data: unknown, keys: string[]): string | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") return value;
  }
  return null;
}

function joinPending(pending: PendingDelta[]): string {
  let out = "";
  for (const p of pending) out += p.delta;
  return out;
}

/**
 * Insert `incoming` into pending in ascending-timestamp order and drain front
 * entries beyond the reorder window into `committed`. Returns updated state
 * plus the new visible text (`committed + pending`).
 */
function applyDeltaWithReorder(
  committed: string,
  pending: PendingDelta[],
  incoming: PendingDelta,
): { committed: string; pending: PendingDelta[]; visible: string } {
  let insertAt = pending.length;
  for (let i = 0; i < pending.length; i += 1) {
    if (incoming.timestamp < pending[i].timestamp) {
      insertAt = i;
      break;
    }
  }
  let nextPending: PendingDelta[] = [
    ...pending.slice(0, insertAt),
    incoming,
    ...pending.slice(insertAt),
  ];
  let nextCommitted = committed;
  while (nextPending.length > DELTA_REORDER_WINDOW) {
    nextCommitted = nextCommitted + nextPending[0].delta;
    nextPending = nextPending.slice(1);
  }
  return {
    committed: nextCommitted,
    pending: nextPending,
    visible: nextCommitted + joinPending(nextPending),
  };
}

export function createLiveTurnAccumulator() {
  const liveTurnsBySessionId = shallowRef<Record<string, SdkLiveTurn>>({});

  function emptyTurn(event: BridgeEvent, turnId: string | null): SdkLiveTurn {
    return {
      sessionId: event.sessionId,
      turnId,
      assistantText: "",
      reasoningText: "",
      assistantCommitted: "",
      reasoningCommitted: "",
      assistantPending: [],
      reasoningPending: [],
      assistantFinalized: false,
      reasoningFinalized: false,
      updatedAt: event.timestamp,
    };
  }

  function currentLiveTurn(event: BridgeEvent): SdkLiveTurn {
    return liveTurnsBySessionId.value[event.sessionId] ?? emptyTurn(event, null);
  }

  function upsertLiveTurn(turn: SdkLiveTurn) {
    liveTurnsBySessionId.value = {
      ...liveTurnsBySessionId.value,
      [turn.sessionId]: turn,
    };
  }

  function clearLiveTurn(sessionId: string) {
    if (!liveTurnsBySessionId.value[sessionId]) return;
    const next = { ...liveTurnsBySessionId.value };
    delete next[sessionId];
    liveTurnsBySessionId.value = next;
  }

  /** Drop late events whose parentId disagrees with the active turn (so a
   * straggler delta from a previous turn cannot contaminate the next one). */
  function isStaleEvent(turn: SdkLiveTurn, event: BridgeEvent): boolean {
    if (!turn.turnId) return false;
    if (!event.parentId) return false;
    return turn.turnId !== event.parentId;
  }

  function applyBridgeEvent(event: BridgeEvent) {
    if (event.eventType === "assistant.turn_start") {
      const turnId = stringField(event.data, ["turnId", "turn_id"]) ?? event.id;
      upsertLiveTurn(emptyTurn(event, turnId));
      return;
    }

    if (event.eventType === "assistant.message_delta") {
      // IMPORTANT: do NOT fall back to `content` for delta events. The SDK
      // emits a separate `assistant.message` event with the FULL content;
      // accepting `content` as a delta produces duplicated streamed text.
      const delta = stringField(event.data, [
        "deltaContent",
        "delta_content",
        "chunkContent",
        "chunk_content",
        "delta",
      ]);
      if (!delta) return;
      const turn = currentLiveTurn(event);
      if (turn.assistantFinalized) return;
      if (isStaleEvent(turn, event)) return;
      const applied = applyDeltaWithReorder(turn.assistantCommitted, turn.assistantPending, {
        delta,
        timestamp: event.timestamp,
      });
      upsertLiveTurn({
        ...turn,
        turnId: turn.turnId ?? event.parentId,
        assistantCommitted: applied.committed,
        assistantPending: applied.pending,
        assistantText: applied.visible,
        updatedAt: event.timestamp,
      });
      return;
    }

    if (event.eventType === "assistant.reasoning_delta") {
      const delta = stringField(event.data, [
        "deltaContent",
        "delta_content",
        "chunkContent",
        "chunk_content",
        "delta",
      ]);
      if (!delta) return;
      const turn = currentLiveTurn(event);
      if (turn.reasoningFinalized) return;
      if (isStaleEvent(turn, event)) return;
      const applied = applyDeltaWithReorder(turn.reasoningCommitted, turn.reasoningPending, {
        delta,
        timestamp: event.timestamp,
      });
      upsertLiveTurn({
        ...turn,
        turnId: turn.turnId ?? event.parentId,
        reasoningCommitted: applied.committed,
        reasoningPending: applied.pending,
        reasoningText: applied.visible,
        updatedAt: event.timestamp,
      });
      return;
    }

    if (event.eventType === "assistant.message") {
      const content = stringField(event.data, ["content", "chunkContent", "chunk_content"]);
      if (!content) return;
      const turn = currentLiveTurn(event);
      if (isStaleEvent(turn, event)) return;
      // Snap-replace: drain pending into committed; keep whichever is longer
      // (the final `content` typically equals concat of deltas, but acts as a
      // self-heal when the tail of the reorder buffer is still garbled).
      const drained = turn.assistantCommitted + joinPending(turn.assistantPending);
      const next = content.length > drained.length ? content : drained;
      upsertLiveTurn({
        ...turn,
        turnId: turn.turnId ?? event.parentId,
        assistantCommitted: next,
        assistantPending: [],
        assistantText: next,
        assistantFinalized: true,
        updatedAt: event.timestamp,
      });
      return;
    }

    if (event.eventType === "assistant.reasoning") {
      // Final reasoning event carries the full content. Same dedup strategy
      // as `assistant.message` above.
      const content = stringField(event.data, ["content", "chunkContent", "chunk_content"]);
      if (!content) return;
      const turn = currentLiveTurn(event);
      if (isStaleEvent(turn, event)) return;
      const drained = turn.reasoningCommitted + joinPending(turn.reasoningPending);
      const next = content.length > drained.length ? content : drained;
      upsertLiveTurn({
        ...turn,
        turnId: turn.turnId ?? event.parentId,
        reasoningCommitted: next,
        reasoningPending: [],
        reasoningText: next,
        reasoningFinalized: true,
        updatedAt: event.timestamp,
      });
    }
  }

  return { liveTurnsBySessionId, applyBridgeEvent, clearLiveTurn };
}
