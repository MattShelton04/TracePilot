/**
 * Unit tests for useLiveSdkSession.
 *
 * All reactive Vue state is driven through the sdkState mock — the mock's
 * `sessionEvents(id)` method returns a filtered slice of recentEvents, which
 * is what useLiveSdkSession watches internally.
 *
 * Coverage:
 *   - Streaming message accumulation: deltas → terminal flush
 *   - Streaming reasoning accumulation
 *   - Active tool lifecycle: start → progress → partial_result → complete
 *   - Compaction state machine: start → complete
 *   - Token usage from session.usage_info
 *   - Abort reason set + clear
 *   - session.idle flushes streaming state
 *   - session.model_change updates liveModel
 *   - WeakSet dedup: same event object never processed twice
 *   - assistant.turn_start / turn_end lifecycle
 *   - session.truncation
 *   - clearAbort / clearHandoff / clearRewind / clearTruncation actions
 */

import { setupPinia } from "@tracepilot/test-utils";
import { effectScope, nextTick, reactive, ref } from "vue";
import { beforeEach, describe, expect, it } from "vitest";
import type { BridgeEvent } from "@tracepilot/types";

// ─── SDK store mock ─────────────────────────────────────────────────────────
const sdkState = reactive({
  recentEvents: [] as BridgeEvent[],
  isConnected: true,
  isStdioMode: false,
  sessions: [] as Array<{ sessionId: string; isActive: boolean }>,
  sessionEvents(sessionId: string): BridgeEvent[] {
    return this.recentEvents.filter((e) => e.sessionId === sessionId);
  },
});

import { vi } from "vitest";

vi.mock("@/stores/sdk", () => ({
  useSdkStore: () => sdkState,
}));

// ─── Import composable (after mock registration) ─────────────────────────────
import { useLiveSdkSession } from "../useLiveSdkSession";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SESSION_ID = "session-live-1";
let _seq = 0;

function makeEvent(overrides: Partial<BridgeEvent> = {}): BridgeEvent {
  const seq = ++_seq;
  return {
    sessionId: SESSION_ID,
    eventType: "session.idle",
    // Use a proper ISO-8601 timestamp that doesn't overflow at seq≥10.
    timestamp: new Date(1704067200000 + seq * 1000).toISOString(),
    id: `evt-${seq}`,
    parentId: null,
    ephemeral: false,
    data: null,
    ...overrides,
  };
}

function push(...events: BridgeEvent[]) {
  sdkState.recentEvents = [...sdkState.recentEvents, ...events];
}

// ─── Test suite ──────────────────────────────────────────────────────────────

