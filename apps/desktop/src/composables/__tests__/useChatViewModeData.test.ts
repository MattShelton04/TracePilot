import type { ConversationTurn, SessionLiveState } from "@tracepilot/types";
import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, nextTick, ref, shallowReactive } from "vue";
import type { SdkLiveTurn } from "@/stores/sdk/liveTurns";

const detail = shallowReactive({
  sessionId: "s1" as string | null,
  turns: [] as ConversationTurn[],
});
const sdk = shallowReactive({
  liveTurnsBySessionId: {} as Record<string, SdkLiveTurn>,
  sessionStatesById: {} as Record<string, SessionLiveState>,
  clearLiveTurn: vi.fn((sessionId: string) => {
    const next = { ...sdk.liveTurnsBySessionId };
    delete next[sessionId];
    sdk.liveTurnsBySessionId = next;
  }),
});

vi.mock("@/composables/useSessionDetailContext", () => ({
  useSessionDetailContext: () => detail,
}));
vi.mock("@/stores/sdk", () => ({ useSdkStore: () => sdk }));
vi.mock("@/stores/preferences", () => ({
  usePreferencesStore: () => ({ isFeatureEnabled: () => true }),
}));
vi.mock("@/components/conversation/chatViewUtils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/conversation/chatViewUtils")>();
  return { ...actual, segmentToolCalls: vi.fn(actual.segmentToolCalls) };
});
vi.mock("@/components/conversation/sessionEventPairing", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/conversation/sessionEventPairing")>();
  return { ...actual, pairPermissionEvents: vi.fn(actual.pairPermissionEvents) };
});

import { segmentToolCalls } from "@/components/conversation/chatViewUtils";
import { pairPermissionEvents } from "@/components/conversation/sessionEventPairing";
import { useChatViewModeData } from "../useChatViewModeData";

function makeTurn(turnIndex: number, partial: Partial<ConversationTurn> = {}): ConversationTurn {
  return {
    turnIndex,
    assistantMessages: [{ content: `saved ${turnIndex}` }],
    toolCalls: [{ toolCallId: `tool-${turnIndex}`, toolName: "view", isComplete: true }],
    sessionEvents: [{ eventType: "session.info", severity: "info", summary: `event ${turnIndex}` }],
    isComplete: true,
    ...partial,
  };
}

