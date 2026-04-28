import type { BridgeEvent, BridgeSessionInfo } from "@tracepilot/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref, shallowRef } from "vue";

const clientMocks = vi.hoisted(() => ({
  sdkAbortSession: vi.fn(async () => {}),
  sdkCreateSession: vi.fn(
    async (): Promise<BridgeSessionInfo> => ({
      sessionId: "created-1",
      model: null,
      workingDirectory: null,
      mode: null,
      isActive: true,
      resumeError: null,
      isRemote: false,
    }),
  ),
  sdkDestroySession: vi.fn(async () => {}),
  sdkGetForegroundSession: vi.fn(async () => null),
  sdkResumeSession: vi.fn(
    async (sessionId: string): Promise<BridgeSessionInfo> => ({
      sessionId,
      model: null,
      workingDirectory: null,
      mode: null,
      isActive: true,
      resumeError: null,
      isRemote: false,
    }),
  ),
  sdkSendMessage: vi.fn(async () => "turn-1"),
  sdkSetForegroundSession: vi.fn(async () => {}),
  sdkSetSessionMode: vi.fn(async () => {}),
  sdkSetSessionModel: vi.fn(async () => {}),
  sdkUnlinkSession: vi.fn(async () => {}),
}));

vi.mock("@tracepilot/client", () => clientMocks);

import { createMessagingSlice } from "../messaging";

function makeSession(sessionId: string, isActive: boolean, model?: string): BridgeSessionInfo {
  return {
    sessionId,
    model: model ?? null,
    workingDirectory: null,
    mode: null,
    isActive,
    resumeError: null,
    isRemote: false,
  };
}

function makeSlice(initialSessions: BridgeSessionInfo[] = []) {
  const sessions = ref(initialSessions);
  const activeSessions = ref(initialSessions.filter((s) => s.isActive).length);
  const lastError = ref<string | null>(null);
  const recentEvents = shallowRef([]);
  const slice = createMessagingSlice({ sessions, activeSessions, lastError, recentEvents });
  return { slice, sessions, activeSessions, lastError };
}

function makeEvent(
  sessionId: string,
  eventType: string,
  data: Record<string, unknown> = {},
): BridgeEvent {
  return {
    sessionId,
    eventType,
    timestamp: "2026-04-27T00:00:00Z",
    id: null,
    parentId: null,
    ephemeral: false,
    data,
  };
}

