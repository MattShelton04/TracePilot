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
});
