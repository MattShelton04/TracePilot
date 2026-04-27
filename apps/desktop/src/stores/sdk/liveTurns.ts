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
      const delta = stringField(event.data, ["deltaContent", "delta_content", "content"]);
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
      const delta = stringField(event.data, ["deltaContent", "delta_content", "content"]);
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
      upsertLiveTurn({
        ...turn,
        turnId: turn.turnId ?? event.parentId,
        assistantText: content,
        updatedAt: event.timestamp,
      });
    }
  }

  return { liveTurnsBySessionId, applyBridgeEvent, clearLiveTurn };
}
