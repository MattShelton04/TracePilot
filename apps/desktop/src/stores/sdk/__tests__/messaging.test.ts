import type { BridgeEvent, BridgeSessionInfo } from "@tracepilot/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

vi.mock("@tracepilot/client", () => ({
  sdkAbortSession: vi.fn(async () => {}),
  sdkCreateSession: vi.fn(
    async () => ({ sessionId: "new-s", isActive: true }) as BridgeSessionInfo,
  ),
  sdkDestroySession: vi.fn(async () => {}),
  sdkGetForegroundSession: vi.fn(async () => "fg-1"),
  sdkResumeSession: vi.fn(
    async (sid: string) => ({ sessionId: sid, isActive: true }) as BridgeSessionInfo,
  ),
  sdkSendMessage: vi.fn(async () => "turn-1"),
  sdkSetForegroundSession: vi.fn(async () => {}),
  sdkSetSessionMode: vi.fn(async () => {}),
  sdkSetSessionModel: vi.fn(async () => {}),
  sdkUnlinkSession: vi.fn(async () => {}),
}));

import * as client from "@tracepilot/client";
import { createMessagingSlice } from "../messaging";

function makeDeps(initial: BridgeSessionInfo[] = []) {
  return {
    sessions: ref<BridgeSessionInfo[]>(initial),
    activeSessions: ref(initial.length),
    lastError: ref<string | null>(null),
    recentEvents: ref<BridgeEvent[]>([]),
  };
}

describe("createMessagingSlice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sendMessage toggles sendingMessage and clears lastError on success", async () => {
    const deps = makeDeps();
    deps.lastError.value = "stale";
    const slice = createMessagingSlice(deps);
    const p = slice.sendMessage("s1", { prompt: "hi" });
    expect(slice.sendingMessage.value).toBe(true);
    const turnId = await p;
    expect(turnId).toBe("turn-1");
    expect(slice.sendingMessage.value).toBe(false);
    expect(deps.lastError.value).toBeNull();
  });

  it("sendMessage returns null and sets lastError on failure (NO implicit resume)", async () => {
    (client.sdkSendMessage as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("boom"));
    const deps = makeDeps();
    const slice = createMessagingSlice(deps);
    const r = await slice.sendMessage("s1", { prompt: "x" });
    expect(r).toBeNull();
    expect(deps.lastError.value).toBe("boom");
    expect(client.sdkResumeSession).not.toHaveBeenCalled();
  });

  it("resumeSession patches isActive on the original id when backend returns a new id", async () => {
    const original: BridgeSessionInfo = {
      sessionId: "orig-id",
      isActive: false,
    } as BridgeSessionInfo;
    (client.sdkResumeSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      sessionId: "new-id",
      isActive: true,
    } as BridgeSessionInfo);
    const deps = makeDeps([original]);
    const slice = createMessagingSlice(deps);
    const result = await slice.resumeSession("orig-id");
    expect(result?.sessionId).toBe("new-id");
    const orig = deps.sessions.value.find((s) => s.sessionId === "orig-id");
    expect(orig?.isActive).toBe(true);
    const added = deps.sessions.value.find((s) => s.sessionId === "new-id");
    expect(added?.isActive).toBe(true);
  });

  it("destroySession marks the session inactive (isActive gate preserved)", async () => {
    const deps = makeDeps([
      { sessionId: "s1", isActive: true } as BridgeSessionInfo,
      { sessionId: "s2", isActive: true } as BridgeSessionInfo,
    ]);
    const slice = createMessagingSlice(deps);
    await slice.destroySession("s1");
    expect(deps.sessions.value.find((s) => s.sessionId === "s1")?.isActive).toBe(false);
    expect(deps.sessions.value.find((s) => s.sessionId === "s2")?.isActive).toBe(true);
  });

  it("setSessionMode optimistically patches the session.mode", async () => {
    const deps = makeDeps([
      { sessionId: "s1", isActive: true, mode: "chat" } as unknown as BridgeSessionInfo,
    ]);
    const slice = createMessagingSlice(deps);
    await slice.setSessionMode(
      "s1",
      "agent" as unknown as Parameters<typeof slice.setSessionMode>[1],
    );
    expect(deps.sessions.value[0].mode).toBe("agent");
  });

  it("sessionEvents filters recentEvents by sessionId", () => {
    const deps = makeDeps();
    deps.recentEvents.value = [
      { sessionId: "a", kind: "x" } as unknown as BridgeEvent,
      { sessionId: "b", kind: "y" } as unknown as BridgeEvent,
      { sessionId: "a", kind: "z" } as unknown as BridgeEvent,
    ];
    const slice = createMessagingSlice(deps);
    expect(slice.sessionEvents.value("a")).toHaveLength(2);
    expect(slice.sessionEvents.value("b")).toHaveLength(1);
  });
});
