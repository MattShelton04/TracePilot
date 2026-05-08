import type { ConversationTurn, SessionLiveState } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import { effectScope, ref } from "vue";
import type { SdkLiveTurn } from "@/stores/sdk/liveTurns";
import { useLiveConversationTurn } from "../useLiveConversationTurn";

function makeLiveTurn(partial: Partial<SdkLiveTurn> = {}): SdkLiveTurn {
  return {
    sessionId: "s1",
    turnId: null,
    assistantText: "",
    reasoningText: "",
    assistantCommitted: "",
    reasoningCommitted: "",
    assistantPending: [],
    reasoningPending: [],
    assistantFinalized: false,
    reasoningFinalized: false,
    updatedAt: "2025-01-01T00:00:00Z",
    ...partial,
  };
}

function makePersistedTurn(partial: Partial<ConversationTurn> = {}): ConversationTurn {
  return {
    turnIndex: 0,
    assistantMessages: [],
    toolCalls: [],
    isComplete: true,
    ...partial,
  };
}

function makeLiveState(partial: Partial<SessionLiveState> = {}): SessionLiveState {
  return {
    sessionId: "s1",
    status: "running",
    currentTurnId: null,
    assistantText: "",
    reasoningText: "",
    tools: [],
    usage: null,
    pendingPermission: null,
    pendingUserInput: null,
    lastEventId: null,
    lastEventType: null,
    lastEventTimestamp: null,
    lastError: null,
    reducerWarnings: [],
    ...partial,
  };
}

