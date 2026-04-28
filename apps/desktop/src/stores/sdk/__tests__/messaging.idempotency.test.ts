import type { BridgeSessionInfo } from "@tracepilot/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref, shallowRef } from "vue";

const clientMocks = vi.hoisted(() => ({
  sdkAbortSession: vi.fn(async () => {}),
  sdkCreateSession: vi.fn(),
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

function makeSession(sessionId: string, isActive: boolean): BridgeSessionInfo {
  return {
    sessionId,
    model: null,
    workingDirectory: null,
    mode: null,
    isActive,
    resumeError: null,
    isRemote: false,
  };
}

function makeSlice() {
  const sessions = ref<BridgeSessionInfo[]>([]);
  const activeSessions = ref(0);
  const lastError = ref<string | null>(null);
  const recentEvents = shallowRef([]);
  const slice = createMessagingSlice({ sessions, activeSessions, lastError, recentEvents });
  return { slice };
}

describe("createMessagingSlice idempotency guards", () => {
  beforeEach(() => {
    for (const fn of Object.values(clientMocks)) fn.mockClear();
  });

  it("sendMessage drops a duplicate call while one is already in flight for the same session", async () => {
    // Repro for double-send bug: a fast double-tap of the Send button (or
    // Ctrl+Enter racing a click) used to fire two SDK sends because the
    // caller's prompt-clear only ran AFTER the first send resolved.
    let resolveFirst: ((v: string) => void) | undefined;
    clientMocks.sdkSendMessage.mockImplementationOnce(
      () =>
        new Promise<string>((res) => {
          resolveFirst = res;
        }),
    );
    const { slice } = makeSlice();

    const first = slice.sendMessage("sdk-A", { prompt: "hi" });
    expect(slice.isSending("sdk-A")).toBe(true);

    const second = await slice.sendMessage("sdk-A", { prompt: "hi" });
    expect(second).toBeNull();
    expect(clientMocks.sdkSendMessage).toHaveBeenCalledTimes(1);

    resolveFirst?.("turn-1");
    expect(await first).toBe("turn-1");

    const third = await slice.sendMessage("sdk-A", { prompt: "next" });
    expect(third).toBe("turn-1");
    expect(clientMocks.sdkSendMessage).toHaveBeenCalledTimes(2);
  });

  it("sendMessage allows concurrent sends for *different* sessions", async () => {
    let resolveA: ((v: string) => void) | undefined;
    clientMocks.sdkSendMessage.mockImplementationOnce(
      () =>
        new Promise<string>((res) => {
          resolveA = res;
        }),
    );
    clientMocks.sdkSendMessage.mockResolvedValueOnce("turn-B");
    const { slice } = makeSlice();

    const aPending = slice.sendMessage("sdk-A", { prompt: "a" });
    const b = await slice.sendMessage("sdk-B", { prompt: "b" });

    expect(b).toBe("turn-B");
    resolveA?.("turn-A");
    expect(await aPending).toBe("turn-A");
  });

  it("resumeSession coalesces concurrent calls for the same sessionId onto one SDK call", async () => {
    // Repro for duplicate-resume bug: two callers (e.g. linkSession from a
    // re-render race, or a popout window mounting just as the main one
    // resumes) used to each invoke the SDK, producing two `session.resume`
    // events on disk.
    let resolve: ((v: BridgeSessionInfo) => void) | undefined;
    clientMocks.sdkResumeSession.mockImplementationOnce(
      () =>
        new Promise<BridgeSessionInfo>((res) => {
          resolve = res;
        }),
    );
    const { slice } = makeSlice();

    const p1 = slice.resumeSession("sdk-A");
    const p2 = slice.resumeSession("sdk-A");

    expect(clientMocks.sdkResumeSession).toHaveBeenCalledTimes(1);

    resolve?.(makeSession("sdk-A", true));
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1?.sessionId).toBe("sdk-A");
    expect(r2?.sessionId).toBe("sdk-A");
    expect(r1).toBe(r2);
  });

  it("resumeSession allows a fresh call once the previous in-flight resume completes", async () => {
    const { slice } = makeSlice();

    await slice.resumeSession("sdk-A");
    await slice.resumeSession("sdk-A");

    expect(clientMocks.sdkResumeSession).toHaveBeenCalledTimes(2);
  });
});