describe("useLiveSdkSession", () => {
  beforeEach(() => {
    setupPinia();
    _seq = 0;
    sdkState.recentEvents = [];
    sdkState.isConnected = true;
    sdkState.sessions = [{ sessionId: SESSION_ID, isActive: true }];
  });

  // ── Streaming messages ───────────────────────────────────────────────────

  describe("streaming messages", () => {
    it("accumulates message_delta events by messageId", async () => {
      const sessionIdRef = ref(SESSION_ID);
      let live!: ReturnType<typeof useLiveSdkSession>;
      const scope = effectScope();
      scope.run(() => {
        live = useLiveSdkSession(sessionIdRef);
      });

      push(
        makeEvent({
          eventType: "assistant.message_delta",
          ephemeral: true,
          data: { messageId: "msg-1", deltaContent: "Hello " },
        }),
        makeEvent({
          eventType: "assistant.message_delta",
          ephemeral: true,
          data: { messageId: "msg-1", deltaContent: "world" },
        }),
      );
      await nextTick();

      expect(live.streamingMessages.get("msg-1")?.content).toBe("Hello world");
      scope.stop();
    });

    it("removes a streaming message when terminal assistant.message arrives", async () => {
      const sessionIdRef = ref(SESSION_ID);
      let live!: ReturnType<typeof useLiveSdkSession>;
      const scope = effectScope();
      scope.run(() => {
        live = useLiveSdkSession(sessionIdRef);
      });

      push(
        makeEvent({
          eventType: "assistant.message_delta",
          ephemeral: true,
          data: { messageId: "msg-2", deltaContent: "partial" },
        }),
      );
      await nextTick();
      expect(live.streamingMessages.size).toBe(1);

      push(
        makeEvent({
          eventType: "assistant.message",
          ephemeral: false,
          data: { messageId: "msg-2", content: "final" },
        }),
      );
      await nextTick();
      expect(live.streamingMessages.size).toBe(0);
      scope.stop();
    });

    it("clears activeTools on session.idle even if tool.execution_complete never arrived", async () => {
      const sessionIdRef = ref(SESSION_ID);
      let live!: ReturnType<typeof useLiveSdkSession>;
      const scope = effectScope();
      scope.run(() => {
        live = useLiveSdkSession(sessionIdRef);
      });

      // Tool starts but the session aborts before completion
      push(makeEvent({ eventType: "tool.execution_start", data: { toolCallId: "tc-orphan", toolName: "read" } }));
      await nextTick();
      expect(live.activeTools.size).toBe(1);

      push(makeEvent({ eventType: "session.idle" }));
      await nextTick();
      expect(live.activeTools.size).toBe(0);
      scope.stop();
    });

    it("clears activeTools on abort event", async () => {
      const sessionIdRef = ref(SESSION_ID);
      let live!: ReturnType<typeof useLiveSdkSession>;
      const scope = effectScope();
      scope.run(() => {
        live = useLiveSdkSession(sessionIdRef);
      });

      push(makeEvent({ eventType: "tool.execution_start", data: { toolCallId: "tc-abort", toolName: "write" } }));
      await nextTick();
      expect(live.activeTools.size).toBe(1);

      push(makeEvent({ eventType: "abort", data: { reason: "User cancelled" } }));
      await nextTick();
      expect(live.activeTools.size).toBe(0);
      scope.stop();
    });

    it("clears all streaming messages on assistant.turn_end", async () => {
      const sessionIdRef = ref(SESSION_ID);
      let live!: ReturnType<typeof useLiveSdkSession>;
      const scope = effectScope();
      scope.run(() => {
        live = useLiveSdkSession(sessionIdRef);
      });

      push(
        makeEvent({ eventType: "assistant.turn_start", data: { turnId: "t-end-1" } }),
        makeEvent({ eventType: "assistant.message_delta", ephemeral: true, data: { messageId: "m1", deltaContent: "a" } }),
        makeEvent({ eventType: "assistant.message_delta", ephemeral: true, data: { messageId: "m2", deltaContent: "b" } }),
      );
      await nextTick();
      expect(live.streamingMessages.size).toBe(2);
      expect(live.isAgentRunning.value).toBe(true);

      push(makeEvent({ eventType: "assistant.turn_end" }));
      await nextTick();
      // streaming cleared, activeTurnId cleared, but isAgentRunning stays true until session.idle
      expect(live.streamingMessages.size).toBe(0);
      expect(live.streamingReasoning.size).toBe(0);
      expect(live.activeTurnId.value).toBeNull();
      expect(live.isAgentRunning.value).toBe(true);
      scope.stop();
    });

    it("clears all streaming messages on session.idle (guard for out-of-order delivery)", async () => {
      const sessionIdRef = ref(SESSION_ID);
      let live!: ReturnType<typeof useLiveSdkSession>;
      const scope = effectScope();
      scope.run(() => {
        live = useLiveSdkSession(sessionIdRef);
      });

      push(
        makeEvent({ eventType: "assistant.message_delta", ephemeral: true, data: { messageId: "m3", deltaContent: "x" } }),
      );
      await nextTick();
      expect(live.streamingMessages.size).toBe(1);

      push(makeEvent({ eventType: "session.idle" }));
      await nextTick();
      expect(live.streamingMessages.size).toBe(0);
      scope.stop();
    });
  });

  // ── Streaming reasoning ─────────────────────────────────────────────────

  describe("streaming reasoning", () => {
    it("accumulates reasoning_delta events by reasoningId", async () => {
      const sessionIdRef = ref(SESSION_ID);
      let live!: ReturnType<typeof useLiveSdkSession>;
      const scope = effectScope();
      scope.run(() => {
        live = useLiveSdkSession(sessionIdRef);
      });

      push(
        makeEvent({ eventType: "assistant.reasoning_delta", ephemeral: true, data: { reasoningId: "r1", deltaContent: "Think " } }),
        makeEvent({ eventType: "assistant.reasoning_delta", ephemeral: true, data: { reasoningId: "r1", deltaContent: "harder" } }),
      );
      await nextTick();

      expect(live.streamingReasoning.get("r1")?.content).toBe("Think harder");
      scope.stop();
    });

    it("removes reasoning entry when terminal assistant.reasoning arrives", async () => {
      const sessionIdRef = ref(SESSION_ID);
      let live!: ReturnType<typeof useLiveSdkSession>;
      const scope = effectScope();
      scope.run(() => {
        live = useLiveSdkSession(sessionIdRef);
      });

      push(
        makeEvent({ eventType: "assistant.reasoning_delta", ephemeral: true, data: { reasoningId: "r2", deltaContent: "..." } }),
      );
      await nextTick();
      expect(live.streamingReasoning.size).toBe(1);

      push(makeEvent({ eventType: "assistant.reasoning", data: { reasoningId: "r2", content: "Final reasoning" } }));
      await nextTick();
      expect(live.streamingReasoning.size).toBe(0);
      scope.stop();
    });
  });

  // ── Active tools ────────────────────────────────────────────────────────

  describe("active tools", () => {
    it("inserts a tool entry on tool.execution_start and removes on complete", async () => {
      const sessionIdRef = ref(SESSION_ID);
      let live!: ReturnType<typeof useLiveSdkSession>;
      const scope = effectScope();
      scope.run(() => {
        live = useLiveSdkSession(sessionIdRef);
      });

      push(makeEvent({
        eventType: "tool.execution_start",
        data: { toolCallId: "tc1", toolName: "read_file", arguments: { path: "/foo" } },
      }));
      await nextTick();

      expect(live.activeTools.has("tc1")).toBe(true);
      expect(live.activeTools.get("tc1")?.toolName).toBe("read_file");

      push(makeEvent({ eventType: "tool.execution_complete", data: { toolCallId: "tc1" } }));
      await nextTick();

      expect(live.activeTools.has("tc1")).toBe(false);
      scope.stop();
    });

    it("updates progressMessage on tool.execution_progress", async () => {
      const sessionIdRef = ref(SESSION_ID);
      let live!: ReturnType<typeof useLiveSdkSession>;
      const scope = effectScope();
      scope.run(() => {
        live = useLiveSdkSession(sessionIdRef);
      });

      push(makeEvent({ eventType: "tool.execution_start", data: { toolCallId: "tc2", toolName: "search" } }));
      await nextTick();

      push(makeEvent({
        eventType: "tool.execution_progress",
        ephemeral: true,
        data: { toolCallId: "tc2", progressMessage: "Searching…" },
      }));
      await nextTick();

      expect(live.activeTools.get("tc2")?.progressMessage).toBe("Searching…");
      scope.stop();
    });

    it("appends partialOutput on tool.execution_partial_result", async () => {
      const sessionIdRef = ref(SESSION_ID);
      let live!: ReturnType<typeof useLiveSdkSession>;
      const scope = effectScope();
      scope.run(() => {
        live = useLiveSdkSession(sessionIdRef);
      });

      push(makeEvent({ eventType: "tool.execution_start", data: { toolCallId: "tc3", toolName: "run_cmd" } }));
      await nextTick();

      push(
        makeEvent({ eventType: "tool.execution_partial_result", ephemeral: true, data: { toolCallId: "tc3", partialOutput: "line1\n" } }),
        makeEvent({ eventType: "tool.execution_partial_result", ephemeral: true, data: { toolCallId: "tc3", partialOutput: "line2\n" } }),
      );
      await nextTick();

      expect(live.activeTools.get("tc3")?.partialOutput).toBe("line1\nline2\n");
      scope.stop();
    });
  });

  // ── Compaction ──────────────────────────────────────────────────────────

  describe("compaction", () => {
    it("transitions status from idle → compacting → idle", async () => {
      const sessionIdRef = ref(SESSION_ID);
      let live!: ReturnType<typeof useLiveSdkSession>;
      const scope = effectScope();
      scope.run(() => {
        live = useLiveSdkSession(sessionIdRef);
      });

      expect(live.compaction.status).toBe("idle");

      push(makeEvent({ eventType: "session.compaction_start", data: {} }));
      await nextTick();
      expect(live.compaction.status).toBe("compacting");

      push(makeEvent({
        eventType: "session.compaction_complete",
        data: { preCompactionTokens: 80000, postCompactionTokens: 20000, checkpointNumber: 3 },
      }));
      await nextTick();

      expect(live.compaction.status).toBe("idle");
      expect(live.compaction.preTokens).toBe(80000);
      expect(live.compaction.postTokens).toBe(20000);
      expect(live.compaction.checkpointNumber).toBe(3);
      expect(live.compaction.lastCompletedAt).toBeGreaterThan(0);
      scope.stop();
    });
  });

  // ── Token usage ─────────────────────────────────────────────────────────

  describe("token usage", () => {
    it("updates tokenUsage from session.usage_info and computes ratio", async () => {
      const sessionIdRef = ref(SESSION_ID);
      let live!: ReturnType<typeof useLiveSdkSession>;
      const scope = effectScope();
      scope.run(() => {
        live = useLiveSdkSession(sessionIdRef);
      });

      expect(live.tokenUsage.value).toBeNull();

      push(makeEvent({
        eventType: "session.usage_info",
        data: { currentTokens: 40000, tokenLimit: 100000, messagesLength: 50 },
      }));
      await nextTick();

      expect(live.tokenUsage.value?.currentTokens).toBe(40000);
      expect(live.tokenUsage.value?.tokenLimit).toBe(100000);
      expect(live.tokenUsage.value?.ratio).toBeCloseTo(0.4);
      scope.stop();
    });

    it("clamps ratio to 1 when tokens exceed limit", async () => {
      const sessionIdRef = ref(SESSION_ID);
      let live!: ReturnType<typeof useLiveSdkSession>;
      const scope = effectScope();
      scope.run(() => {
        live = useLiveSdkSession(sessionIdRef);
      });

      push(makeEvent({
        eventType: "session.usage_info",
        data: { currentTokens: 120000, tokenLimit: 100000 },
      }));
      await nextTick();

      expect(live.tokenUsage.value?.ratio).toBe(1);
      scope.stop();
    });
  });

  // ── Abort ───────────────────────────────────────────────────────────────

  describe("abort", () => {
    it("sets abortReason on abort event and clears on clearAbort()", async () => {
      const sessionIdRef = ref(SESSION_ID);
      let live!: ReturnType<typeof useLiveSdkSession>;
      const scope = effectScope();
      scope.run(() => {
        live = useLiveSdkSession(sessionIdRef);
      });

      push(makeEvent({ eventType: "abort", data: { reason: "User cancelled" } }));
      await nextTick();
      expect(live.abortReason.value).toBe("User cancelled");
      expect(live.isAgentRunning.value).toBe(false);
      expect(live.activeTurnId.value).toBeNull();

      live.clearAbort();
      expect(live.abortReason.value).toBeNull();
      scope.stop();
    });

    it("uses 'Aborted' fallback when abort has no reason field", async () => {
      const sessionIdRef = ref(SESSION_ID);
      let live!: ReturnType<typeof useLiveSdkSession>;
      const scope = effectScope();
      scope.run(() => {
        live = useLiveSdkSession(sessionIdRef);
      });

      push(makeEvent({ eventType: "abort", data: {} }));
      await nextTick();
      expect(live.abortReason.value).toBe("Aborted");
      expect(live.activeTurnId.value).toBeNull();
      scope.stop();
    });
  });

  // ── Model change ────────────────────────────────────────────────────────

  describe("model change", () => {
    it("updates liveModel on session.model_change", async () => {
      const sessionIdRef = ref(SESSION_ID);
      let live!: ReturnType<typeof useLiveSdkSession>;
      const scope = effectScope();
      scope.run(() => {
        live = useLiveSdkSession(sessionIdRef);
      });

      expect(live.liveModel.value).toBeNull();

      push(makeEvent({ eventType: "session.model_change", data: { newModel: "claude-opus-4-5" } }));
      await nextTick();
      expect(live.liveModel.value).toBe("claude-opus-4-5");
      scope.stop();
    });
  });

  // ── Turn lifecycle ───────────────────────────────────────────────────────

  describe("turn lifecycle", () => {
    it("sets isAgentRunning on turn_start; remains true until session.idle", async () => {
      const sessionIdRef = ref(SESSION_ID);
      let live!: ReturnType<typeof useLiveSdkSession>;
      const scope = effectScope();
      scope.run(() => {
        live = useLiveSdkSession(sessionIdRef);
      });

      expect(live.isAgentRunning.value).toBe(false);

      push(makeEvent({ eventType: "assistant.turn_start", data: { turnId: "t1" } }));
      await nextTick();
      expect(live.isAgentRunning.value).toBe(true);
      expect(live.activeTurnId.value).toBe("t1");

      // turn_end clears activeTurnId but does NOT clear isAgentRunning (multi-turn sessions
      // stay "running" until session.idle confirms the agent is fully idle).
      push(makeEvent({ eventType: "assistant.turn_end" }));
      await nextTick();
      expect(live.activeTurnId.value).toBeNull();
      expect(live.isAgentRunning.value).toBe(true);

      // session.idle is the definitive signal that the agent has stopped.
      push(makeEvent({ eventType: "session.idle" }));
      await nextTick();
      expect(live.isAgentRunning.value).toBe(false);
      scope.stop();
    });

    it("clears abort reason on turn_start (new turn resets prior abort state)", async () => {
      const sessionIdRef = ref(SESSION_ID);
      let live!: ReturnType<typeof useLiveSdkSession>;
      const scope = effectScope();
      scope.run(() => {
        live = useLiveSdkSession(sessionIdRef);
      });

      push(makeEvent({ eventType: "abort", data: { reason: "old abort" } }));
      await nextTick();
      expect(live.abortReason.value).toBe("old abort");

      push(makeEvent({ eventType: "assistant.turn_start", data: { turnId: "t2" } }));
      await nextTick();
      expect(live.abortReason.value).toBeNull();
      scope.stop();
    });
  });

  // ── Per-turn stats ───────────────────────────────────────────────────────

  describe("per-turn stats", () => {
    it("records lastTurnStats from assistant.usage", async () => {
      const sessionIdRef = ref(SESSION_ID);
      let live!: ReturnType<typeof useLiveSdkSession>;
      const scope = effectScope();
      scope.run(() => {
        live = useLiveSdkSession(sessionIdRef);
      });

      push(makeEvent({
        eventType: "assistant.usage",
        data: { model: "claude-sonnet-4-6", inputTokens: 1000, outputTokens: 500, duration: 3200 },
      }));
      await nextTick();

      expect(live.lastTurnStats.value?.model).toBe("claude-sonnet-4-6");
      expect(live.lastTurnStats.value?.inputTokens).toBe(1000);
      expect(live.lastTurnStats.value?.outputTokens).toBe(500);
      expect(live.lastTurnStats.value?.durationMs).toBe(3200);

      // Stats are cleared when a new turn starts (so command bar doesn't show stale data)
      push(makeEvent({ eventType: "assistant.turn_start", data: { turnId: "t-new" } }));
      await nextTick();
      expect(live.lastTurnStats.value).toBeNull();

      scope.stop();
    });
  });

  // ── Truncation ───────────────────────────────────────────────────────────

  describe("truncation", () => {
    it("sets lastTruncation from session.truncation and clearTruncation() resets it", async () => {
      const sessionIdRef = ref(SESSION_ID);
      let live!: ReturnType<typeof useLiveSdkSession>;
      const scope = effectScope();
      scope.run(() => {
        live = useLiveSdkSession(sessionIdRef);
      });

      push(makeEvent({
        eventType: "session.truncation",
        data: { tokensRemovedDuringTruncation: 5000, preTruncationTokensInMessages: 90000, postTruncationTokensInMessages: 85000, performedBy: "auto" },
      }));
      await nextTick();

      expect(live.lastTruncation.value?.tokensRemoved).toBe(5000);
      expect(live.lastTruncation.value?.performedBy).toBe("auto");

      live.clearTruncation();
      expect(live.lastTruncation.value).toBeNull();
      scope.stop();
    });
  });

  // ── Dedup ────────────────────────────────────────────────────────────────

  describe("WeakSet dedup", () => {
    it("does not process the same event object twice even if the array is replaced", async () => {
      const sessionIdRef = ref(SESSION_ID);
      let live!: ReturnType<typeof useLiveSdkSession>;
      const scope = effectScope();
      scope.run(() => {
        live = useLiveSdkSession(sessionIdRef);
      });

      const evt = makeEvent({ eventType: "session.model_change", data: { newModel: "model-A" } });
      push(evt);
      await nextTick();
      expect(live.liveModel.value).toBe("model-A");

      // Simulate array replacement with same object: second model_change with same ref
      sdkState.recentEvents = [...sdkState.recentEvents];
      await nextTick();
      // liveModel should still be model-A — not reset or changed
      expect(live.liveModel.value).toBe("model-A");

      // Add a new *different* event to prove the watcher does still fire
      push(makeEvent({ eventType: "session.model_change", data: { newModel: "model-B" } }));
      await nextTick();
      expect(live.liveModel.value).toBe("model-B");

      scope.stop();
    });
  });

  // ── Session ID change resets state ──────────────────────────────────────

  describe("session ID change", () => {
    it("resets all accumulated state when sessionId changes", async () => {
      const sessionIdRef = ref(SESSION_ID);
      let live!: ReturnType<typeof useLiveSdkSession>;
      const scope = effectScope();
      scope.run(() => {
        live = useLiveSdkSession(sessionIdRef);
      });

      // Build up state for session A
      push(makeEvent({ eventType: "assistant.turn_start", data: { turnId: "t1" } }));
      push(makeEvent({ eventType: "assistant.message_delta", ephemeral: true, data: { messageId: "m1", deltaContent: "hello" } }));
      push(makeEvent({ eventType: "tool.execution_start", data: { toolCallId: "tc1", toolName: "read" } }));
      push(makeEvent({ eventType: "session.model_change", data: { newModel: "model-X" } }));
      push(makeEvent({
        eventType: "session.usage_info",
        data: { currentTokens: 50000, tokenLimit: 100000 },
      }));
      await nextTick();

      expect(live.isAgentRunning.value).toBe(true);
      expect(live.streamingMessages.size).toBe(1);
      expect(live.activeTools.size).toBe(1);
      expect(live.liveModel.value).toBe("model-X");
      expect(live.tokenUsage.value).not.toBeNull();

      // Navigate to a different session
      sessionIdRef.value = "session-B";
      await nextTick();

      expect(live.isAgentRunning.value).toBe(false);
      expect(live.streamingMessages.size).toBe(0);
      expect(live.activeTools.size).toBe(0);
      expect(live.liveModel.value).toBeNull();
      expect(live.tokenUsage.value).toBeNull();

      scope.stop();
    });
  });

  // ── Events from other sessions are ignored ───────────────────────────────

  describe("session isolation", () => {
    it("ignores events from a different session ID", async () => {
      const sessionIdRef = ref(SESSION_ID);
      let live!: ReturnType<typeof useLiveSdkSession>;
      const scope = effectScope();
      scope.run(() => {
        live = useLiveSdkSession(sessionIdRef);
      });

      // Push event for a DIFFERENT session
      sdkState.recentEvents = [
        ...sdkState.recentEvents,
        {
          sessionId: "other-session",
          eventType: "session.model_change",
          data: { newModel: "other-model" },
          id: "x1",
          parentId: null,
          timestamp: "2024-01-01T00:00:01Z",
          ephemeral: false,
        },
      ];
      await nextTick();

      expect(live.liveModel.value).toBeNull();
      scope.stop();
    });
  });

  describe("SDK linkage gating", () => {
    it("isLinkedToSdk is true when connected and session is active", async () => {
      const sessionIdRef = ref(SESSION_ID);
      let live!: ReturnType<typeof useLiveSdkSession>;
      const scope = effectScope();
      scope.run(() => {
        live = useLiveSdkSession(sessionIdRef);
      });
      await nextTick();

      expect(live.isLinkedToSdk.value).toBe(true);
      scope.stop();
    });

    it("isLinkedToSdk is false when SDK is not connected", async () => {
      const sessionIdRef = ref(SESSION_ID);
      let live!: ReturnType<typeof useLiveSdkSession>;
      const scope = effectScope();
      scope.run(() => {
        live = useLiveSdkSession(sessionIdRef);
      });

      sdkState.isConnected = false;
      await nextTick();

      expect(live.isLinkedToSdk.value).toBe(false);
      scope.stop();
    });

    it("isLinkedToSdk is false when session is not in sessions list", async () => {
      const sessionIdRef = ref(SESSION_ID);
      let live!: ReturnType<typeof useLiveSdkSession>;
      const scope = effectScope();
      scope.run(() => {
        live = useLiveSdkSession(sessionIdRef);
      });

      sdkState.sessions = [];
      await nextTick();

      expect(live.isLinkedToSdk.value).toBe(false);
      scope.stop();
    });

    it("isLinkedToSdk is false when session.isActive is false", async () => {
      const sessionIdRef = ref(SESSION_ID);
      let live!: ReturnType<typeof useLiveSdkSession>;
      const scope = effectScope();
      scope.run(() => {
        live = useLiveSdkSession(sessionIdRef);
      });

      sdkState.sessions = [{ sessionId: SESSION_ID, isActive: false }];
      await nextTick();

      expect(live.isLinkedToSdk.value).toBe(false);
      scope.stop();
    });

    it("flushes transient streaming state when SDK disconnects (prevents ghost thinking indicator)", async () => {
      const sessionIdRef = ref(SESSION_ID);
      let live!: ReturnType<typeof useLiveSdkSession>;
      const scope = effectScope();
      scope.run(() => {
        live = useLiveSdkSession(sessionIdRef);
      });

      // Start a turn (agent is running)
      push(makeEvent({ eventType: "assistant.turn_start", data: { turnId: "t1" } }));
      await nextTick();
      expect(live.isAgentRunning.value).toBe(true);

      // SDK disconnects — session.idle never arrives
      sdkState.isConnected = false;
      await nextTick();

      expect(live.isAgentRunning.value).toBe(false);
      expect(live.activeTools.size).toBe(0);
      scope.stop();
    });

    it("flushes transient state when session is removed from sessions list (unlink)", async () => {
      const sessionIdRef = ref(SESSION_ID);
      let live!: ReturnType<typeof useLiveSdkSession>;
      const scope = effectScope();
      scope.run(() => {
        live = useLiveSdkSession(sessionIdRef);
      });

      // Seed persistent state before the turn starts.
      push(makeEvent({ eventType: "session.model_change", data: { newModel: "claude-opus-4" } }));
      push(makeEvent({
        eventType: "session.usage_info",
        data: { currentTokens: 5000, tokenLimit: 10000, messagesLength: 20 },
      }));
      await nextTick();
      expect(live.liveModel.value).toBe("claude-opus-4");
      expect(live.tokenUsage.value).not.toBeNull();

      // Agent starts a turn
      push(makeEvent({ eventType: "assistant.turn_start", data: { turnId: "t1" } }));
      push(makeEvent({
        eventType: "tool.execution_start",
        data: { toolCallId: "tc1", toolName: "read_file", input: {}, isPipelined: false },
      }));
      await nextTick();
      expect(live.isAgentRunning.value).toBe(true);
      expect(live.activeTools.size).toBe(1);

      // User unlinks — sessions list becomes empty
      sdkState.sessions = [];
      await nextTick();

      // Transient state must be flushed
      expect(live.isAgentRunning.value).toBe(false);
      expect(live.activeTools.size).toBe(0);
      expect(live.activeTurnId.value).toBeNull();

      // Persistent state must be preserved (informational, user already saw it)
      expect(live.liveModel.value).toBe("claude-opus-4");
      expect(live.tokenUsage.value).not.toBeNull();
      scope.stop();
    });
  });

  describe("session ID change (A→B→A WeakSet replay)", () => {
    it("replays session-A events after A→B→A navigation", async () => {
      const sessionIdRef = ref(SESSION_ID);
      let live!: ReturnType<typeof useLiveSdkSession>;
      const scope = effectScope();
      scope.run(() => {
        live = useLiveSdkSession(sessionIdRef);
      });

      // Session A: receive a model_change event
      push(makeEvent({ eventType: "session.model_change", data: { newModel: "model-A" } }));
      await nextTick();
      expect(live.liveModel.value).toBe("model-A");

      // Navigate to session B
      sdkState.sessions = [{ sessionId: "session-B", isActive: true }];
      sessionIdRef.value = "session-B";
      await nextTick();
      expect(live.liveModel.value).toBeNull(); // state cleared

      // Navigate back to session A
      sdkState.sessions = [{ sessionId: SESSION_ID, isActive: true }];
      sessionIdRef.value = SESSION_ID;
      await nextTick();

      // Without WeakSet reset, seen still has the old event objects
      // and they would be skipped — liveModel would stay null.
      expect(live.liveModel.value).toBe("model-A");
      scope.stop();
    });
  });

  describe("session.error event", () => {
    it("clears streaming state and stops the agent on session.error", async () => {
      const sessionIdRef = ref(SESSION_ID);
      let live!: ReturnType<typeof useLiveSdkSession>;
      const scope = effectScope();
      scope.run(() => {
        live = useLiveSdkSession(sessionIdRef);
      });

      push(makeEvent({ eventType: "assistant.turn_start", data: { turnId: "t1" } }));
      push(makeEvent({
        eventType: "assistant.message_delta",
        ephemeral: true,
        data: { messageId: "m1", deltaContent: "partial…" },
      }));
      push(makeEvent({
        eventType: "tool.execution_start",
        data: { toolCallId: "tc1", toolName: "bash", input: {}, isPipelined: false },
      }));
      await nextTick();
      expect(live.isAgentRunning.value).toBe(true);
      expect(live.streamingMessages.size).toBe(1);
      expect(live.activeTools.size).toBe(1);

      push(makeEvent({ eventType: "session.error", data: { message: "backend error" } }));
      await nextTick();

      expect(live.isAgentRunning.value).toBe(false);
      expect(live.activeTurnId.value).toBeNull();
      expect(live.streamingMessages.size).toBe(0);
      expect(live.streamingReasoning.size).toBe(0);
      expect(live.activeTools.size).toBe(0);
      scope.stop();
    });
  });

  describe("isLinkedToSdk with null sessionId", () => {
    it("returns false when sessionId is null", async () => {
      const sessionIdRef = ref<string | null>(null);
      let live!: ReturnType<typeof useLiveSdkSession>;
      const scope = effectScope();
      scope.run(() => {
        live = useLiveSdkSession(sessionIdRef);
      });
      await nextTick();

      // sdk.sessions has an active session but the composable has no session ID
      sdkState.sessions = [{ sessionId: SESSION_ID, isActive: true }];
      await nextTick();

      expect(live.isLinkedToSdk.value).toBe(false);
      scope.stop();
    });
  });

  // ── Handoff ─────────────────────────────────────────────────────────────

  describe("handoff", () => {
    it("sets pendingHandoff on session.handoff and clearHandoff() resets it", async () => {
      const sessionIdRef = ref(SESSION_ID);
      let live!: ReturnType<typeof useLiveSdkSession>;
      const scope = effectScope();
      scope.run(() => {
        live = useLiveSdkSession(sessionIdRef);
      });

      expect(live.pendingHandoff.value).toBeNull();

      push(makeEvent({
        eventType: "session.handoff",
        data: {
          sourceType: "remote",
          repository: { owner: "acme", name: "repo", branch: "main" },
          summary: "Handing off task",
          remoteSessionId: "remote-123",
        },
      }));
      await nextTick();

      expect(live.pendingHandoff.value?.sourceType).toBe("remote");
      expect(live.pendingHandoff.value?.repository?.owner).toBe("acme");
      expect(live.pendingHandoff.value?.summary).toBe("Handing off task");

      live.clearHandoff();
      expect(live.pendingHandoff.value).toBeNull();
      scope.stop();
    });

    it("handles session.handoff with no repository info", async () => {
      const sessionIdRef = ref(SESSION_ID);
      let live!: ReturnType<typeof useLiveSdkSession>;
      const scope = effectScope();
      scope.run(() => {
        live = useLiveSdkSession(sessionIdRef);
      });

      push(makeEvent({
        eventType: "session.handoff",
        data: { sourceType: "local", repository: null, summary: null, remoteSessionId: null },
      }));
      await nextTick();

      expect(live.pendingHandoff.value?.repository).toBeNull();
      scope.stop();
    });
  });

  // ── Snapshot rewind ──────────────────────────────────────────────────────

  describe("snapshot rewind", () => {
    it("sets lastSnapshotRewind on session.snapshot_rewind and clearRewind() resets it", async () => {
      const sessionIdRef = ref(SESSION_ID);
      let live!: ReturnType<typeof useLiveSdkSession>;
      const scope = effectScope();
      scope.run(() => {
        live = useLiveSdkSession(sessionIdRef);
      });

      expect(live.lastSnapshotRewind.value).toBeNull();

      push(makeEvent({
        eventType: "session.snapshot_rewind",
        data: { eventsRemoved: 12 },
      }));
      await nextTick();

      expect(live.lastSnapshotRewind.value?.eventsRemoved).toBe(12);

      live.clearRewind();
      expect(live.lastSnapshotRewind.value).toBeNull();
      scope.stop();
    });
  });

  // ── hasLiveActivity derived ──────────────────────────────────────────────

  describe("hasLiveActivity", () => {
    it("is false initially", async () => {
      const sessionIdRef = ref(SESSION_ID);
      let live!: ReturnType<typeof useLiveSdkSession>;
      const scope = effectScope();
      scope.run(() => {
        live = useLiveSdkSession(sessionIdRef);
      });

      expect(live.hasLiveActivity.value).toBe(false);
      scope.stop();
    });

    it("is true when the agent is running", async () => {
      const sessionIdRef = ref(SESSION_ID);
      let live!: ReturnType<typeof useLiveSdkSession>;
      const scope = effectScope();
      scope.run(() => {
        live = useLiveSdkSession(sessionIdRef);
      });

      push(makeEvent({ eventType: "assistant.turn_start", data: { turnId: "t1" } }));
      await nextTick();
      expect(live.hasLiveActivity.value).toBe(true);

      push(makeEvent({ eventType: "session.idle" }));
      await nextTick();
      expect(live.hasLiveActivity.value).toBe(false);
      scope.stop();
    });

    it("is true when streaming messages are present", async () => {
      const sessionIdRef = ref(SESSION_ID);
      let live!: ReturnType<typeof useLiveSdkSession>;
      const scope = effectScope();
      scope.run(() => {
        live = useLiveSdkSession(sessionIdRef);
      });

      push(makeEvent({
        eventType: "assistant.message_delta",
        ephemeral: true,
        data: { messageId: "m1", deltaContent: "hi" },
      }));
      await nextTick();
      expect(live.hasLiveActivity.value).toBe(true);
      scope.stop();
    });

    it("is true while a tool is executing", async () => {
      const sessionIdRef = ref(SESSION_ID);
      let live!: ReturnType<typeof useLiveSdkSession>;
      const scope = effectScope();
      scope.run(() => {
        live = useLiveSdkSession(sessionIdRef);
      });

      push(makeEvent({ eventType: "tool.execution_start", data: { toolCallId: "tc1", toolName: "bash" } }));
      await nextTick();
      expect(live.hasLiveActivity.value).toBe(true);

      push(makeEvent({ eventType: "tool.execution_complete", data: { toolCallId: "tc1" } }));
      await nextTick();
      expect(live.hasLiveActivity.value).toBe(false);
      scope.stop();
    });
  });

  // ── activeAskUser ────────────────────────────────────────────────────────

  describe("activeAskUser", () => {
    it("is null when no tools are active", () => {
      const sessionIdRef = ref(SESSION_ID);
      let live!: ReturnType<typeof useLiveSdkSession>;
      const scope = effectScope();
      scope.run(() => { live = useLiveSdkSession(sessionIdRef); });

      expect(live.activeAskUser.value).toBeNull();
      scope.stop();
    });

    it("is null when only non-ask_user tools are active", async () => {
      const sessionIdRef = ref(SESSION_ID);
      let live!: ReturnType<typeof useLiveSdkSession>;
      const scope = effectScope();
      scope.run(() => { live = useLiveSdkSession(sessionIdRef); });

      push(makeEvent({ eventType: "tool.execution_start", data: { toolCallId: "tc1", toolName: "read_file", arguments: {} } }));
      await nextTick();

      expect(live.activeAskUser.value).toBeNull();
      scope.stop();
    });

    it("returns toolCallId and question when ask_user is active", async () => {
      const sessionIdRef = ref(SESSION_ID);
      let live!: ReturnType<typeof useLiveSdkSession>;
      const scope = effectScope();
      scope.run(() => { live = useLiveSdkSession(sessionIdRef); });

      push(makeEvent({
        eventType: "tool.execution_start",
        data: { toolCallId: "au1", toolName: "ask_user", arguments: { question: "What is your name?" } },
      }));
      await nextTick();

      expect(live.activeAskUser.value).toEqual({ toolCallId: "au1", question: "What is your name?" });
      scope.stop();
    });

    it("returns null question when arguments lack a question field", async () => {
      const sessionIdRef = ref(SESSION_ID);
      let live!: ReturnType<typeof useLiveSdkSession>;
      const scope = effectScope();
      scope.run(() => { live = useLiveSdkSession(sessionIdRef); });

      push(makeEvent({
        eventType: "tool.execution_start",
        data: { toolCallId: "au2", toolName: "ask_user", arguments: null },
      }));
      await nextTick();

      expect(live.activeAskUser.value).toEqual({ toolCallId: "au2", question: null });
      scope.stop();
    });

    it("returns null once ask_user tool completes", async () => {
      const sessionIdRef = ref(SESSION_ID);
      let live!: ReturnType<typeof useLiveSdkSession>;
      const scope = effectScope();
      scope.run(() => { live = useLiveSdkSession(sessionIdRef); });

      push(makeEvent({ eventType: "tool.execution_start", data: { toolCallId: "au3", toolName: "ask_user", arguments: { question: "Ready?" } } }));
      await nextTick();
      expect(live.activeAskUser.value?.toolCallId).toBe("au3");

      push(makeEvent({ eventType: "tool.execution_complete", data: { toolCallId: "au3" } }));
      await nextTick();
      expect(live.activeAskUser.value).toBeNull();
      scope.stop();
    });

    it("returns first ask_user when multiple ask_user calls are somehow active simultaneously", async () => {
      const sessionIdRef = ref(SESSION_ID);
      let live!: ReturnType<typeof useLiveSdkSession>;
      const scope = effectScope();
      scope.run(() => { live = useLiveSdkSession(sessionIdRef); });

      push(makeEvent({ eventType: "tool.execution_start", data: { toolCallId: "au4", toolName: "ask_user", arguments: { question: "First?" } } }));
      push(makeEvent({ eventType: "tool.execution_start", data: { toolCallId: "au5", toolName: "ask_user", arguments: { question: "Second?" } } }));
      await nextTick();

      // Should return one of the two (both are valid; just not null)
      expect(live.activeAskUser.value).not.toBeNull();
      expect(["First?", "Second?"]).toContain(live.activeAskUser.value?.question);
      scope.stop();
    });
  });
});
