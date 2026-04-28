import type { BridgeEvent, BridgeSessionInfo } from "@tracepilot/types";
import { describe, expect, it, vi } from "vitest";
import { ref, shallowRef } from "vue";

vi.mock("@tracepilot/tauri-bridge", () => ({
  sdkSendMessage: vi.fn(),
  sdkResume: vi.fn(),
  sdkUnlinkSession: vi.fn(),
  sdkDestroySession: vi.fn(),
}));

import { createMessagingSlice } from "../messaging";

function makeSlice() {
  const sessions = ref<BridgeSessionInfo[]>([]);
  const activeSessions = ref(0);
  const lastError = ref<string | null>(null);
  const recentEvents = shallowRef([]);
  return createMessagingSlice({ sessions, activeSessions, lastError, recentEvents });
}

function at(
  sessionId: string,
  eventType: string,
  timestamp: string,
  data: Record<string, unknown> = {},
): BridgeEvent {
  return {
    sessionId,
    eventType,
    timestamp,
    id: null,
    parentId: null,
    ephemeral: false,
    data,
  };
}

function atP(
  sessionId: string,
  eventType: string,
  timestamp: string,
  parentId: string,
  data: Record<string, unknown> = {},
): BridgeEvent {
  return {
    sessionId,
    eventType,
    timestamp,
    id: null,
    parentId,
    ephemeral: false,
    data,
  };
}

describe("liveTurns reorder buffer", () => {
  it("reorders out-of-order deltas using event timestamp", () => {
    // Repro for the SDK race: pinned Copilot Rust SDK `tokio::spawn`s a fresh
    // task per `session.event` notification, so adjacent deltas can race into
    // `event_tx.send` in non-source order. The reducer must sort by
    // `event.timestamp` so the live preview reflects source order.
    const slice = makeSlice();
    slice.applyBridgeEvent(at("sdk-A", "assistant.turn_start", "2026-04-27T00:00:00.000Z"));
    // Source-order deltas would be: "hell", "ow", " world".
    // Wire arrives reordered: "hell", " world", "ow".
    slice.applyBridgeEvent(
      at("sdk-A", "assistant.message_delta", "2026-04-27T00:00:00.001Z", { deltaContent: "hell" }),
    );
    slice.applyBridgeEvent(
      at("sdk-A", "assistant.message_delta", "2026-04-27T00:00:00.003Z", {
        deltaContent: " world",
      }),
    );
    slice.applyBridgeEvent(
      at("sdk-A", "assistant.message_delta", "2026-04-27T00:00:00.002Z", { deltaContent: "ow" }),
    );

    expect(slice.liveTurnsBySessionId.value["sdk-A"]?.assistantText).toBe("hellow world");
  });

  it("snap-replaces the visible text on assistant.message when reordered tail is garbled", () => {
    // Even if the reorder window failed to recover (e.g. >WINDOW deltas
    // arrived out of order), the final `assistant.message` carries the full
    // canonical content and snap-replaces if it's longer than what we have.
    const slice = makeSlice();
    slice.applyBridgeEvent(at("sdk-A", "assistant.turn_start", "2026-04-27T00:00:00.000Z"));
    slice.applyBridgeEvent(
      at("sdk-A", "assistant.message_delta", "2026-04-27T00:00:00.002Z", {
        deltaContent: "world",
      }),
    );
    slice.applyBridgeEvent(
      at("sdk-A", "assistant.message_delta", "2026-04-27T00:00:00.001Z", {
        deltaContent: "hello ",
      }),
    );
    slice.applyBridgeEvent(
      at("sdk-A", "assistant.message", "2026-04-27T00:00:00.010Z", {
        content: "hello world (final)",
      }),
    );

    expect(slice.liveTurnsBySessionId.value["sdk-A"]?.assistantText).toBe("hello world (final)");
  });

  it("reorders reasoning_delta events identically", () => {
    const slice = makeSlice();
    slice.applyBridgeEvent(at("sdk-A", "assistant.turn_start", "2026-04-27T00:00:00.000Z"));
    slice.applyBridgeEvent(
      at("sdk-A", "assistant.reasoning_delta", "2026-04-27T00:00:00.002Z", {
        deltaContent: "B",
      }),
    );
    slice.applyBridgeEvent(
      at("sdk-A", "assistant.reasoning_delta", "2026-04-27T00:00:00.001Z", {
        deltaContent: "A",
      }),
    );
    expect(slice.liveTurnsBySessionId.value["sdk-A"]?.reasoningText).toBe("AB");
  });

  it("ignores delta events that arrive after assistant.message finalizes the stream", () => {
    // Late delta after canonical text would re-corrupt it (e.g. the same
    // SDK race could deliver one straggler post-final). Once finalized, the
    // reducer must drop subsequent deltas for that turn.
    const slice = makeSlice();
    slice.applyBridgeEvent(at("sdk-A", "assistant.turn_start", "2026-04-27T00:00:00.000Z"));
    slice.applyBridgeEvent(
      at("sdk-A", "assistant.message_delta", "2026-04-27T00:00:00.001Z", {
        deltaContent: "hello ",
      }),
    );
    slice.applyBridgeEvent(
      at("sdk-A", "assistant.message", "2026-04-27T00:00:00.010Z", {
        content: "hello world",
      }),
    );
    // Straggler delta arriving AFTER the final event:
    slice.applyBridgeEvent(
      at("sdk-A", "assistant.message_delta", "2026-04-27T00:00:00.002Z", {
        deltaContent: "world",
      }),
    );
    expect(slice.liveTurnsBySessionId.value["sdk-A"]?.assistantText).toBe("hello world");
  });

  it("drops deltas whose parentId disagrees with the active turn", () => {
    // Cross-turn contamination repro: a previous-turn delta arrives after the
    // next assistant.turn_start. With only sessionId-based routing it would
    // be applied to the new turn's buffer; the parentId guard prevents that.
    const slice = makeSlice();
    slice.applyBridgeEvent(
      atP("sdk-A", "assistant.turn_start", "2026-04-27T00:00:00.000Z", "turn-1", {
        turnId: "turn-1",
      }),
    );
    slice.applyBridgeEvent(
      atP("sdk-A", "assistant.message_delta", "2026-04-27T00:00:00.001Z", "turn-1", {
        deltaContent: "first ",
      }),
    );
    slice.applyBridgeEvent(
      atP("sdk-A", "assistant.message", "2026-04-27T00:00:00.010Z", "turn-1", {
        content: "first turn",
      }),
    );
    slice.applyBridgeEvent(
      atP("sdk-A", "assistant.turn_start", "2026-04-27T00:00:01.000Z", "turn-2", {
        turnId: "turn-2",
      }),
    );
    slice.applyBridgeEvent(
      atP("sdk-A", "assistant.message_delta", "2026-04-27T00:00:01.001Z", "turn-2", {
        deltaContent: "second",
      }),
    );
    // Late straggler from the PREVIOUS turn arriving after rotation:
    slice.applyBridgeEvent(
      atP("sdk-A", "assistant.message_delta", "2026-04-27T00:00:00.002Z", "turn-1", {
        deltaContent: "STRAGGLER",
      }),
    );
    expect(slice.liveTurnsBySessionId.value["sdk-A"]?.assistantText).toBe("second");
    expect(slice.liveTurnsBySessionId.value["sdk-A"]?.turnId).toBe("turn-2");
  });
});