function makeLiveTurn(partial: Partial<SdkLiveTurn> = {}): SdkLiveTurn {
  return {
    sessionId: "s1",
    turnId: "live",
    assistantText: "streamed text",
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

describe("useChatViewModeData streaming derivations", () => {
  let wrapper: VueWrapper | undefined;
  let reducedMotion: boolean;

  function mountHarness(root: HTMLElement | null = null) {
    let api!: ReturnType<typeof useChatViewModeData>;
    wrapper = mount(
      defineComponent({
        setup() {
          api = useChatViewModeData(ref(root));
          return () => null;
        },
      }),
    );
    return api;
  }

  beforeEach(() => {
    detail.sessionId = "s1";
    detail.turns = [];
    sdk.liveTurnsBySessionId = {};
    sdk.sessionStatesById = {};
    vi.clearAllMocks();
    reducedMotion = false;
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: reducedMotion })),
    );
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each([false, true])("reveals a collapsed tool with reduced motion %s", async (reduced) => {
    vi.useFakeTimers();
    reducedMotion = reduced;
    const root = document.createElement("div");
    root.innerHTML = '<div data-collapse-key="3-tools"><button data-event-idx="11"></button></div>';
    const target = root.querySelector<HTMLElement>("[data-event-idx]")!;
    target.scrollIntoView = vi.fn();
    const api = mountHarness(root);

    api.revealEvent(3, 11);
    expect(api.expandedGroups.has("3-tools")).toBe(true);
    expect(target.scrollIntoView).not.toHaveBeenCalled();
    await nextTick();

    expect(target.scrollIntoView).toHaveBeenCalledWith({
      behavior: reduced ? "auto" : "smooth",
      block: "center",
    });
    expect(target.classList.contains("cv-highlight")).toBe(true);
    vi.advanceTimersByTime(4000);
    expect(target.classList.contains("cv-highlight")).toBe(false);
  });

  it("reads motion changes after a missing turn is retried and before nextTick scrolling", async () => {
    vi.useFakeTimers();
    const root = document.createElement("div");
    const api = mountHarness(root);
    api.revealEvent(3);
    await nextTick();

    const target = document.createElement("div");
    target.dataset.turnIdx = "3";
    target.scrollIntoView = vi.fn();
    root.appendChild(target);
    api.revealEvent(3);
    reducedMotion = true;
    await nextTick();
    expect(target.scrollIntoView).toHaveBeenLastCalledWith({ behavior: "auto", block: "center" });

    api.revealEvent(3);
    reducedMotion = false;
    await nextTick();
    expect(target.scrollIntoView).toHaveBeenLastCalledWith({ behavior: "smooth", block: "center" });
  });

  it("does not re-segment or re-pair persisted history for each live text delta", async () => {
    detail.turns = Array.from({ length: 500 }, (_, index) => makeTurn(index));
    sdk.liveTurnsBySessionId = { s1: makeLiveTurn() };
    const api = mountHarness();
    const saved = detail.turns[0];
    const savedRender = api.renderDataFor(saved);
    const savedPermissions = api.permissionDataFor(saved);
    expect(api.findToolCallIndex(saved, saved.toolCalls[0])).toBe(0);
    api.getArgsSummary(saved.turnIndex, 0);
    await nextTick();
    vi.mocked(segmentToolCalls).mockClear();
    vi.mocked(pairPermissionEvents).mockClear();

    for (let delta = 0; delta < 100; delta++) {
      sdk.liveTurnsBySessionId = { s1: makeLiveTurn({ assistantText: `streamed text ${delta}` }) };
      const live = api.turns.value[500];
      expect(api.renderDataFor(live).messages[0].content).toBe(`streamed text ${delta}`);
      expect(api.renderDataFor(saved)).toBe(savedRender);
      expect(api.permissionDataFor(saved)).toBe(savedPermissions);
      expect(api.permissionDataFor(live).entries).toEqual([]);
      expect(api.findToolCallIndex(saved, saved.toolCalls[0])).toBe(0);
      api.getArgsSummary(saved.turnIndex, 0);
      await nextTick();
    }

    expect(segmentToolCalls).toHaveBeenCalledTimes(100);
    expect(pairPermissionEvents).not.toHaveBeenCalled();
  });

  it("refreshes historical render and permission data after late subagent attribution", async () => {
    const launch = makeTurn(0);
    const child = makeTurn(1);
    detail.turns = [launch, child, makeTurn(2)];
    sdk.liveTurnsBySessionId = { s1: makeLiveTurn() };
    const api = mountHarness();
    expect(api.renderDataFor(launch).segments[0].type).toBe("tool-group");
    expect(api.renderDataFor(child).messages).toHaveLength(1);

    const attributedLaunch = makeTurn(0, {
      toolCalls: [{ ...launch.toolCalls[0], isSubagent: true }],
      sessionEvents: [
        {
          eventType: "permission.completed",
          severity: "info",
          summary: "approved",
          requestId: "permission-0",
          toolCallId: "tool-0",
          resultKind: "approved",
        },
      ],
    });
    const attributedChild = makeTurn(1, {
      toolCalls: [{ ...child.toolCalls[0], parentToolCallId: "tool-0" }],
      assistantMessages: [{ content: "child answer", parentToolCallId: "tool-0" }],
      reasoningTexts: [{ content: "child thought", parentToolCallId: "tool-0" }],
    });
    detail.turns = [attributedLaunch, attributedChild, detail.turns[2]];
    await nextTick();

    expect(api.renderDataFor(attributedLaunch).segments[0].type).toBe("subagent-group");
    expect(api.renderDataFor(attributedChild)).toEqual({
      messages: [],
      reasoning: [],
      segments: [],
    });
    expect(
      api.permissionDataFor(attributedLaunch).permissionByToolCallId.get("tool-0")?.completed
        ?.resultKind,
    ).toBe("approved");
    expect(api.subagentMap.value.get("tool-0")?.childMessages[0].content).toBe("child answer");
    expect(api.subagentMap.value.get("tool-0")?.childTools[0].toolCallId).toBe("tool-1");
    expect(api.findToolCallIndex(attributedChild, attributedChild.toolCalls[0])).toBe(0);
  });

  it("preserves collapsed reasoning when the live tail is replaced by its saved turn", async () => {
    detail.turns = [makeTurn(0)];
    sdk.liveTurnsBySessionId = { s1: makeLiveTurn({ reasoningText: "thinking" }) };
    const api = mountHarness();
    const live = api.turns.value[1];
    expect(api.renderDataFor(live).reasoning).toEqual(["thinking"]);
    await nextTick();
    expect(api.expandedReasoning.has("1-main-0")).toBe(true);
    api.expandedReasoning.toggle("1-main-0");

    const saved = makeTurn(1, {
      assistantMessages: [{ content: "streamed text" }],
      reasoningTexts: [{ content: "thinking" }],
      toolCalls: [{ toolCallId: "new-tool", toolName: "view", isComplete: false }],
    });
    detail.turns = [...detail.turns, saved];
    sdk.liveTurnsBySessionId = {
      s1: makeLiveTurn({
        reasoningText: "thinking",
        assistantFinalized: true,
        reasoningFinalized: true,
      }),
    };
    await nextTick();

    expect(api.turns.value).toEqual(detail.turns);
    expect(api.renderDataFor(saved).reasoning).toEqual(["thinking"]);
    expect(api.expandedReasoning.has("1-main-0")).toBe(false);
    expect(api.expandedToolDetails.has("1-0")).toBe(true);
    expect(api.permissionDataFor(saved).entries).toHaveLength(1);
    expect(sdk.clearLiveTurn).toHaveBeenCalledWith("s1");
  });

  it("keeps the live tail last on turn-index collisions and restores persisted lookups", async () => {
    const earlier = makeTurn(2);
    const last = makeTurn(1);
    detail.turns = [earlier, last];
    sdk.liveTurnsBySessionId = { s1: makeLiveTurn() };
    const api = mountHarness();
    expect(api.turns.value[2].turnIndex).toBe(2);
    expect(api.renderDataFor(earlier).messages[0].content).toBe("streamed text");
    expect(api.permissionDataFor(earlier).entries).toEqual([]);

    sdk.liveTurnsBySessionId = {};
    await nextTick();
    expect(api.renderDataFor(earlier).messages[0].content).toBe("saved 2");
    expect(api.permissionDataFor(earlier).entries).toHaveLength(1);
  });
});
