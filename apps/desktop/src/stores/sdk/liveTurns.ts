import type { BridgeEvent } from "@tracepilot/types";
import { shallowRef } from "vue";

export interface SdkLiveTurn {
  sessionId: string;
  turnId: string | null;
  assistantText: string;
  reasoningText: string;
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

export function createLiveTurnAccumulator() {
  const liveTurnsBySessionId = shallowRef<Record<string, SdkLiveTurn>>({});

  function currentLiveTurn(event: BridgeEvent): SdkLiveTurn {
    return (
      liveTurnsBySessionId.value[event.sessionId] ?? {
        sessionId: event.sessionId,
        turnId: null,
        assistantText: "",
        reasoningText: "",
        updatedAt: event.timestamp,
      }
    );
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

  function applyBridgeEvent(event: BridgeEvent) {
    // TEMPORARY diagnostic logging — see PR #536 follow-up. Logs every
    // assistant.* / session.* / tool.execution_* event the frontend live-turn
    // accumulator sees, so we can diff against the bridge-side `[sdk-diag]`
    // log to spot duplicates / out-of-order delivery.
    const et = event.eventType;
    if (
      et.startsWith("assistant.") ||
      et.startsWith("session.") ||
      et.startsWith("tool.execution_")
    ) {
      const d = (event.data ?? {}) as Record<string, unknown>;
      const preview = (k: string): string => {
        const v = d[k];
        if (typeof v !== "string") return "-";
        return JSON.stringify(v.length > 80 ? `${v.slice(0, 80)}…` : v);
      };
      // eslint-disable-next-line no-console
      console.info(
        `[sdk-diag] frontend event session=${event.sessionId} type=${et} id=${event.id ?? "-"} parent=${event.parentId ?? "-"} msgId=${(d.messageId as string) ?? "-"} reasoningId=${(d.reasoningId as string) ?? "-"} delta=${preview("deltaContent")} content=${preview("content")} chunk=${preview("chunkContent")}`,
      );
    }

    if (event.eventType === "assistant.turn_start") {
      upsertLiveTurn({
        sessionId: event.sessionId,
        turnId: stringField(event.data, ["turnId", "turn_id"]) ?? event.id,
        assistantText: "",
        reasoningText: "",
        updatedAt: event.timestamp,
      });
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
      upsertLiveTurn({
        ...turn,
        turnId: turn.turnId ?? event.parentId,
        assistantText: `${turn.assistantText}${delta}`,
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
      upsertLiveTurn({
        ...turn,
        turnId: turn.turnId ?? event.parentId,
        reasoningText: `${turn.reasoningText}${delta}`,
        updatedAt: event.timestamp,
      });
      return;
    }

    if (event.eventType === "assistant.message") {
      const content = stringField(event.data, ["content", "chunkContent", "chunk_content"]);
      if (!content) return;
      const turn = currentLiveTurn(event);
      // Replace only when the final content is longer than the accumulated
      // delta text. Otherwise the deltas already produced the final text and
      // overwriting with the same payload would still be a no-op, but skipping
      // avoids a wasted render and protects against any out-of-order replays
      // where a partial `content` could shrink the visible text.
      const next = content.length > turn.assistantText.length ? content : turn.assistantText;
      upsertLiveTurn({
        ...turn,
        turnId: turn.turnId ?? event.parentId,
        assistantText: next,
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
      const next = content.length > turn.reasoningText.length ? content : turn.reasoningText;
      upsertLiveTurn({
        ...turn,
        turnId: turn.turnId ?? event.parentId,
        reasoningText: next,
        updatedAt: event.timestamp,
      });
    }
  }

  return { liveTurnsBySessionId, applyBridgeEvent, clearLiveTurn };
}
