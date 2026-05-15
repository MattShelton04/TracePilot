import type { ConversationTurn } from "@tracepilot/types";
import {
  LIVE_TOOL_PARTIAL_OUTPUT_KEY,
  useConversationSections,
  useToggleSet,
} from "@tracepilot/ui";
import { computed, nextTick, provide, type Ref, watch } from "vue";
import {
  getMainMessages,
  getMainReasoning,
  segmentToolCalls,
  type ToolSegment,
} from "@/components/conversation/chatViewUtils";
import {
  type PermissionPair,
  pairPermissionEvents,
} from "@/components/conversation/sessionEventPairing";
import { useCrossTurnSubagents } from "@/composables/useCrossTurnSubagents";
import { useLiveConversationTurn } from "@/composables/useLiveConversationTurn";
import { useSessionDetailContext } from "@/composables/useSessionDetailContext";
import { useSubagentCompletions } from "@/composables/useSubagentCompletions";
import { useSubagentPanel } from "@/composables/useSubagentPanel";
import { useToolResultLoader } from "@/composables/useToolResultLoader";
import { usePreferencesStore } from "@/stores/preferences";
import { useSdkStore } from "@/stores/sdk";
import { mapByTurnIndex } from "@/utils/turnMaps";

export interface TurnRenderData {
  reasoning: string[];
  messages: ReturnType<typeof getMainMessages>;
  segments: ToolSegment[];
}

export interface TurnPermissionData {
  entries: ReturnType<typeof pairPermissionEvents>["entries"];
  permissionByToolCallId: Map<string, PermissionPair>;
}

const EMPTY_RENDER_DATA: TurnRenderData = { reasoning: [], messages: [], segments: [] };

/**
 * State + derived data for `ChatViewMode`.
 *
 * Owns the live-turn merge, per-turn render/permission maps, disclosure
 * toggle sets, tool-result loader, subagent panel + completions, and the
 * deep-link `revealEvent` coordinator. Extracted from the SFC so the
 * template-facing `<script setup>` stays under the file-size budget.
 *
 * Mirrors the `useSkillEditor` / `useConfigInjector` pattern: all reactivity
 * lives here, the SFC is a thin shell wiring this composable into the
 * template.
 */