describe("useLiveConversationTurn", () => {
  it("creates a synthetic live turn from incoming SDK live event", () => {
    const sessionId = ref<string | null>("s1");
    const persisted = ref<ConversationTurn[]>([
      makePersistedTurn({ turnIndex: 3, isComplete: true }),
    ]);
    const live = ref<Record<string, SdkLiveTurn>>({
      s1: makeLiveTurn({ assistantText: "hi", updatedAt: "2025-01-01T00:00:01Z" }),
    });
    const states = ref<Record<string, SessionLiveState>>({});

    const scope = effectScope();
    let api!: ReturnType<typeof useLiveConversationTurn>;
    scope.run(() => {
      api = useLiveConversationTurn({
        sessionId: () => sessionId.value,
        persistedTurns: () => persisted.value,
        liveTurnsBySessionId: () => live.value,
        sessionStatesById: () => states.value,
        clearLiveTurn: () => {},
      });
    });

    const turn = api.liveConversationTurn.value;
    expect(turn).not.toBeNull();
    expect(turn?.turnIndex).toBe(4);
    expect(turn?.assistantMessages).toEqual([{ content: "hi" }]);
    expect(turn?.isComplete).toBe(false);
    expect(api.turns.value).toHaveLength(2);
    expect(api.turns.value[1]).toBe(turn);

    scope.stop();
  });

  it("subsequent partial events update the same synthetic turn (no extra append)", () => {
    const sessionId = ref<string | null>("s1");
    const persisted = ref<ConversationTurn[]>([]);
    const live = ref<Record<string, SdkLiveTurn>>({
      s1: makeLiveTurn({ assistantText: "he", updatedAt: "t1" }),
    });
    const states = ref<Record<string, SessionLiveState>>({});

    const scope = effectScope();
    let api!: ReturnType<typeof useLiveConversationTurn>;
    scope.run(() => {
      api = useLiveConversationTurn({
        sessionId: () => sessionId.value,
        persistedTurns: () => persisted.value,
        liveTurnsBySessionId: () => live.value,
        sessionStatesById: () => states.value,
        clearLiveTurn: () => {},
      });
    });

    expect(api.liveConversationTurn.value?.assistantMessages[0].content).toBe("he");
    expect(api.turns.value).toHaveLength(1);

    // Streaming continues: same session, longer text. New ref to trigger update.
    live.value = {
      s1: makeLiveTurn({ assistantText: "hello", updatedAt: "t2" }),
    };
    expect(api.liveConversationTurn.value?.assistantMessages[0].content).toBe("hello");
    expect(api.turns.value).toHaveLength(1);

    scope.stop();
  });

  it("hides the live turn once a persisted turn supersedes it (final-event closes the turn)", async () => {
    const sessionId = ref<string | null>("s1");
    const persisted = ref<ConversationTurn[]>([]);
    const live = ref<Record<string, SdkLiveTurn>>({
      s1: makeLiveTurn({ assistantText: "hello", updatedAt: "t1" }),
    });
    const states = ref<Record<string, SessionLiveState>>({});
    const cleared: string[] = [];

    const scope = effectScope();
    let api!: ReturnType<typeof useLiveConversationTurn>;
    scope.run(() => {
      api = useLiveConversationTurn({
        sessionId: () => sessionId.value,
        persistedTurns: () => persisted.value,
        liveTurnsBySessionId: () => live.value,
        sessionStatesById: () => states.value,
        clearLiveTurn: (sid) => cleared.push(sid),
      });
    });

    expect(api.liveConversationTurn.value).not.toBeNull();

    // Persisted turn lands with the same prefix → live turn should be hidden.
    persisted.value = [
      makePersistedTurn({
        turnIndex: 1,
        assistantMessages: [{ content: "hello world" }],
        isComplete: true,
      }),
    ];

    expect(api.liveConversationTurn.value).toBeNull();
    expect(api.turns.value).toEqual(persisted.value);

    // Watcher fires after a microtask tick.
    await Promise.resolve();
    expect(cleared).toEqual(["s1"]);

    scope.stop();
  });

  it("ignores live entries belonging to a different session", () => {
    const sessionId = ref<string | null>("s1");
    const persisted = ref<ConversationTurn[]>([]);
    const live = ref<Record<string, SdkLiveTurn>>({
      "other-session": makeLiveTurn({
        sessionId: "other-session",
        assistantText: "leak?",
      }),
    });
    const states = ref<Record<string, SessionLiveState>>({});
    const cleared: string[] = [];

    const scope = effectScope();
    let api!: ReturnType<typeof useLiveConversationTurn>;
    scope.run(() => {
      api = useLiveConversationTurn({
        sessionId: () => sessionId.value,
        persistedTurns: () => persisted.value,
        liveTurnsBySessionId: () => live.value,
        sessionStatesById: () => states.value,
        clearLiveTurn: (sid) => cleared.push(sid),
      });
    });

    expect(api.liveConversationTurn.value).toBeNull();
    expect(api.turns.value).toEqual([]);
    expect(cleared).toEqual([]);

    scope.stop();
  });

  it("returns null and empty tool-output map when sessionId is missing", () => {
    const sessionId = ref<string | null>(null);
    const persisted = ref<ConversationTurn[]>([]);
    const live = ref<Record<string, SdkLiveTurn>>({
      s1: makeLiveTurn({ assistantText: "ignored" }),
    });
    const states = ref<Record<string, SessionLiveState>>({});

    const scope = effectScope();
    let api!: ReturnType<typeof useLiveConversationTurn>;
    scope.run(() => {
      api = useLiveConversationTurn({
        sessionId: () => sessionId.value,
        persistedTurns: () => persisted.value,
        liveTurnsBySessionId: () => live.value,
        sessionStatesById: () => states.value,
        clearLiveTurn: () => {},
      });
    });

    expect(api.liveConversationTurn.value).toBeNull();
    expect(api.liveToolPartialOutputs.value.size).toBe(0);

    scope.stop();
  });

  it("exposes streaming tool partial output keyed by toolCallId", () => {
    const sessionId = ref<string | null>("s1");
    const persisted = ref<ConversationTurn[]>([]);
    const live = ref<Record<string, SdkLiveTurn>>({});
    const states = ref<Record<string, SessionLiveState>>({
      s1: makeLiveState({
        tools: [
          {
            toolCallId: "tc-1",
            toolName: "shell",
            status: "running",
            message: null,
            progress: null,
            partialResult: "stdout chunk\n",
            updatedAt: "t1",
          },
          {
            toolCallId: null,
            toolName: "ignored",
            status: "running",
            message: null,
            progress: null,
            partialResult: "x",
            updatedAt: "t1",
          },
          {
            toolCallId: "tc-empty",
            toolName: "noop",
            status: "running",
            message: null,
            progress: null,
            partialResult: null,
            updatedAt: "t1",
          },
          {
            toolCallId: "tc-obj",
            toolName: "json",
            status: "running",
            message: null,
            progress: null,
            partialResult: { lines: ["a", "b"] },
            updatedAt: "t1",
          },
        ],
      }),
    });

    const scope = effectScope();
    let api!: ReturnType<typeof useLiveConversationTurn>;
    scope.run(() => {
      api = useLiveConversationTurn({
        sessionId: () => sessionId.value,
        persistedTurns: () => persisted.value,
        liveTurnsBySessionId: () => live.value,
        sessionStatesById: () => states.value,
        clearLiveTurn: () => {},
      });
    });

    const map = api.liveToolPartialOutputs.value;
    expect(map.size).toBe(2);
    expect(map.get("tc-1")).toBe("stdout chunk\n");
    expect(map.get("tc-obj")).toBe(JSON.stringify({ lines: ["a", "b"] }, null, 2));

    scope.stop();
  });

  it("dispose() stops the cleanup watcher", async () => {
    const sessionId = ref<string | null>("s1");
    const persisted = ref<ConversationTurn[]>([]);
    const live = ref<Record<string, SdkLiveTurn>>({
      s1: makeLiveTurn({ assistantText: "hello" }),
    });
    const states = ref<Record<string, SessionLiveState>>({});
    const cleared: string[] = [];

    const scope = effectScope();
    let api!: ReturnType<typeof useLiveConversationTurn>;
    scope.run(() => {
      api = useLiveConversationTurn({
        sessionId: () => sessionId.value,
        persistedTurns: () => persisted.value,
        liveTurnsBySessionId: () => live.value,
        sessionStatesById: () => states.value,
        clearLiveTurn: (sid) => cleared.push(sid),
      });
    });

    api.dispose();

    // After dispose, supersede the live turn — watcher should NOT fire.
    persisted.value = [
      makePersistedTurn({
        turnIndex: 1,
        assistantMessages: [{ content: "hello world" }],
        isComplete: true,
      }),
    ];
    await Promise.resolve();
    expect(cleared).toEqual([]);

    scope.stop();
  });
});