describe("createMessagingSlice session cache isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sendMessage toggles per-session sending and clears lastError on success", async () => {
    const { slice, lastError } = makeSlice();
    lastError.value = "stale";

    const pending = slice.sendMessage("sdk-A", { prompt: "hi" });
    expect(slice.isSending("sdk-A")).toBe(true);
    expect(slice.isSending("sdk-B")).toBe(false);
    expect(slice.sendingMessage.value).toBe(true);
    const turnId = await pending;

    expect(turnId).toBe("turn-1");
    expect(slice.isSending("sdk-A")).toBe(false);
    expect(slice.sendingMessage.value).toBe(false);
    expect(lastError.value).toBeNull();
  });

  it("sendMessage returns null and sets lastError on failure without resuming", async () => {
    clientMocks.sdkSendMessage.mockRejectedValueOnce(new Error("boom"));
    const { slice, lastError } = makeSlice();

    const result = await slice.sendMessage("sdk-A", { prompt: "x" });

    expect(result).toBeNull();
    expect(lastError.value).toBe("boom");
    expect(clientMocks.sdkResumeSession).not.toHaveBeenCalled();
  });

  it("resumeSession upserts only the returned session and preserves unrelated sessions", async () => {
    clientMocks.sdkResumeSession.mockResolvedValueOnce(makeSession("sdk-B", true, "gpt-5"));
    const { slice, sessions, activeSessions } = makeSlice([
      makeSession("sdk-A", true, "gpt-4"),
      makeSession("sdk-B", false, "gpt-4"),
      makeSession("sdk-C", false, "gpt-4"),
    ]);

    await slice.resumeSession("sdk-B");

    expect(sessions.value).toEqual([
      makeSession("sdk-A", true, "gpt-4"),
      makeSession("sdk-B", true, "gpt-5"),
      makeSession("sdk-C", false, "gpt-4"),
    ]);
    expect(activeSessions.value).toBe(2);
  });

  it("destroySession marks only the targeted session inactive", async () => {
    const { slice, sessions, activeSessions } = makeSlice([
      makeSession("sdk-A", true),
      makeSession("sdk-B", true),
    ]);

    await slice.destroySession("sdk-B");

    expect(sessions.value).toEqual([makeSession("sdk-A", true), makeSession("sdk-B", false)]);
    expect(activeSessions.value).toBe(1);
  });

  it("unlinkSession marks only the targeted session inactive", async () => {
    const { slice, sessions, activeSessions } = makeSlice([
      makeSession("sdk-A", true),
      makeSession("sdk-B", true),
    ]);

    await slice.unlinkSession("sdk-A");

    expect(sessions.value).toEqual([makeSession("sdk-A", false), makeSession("sdk-B", true)]);
    expect(activeSessions.value).toBe(1);
  });

  it("setSessionMode optimistically patches only the targeted session mode", async () => {
    const { slice, sessions } = makeSlice([makeSession("sdk-A", true), makeSession("sdk-B", true)]);

    await slice.setSessionMode("sdk-B", "plan");

    expect(sessions.value).toEqual([
      makeSession("sdk-A", true),
      { ...makeSession("sdk-B", true), mode: "plan" },
    ]);
  });

  it("sessionEvents filters recentEvents by sessionId", () => {
    const sessions = ref<BridgeSessionInfo[]>([]);
    const activeSessions = ref(0);
    const lastError = ref<string | null>(null);
    const recentEvents = ref<BridgeEvent[]>([
      makeEvent("sdk-A", "assistant.message_delta"),
      makeEvent("sdk-B", "assistant.message_delta"),
      makeEvent("sdk-A", "session.idle"),
    ]);
    const slice = createMessagingSlice({ sessions, activeSessions, lastError, recentEvents });

    expect(slice.sessionEvents.value("sdk-A")).toHaveLength(2);
    expect(slice.sessionEvents.value("sdk-B")).toHaveLength(1);
  });

  it("accumulates assistant and reasoning deltas into per-session live turns", () => {
    const { slice } = makeSlice();

    slice.applyBridgeEvent(makeEvent("sdk-A", "assistant.turn_start", { turnId: "turn-A" }));
    slice.applyBridgeEvent(
      makeEvent("sdk-A", "assistant.reasoning_delta", { deltaContent: "thinking " }),
    );
    slice.applyBridgeEvent(
      makeEvent("sdk-A", "assistant.message_delta", { deltaContent: "hello " }),
    );
    slice.applyBridgeEvent(
      makeEvent("sdk-B", "assistant.message_delta", { deltaContent: "other" }),
    );
    slice.applyBridgeEvent(
      makeEvent("sdk-A", "assistant.message_delta", { deltaContent: "world" }),
    );

    expect(slice.liveTurnsBySessionId.value["sdk-A"]).toMatchObject({
      sessionId: "sdk-A",
      turnId: "turn-A",
      reasoningText: "thinking ",
      assistantText: "hello world",
    });
    expect(slice.liveTurnsBySessionId.value["sdk-B"]?.assistantText).toBe("other");

    slice.clearLiveTurn("sdk-A");
    expect(slice.liveTurnsBySessionId.value["sdk-A"]).toBeUndefined();
  });

  it("does not duplicate text when a final assistant.message arrives after deltas", () => {
    const { slice } = makeSlice();

    slice.applyBridgeEvent(makeEvent("sdk-A", "assistant.turn_start", { turnId: "turn-A" }));
    slice.applyBridgeEvent(
      makeEvent("sdk-A", "assistant.message_delta", { deltaContent: "hello " }),
    );
    slice.applyBridgeEvent(
      makeEvent("sdk-A", "assistant.message_delta", { deltaContent: "world" }),
    );
    // Final event with the FULL content — must NOT be appended on top.
    slice.applyBridgeEvent(makeEvent("sdk-A", "assistant.message", { content: "hello world" }));

    expect(slice.liveTurnsBySessionId.value["sdk-A"]?.assistantText).toBe("hello world");
  });

  it("does not duplicate reasoning when a final assistant.reasoning arrives after deltas", () => {
    const { slice } = makeSlice();

    slice.applyBridgeEvent(makeEvent("sdk-A", "assistant.turn_start", { turnId: "turn-A" }));
    slice.applyBridgeEvent(
      makeEvent("sdk-A", "assistant.reasoning_delta", { deltaContent: "thinking " }),
    );
    slice.applyBridgeEvent(
      makeEvent("sdk-A", "assistant.reasoning_delta", { deltaContent: "deeply" }),
    );
    slice.applyBridgeEvent(
      makeEvent("sdk-A", "assistant.reasoning", { content: "thinking deeply" }),
    );

    expect(slice.liveTurnsBySessionId.value["sdk-A"]?.reasoningText).toBe("thinking deeply");
  });

  it("ignores stray `content` field on delta events", () => {
    const { slice } = makeSlice();

    slice.applyBridgeEvent(makeEvent("sdk-A", "assistant.turn_start", { turnId: "turn-A" }));
    // A misbehaving server might attach `content` to a delta event. We must
    // ignore it — only deltaContent counts.
    slice.applyBridgeEvent(makeEvent("sdk-A", "assistant.message_delta", { content: "STRAY" }));
    slice.applyBridgeEvent(makeEvent("sdk-A", "assistant.message_delta", { deltaContent: "ok" }));

    expect(slice.liveTurnsBySessionId.value["sdk-A"]?.assistantText).toBe("ok");
  });

  it("populates assistant.message even when no deltas arrived first", () => {
    const { slice } = makeSlice();

    slice.applyBridgeEvent(makeEvent("sdk-A", "assistant.turn_start", { turnId: "turn-A" }));
    slice.applyBridgeEvent(makeEvent("sdk-A", "assistant.message", { content: "complete answer" }));

    expect(slice.liveTurnsBySessionId.value["sdk-A"]?.assistantText).toBe("complete answer");
  });

  it("accepts the `delta` field alias on message and reasoning delta events", () => {
    // Some SDK servers emit `{ delta: "..." }` rather than `{ deltaContent }`.
    // The Rust reducer accepts this alias; the frontend live-turn accumulator
    // must too, otherwise the chat live preview never updates until a final
    // `assistant.message` arrives.
    const { slice } = makeSlice();

    slice.applyBridgeEvent(makeEvent("sdk-A", "assistant.turn_start", { turnId: "turn-A" }));
    slice.applyBridgeEvent(makeEvent("sdk-A", "assistant.message_delta", { delta: "hello " }));
    slice.applyBridgeEvent(makeEvent("sdk-A", "assistant.message_delta", { delta: "world" }));
    slice.applyBridgeEvent(makeEvent("sdk-A", "assistant.reasoning_delta", { delta: "think " }));
    slice.applyBridgeEvent(makeEvent("sdk-A", "assistant.reasoning_delta", { delta: "more" }));

    const live = slice.liveTurnsBySessionId.value["sdk-A"];
    expect(live?.assistantText).toBe("hello world");
    expect(live?.reasoningText).toBe("think more");
  });
});