export function useChatViewModeData(rootEl: Ref<HTMLElement | null>) {
  const store = useSessionDetailContext();
  const sdk = useSdkStore();
  const preferences = usePreferencesStore();

  const persistedTurns = computed(() => store.turns);

  const { turns, liveToolPartialOutputs } = useLiveConversationTurn({
    sessionId: () => store.sessionId,
    persistedTurns: () => persistedTurns.value,
    liveTurnsBySessionId: () => sdk.liveTurnsBySessionId,
    sessionStatesById: () => sdk.sessionStatesById,
    clearLiveTurn: (sessionId) => sdk.clearLiveTurn(sessionId),
  });

  const renderMd = computed(() => preferences.isFeatureEnabled("renderMarkdown"));

  // Provided into the tool-detail tree via injection so streaming stdout for
  // in-flight tool calls surfaces inline on the persisted tool call without
  // prop-drilling.
  provide(LIVE_TOOL_PARTIAL_OUTPUT_KEY, liveToolPartialOutputs);

  // ─── Cross-turn subagent data ─────────────────────────────────────
  const { subagentMap, allSubagents } = useCrossTurnSubagents(persistedTurns);

  // ─── Panel state ──────────────────────────────────────────────────
  const panel = useSubagentPanel(allSubagents);

  // ─── Disclosure state ─────────────────────────────────────────────
  const expandedReasoning = useToggleSet<string>();
  const expandedGroups = useToggleSet<string>();
  const expandedToolDetails = useToggleSet<string>();

  const isSdkSteered = computed<boolean>(() => {
    const sid = store.sessionId;
    if (!sid) return false;
    return sdk.sessionStatesById[sid] != null || sdk.liveTurnsBySessionId[sid] != null;
  });

  // ─── Tool result loader ───────────────────────────────────────────
  const {
    fullResults,
    loadingResults,
    failedResults,
    loadFullResult: handleLoadFullResult,
    retryFullResult: handleRetryResult,
  } = useToolResultLoader(() => store.sessionId);

  // ─── Conversation sections (for tool call index) ─────────────────
  const { findToolCallIndex, getArgsSummary } = useConversationSections(() => turns.value);

  // Auto-expand in-progress tool calls so users can watch live progress
  // without an extra click. Once added, the key stays in the set across
  // completion (so the panel stays open until the user manually collapses).
  watch(
    turns,
    (currentTurns) => {
      for (const turn of currentTurns) {
        const calls = turn.toolCalls ?? [];
        for (const tc of calls) {
          if (tc.isComplete !== false) continue;
          const idx = findToolCallIndex(turn, tc);
          if (idx < 0) continue;
          const key = `${turn.turnIndex}-${idx}`;
          if (!expandedToolDetails.has(key)) expandedToolDetails.add(key);
        }
      }
    },
    { immediate: true, deep: false },
  );

  // ─── Memoized per-turn render data ────────────────────────────────
  // Computed once when turns change, avoids re-segmenting on every render.
  const turnRenderData = computed(() =>
    mapByTurnIndex<TurnRenderData>(turns.value, (turn) => ({
      reasoning: getMainReasoning(turn),
      messages: getMainMessages(turn),
      segments: segmentToolCalls(turn.toolCalls),
    })),
  );

  function renderDataFor(turn: ConversationTurn): TurnRenderData {
    return turnRenderData.value.get(turn.turnIndex) ?? EMPTY_RENDER_DATA;
  }

  // Auto-expand reasoning blocks once per turn for SDK-steered sessions so
  // streaming "thinking" content is visible without an extra click and stays
  // expanded after the turn finalizes (same turnIndex carries the toggle).
  // We track which keys we've auto-seeded so a user-initiated collapse isn't
  // re-opened on the next render.
  const autoExpandedReasoningKeys = new Set<string>();
  watch(
    [turnRenderData, isSdkSteered],
    ([renderMap, steered]) => {
      if (!steered) return;
      for (const [turnIndex, data] of renderMap) {
        for (let rIdx = 0; rIdx < data.reasoning.length; rIdx++) {
          const key = `${turnIndex}-main-${rIdx}`;
          if (autoExpandedReasoningKeys.has(key)) continue;
          autoExpandedReasoningKeys.add(key);
          if (!expandedReasoning.has(key)) expandedReasoning.toggle(key);
        }
      }
    },
    { immediate: true },
  );

  // ─── Per-turn permission events (paired + tool-call attached) ────
  // Pairing runs once per turns change. Pairs whose toolCallId matches a
  // rendered tool call are extracted into a per-toolCallId map; the
  // remaining (orphan) entries flow through the timeline as standalone
  // permission cards. Computed up-front so we don't re-pair on every render.
  const turnPermissionData = computed(() =>
    mapByTurnIndex<TurnPermissionData>(turns.value, (turn) => {
      const events = turn.sessionEvents ?? [];
      if (events.length === 0) {
        return { entries: [], permissionByToolCallId: new Map() };
      }
      const tcIds = new Set<string>();
      for (const tc of turn.toolCalls) {
        if (tc.toolCallId) tcIds.add(tc.toolCallId);
      }
      return pairPermissionEvents(events, tcIds);
    }),
  );

  function permissionDataFor(turn: ConversationTurn): TurnPermissionData {
    return (
      turnPermissionData.value.get(turn.turnIndex) ?? {
        entries: [],
        permissionByToolCallId: new Map(),
      }
    );
  }

  // ─── toolCallId → turnIndex index (O(1) lookups) ─────────────────
  const toolCallTurnIndex = computed(() => {
    const map = new Map<string, number>();
    for (const turn of turns.value) {
      for (const tc of turn.toolCalls) {
        if (tc.toolCallId) {
          map.set(tc.toolCallId, turn.turnIndex);
        }
      }
    }
    return map;
  });

  // ─── Subagent completions + turn colors ───────────────────────────
  const { completionsByTurn, completionLabel, subagentTurnColors } = useSubagentCompletions(
    turns,
    subagentMap,
    allSubagents,
    toolCallTurnIndex,
  );

  // ─── Gap helpers ──────────────────────────────────────────────────
  function showGap(turn: ConversationTurn, ti: number): boolean {
    if (ti === 0) return false;
    return turn.turnIndex - turns.value[ti - 1].turnIndex > 1;
  }

  function gapCount(turn: ConversationTurn, ti: number): number {
    return turn.turnIndex - turns.value[ti - 1].turnIndex - 1;
  }

  // ─── Deep-link: revealEvent ───────────────────────────────────────

  /**
   * Resolve an eventIndex to its owning subagent (if it's a child tool call).
   * Returns the subagent's toolCallId, or null if the event is not a child.
   */
  function findOwningSubagent(turnIndex: number, eventIndex: number): string | null {
    const turn = turns.value.find((t) => t.turnIndex === turnIndex);
    if (!turn) return null;
    const tc = turn.toolCalls.find((t) => t.eventIndex === eventIndex);
    if (!tc) return null;
    // If this IS a subagent launch, return its own toolCallId
    if (tc.isSubagent && tc.toolCallId) return tc.toolCallId;
    // If this is a child tool call, return its parent
    if (tc.parentToolCallId && subagentMap.value.has(tc.parentToolCallId)) {
      return tc.parentToolCallId;
    }
    return null;
  }

  function revealEvent(turnIndex: number, eventIndex?: number) {
    const root = rootEl.value;
    if (!root) return;

    const elId =
      eventIndex != null ? `[data-event-idx="${eventIndex}"]` : `[data-turn-idx="${turnIndex}"]`;
    let el = root.querySelector<HTMLElement>(elId);

    // If event not in DOM, check if it belongs to a subagent and open the panel
    if (!el && eventIndex != null) {
      const agentId = findOwningSubagent(turnIndex, eventIndex);
      if (agentId) {
        panel.selectSubagent(agentId);
        // Scroll to the subagent card wrapper instead
        const cardEl = root.querySelector<HTMLElement>(`[data-agent-id="${agentId}"]`);
        if (cardEl) el = cardEl;
      }
    }

    if (!el) {
      // Final fallback: scroll to the turn block
      el = root.querySelector<HTMLElement>(`[data-turn-idx="${turnIndex}"]`);
      if (!el) return;
    }

    // If the element is inside a collapsed group, expand it
    const collapsedParent = el.closest("[data-collapse-key]") as HTMLElement | null;
    if (collapsedParent) {
      const key = collapsedParent.dataset.collapseKey;
      if (key && !expandedGroups.has(key)) {
        expandedGroups.toggle(key);
      }
    }

    // If tool call belongs to a subagent, open the panel
    const agentEl = el.closest("[data-agent-id]") as HTMLElement | null;
    if (agentEl) {
      const agentId = agentEl.dataset.agentId;
      if (agentId) {
        panel.selectSubagent(agentId);
      }
    }

    nextTick(() => {
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      el?.classList.add("cv-highlight");
      setTimeout(() => el?.classList.remove("cv-highlight"), 4000);
    });
  }

  return {
    store,
    turns,
    renderMd,
    allSubagents,
    subagentMap,
    panel,
    expandedReasoning,
    expandedGroups,
    expandedToolDetails,
    fullResults,
    loadingResults,
    failedResults,
    handleLoadFullResult,
    handleRetryResult,
    findToolCallIndex,
    getArgsSummary,
    completionsByTurn,
    completionLabel,
    subagentTurnColors,
    renderDataFor,
    permissionDataFor,
    showGap,
    gapCount,
    revealEvent,
  };
}
