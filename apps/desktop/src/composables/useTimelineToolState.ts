import type { ConversationTurn, TurnToolCall } from "@tracepilot/types";
import { useToggleSet } from "@tracepilot/ui";
import type { ComputedRef, Ref } from "vue";
import { computed, ref, watch } from "vue";
import { usePreferencesStore } from "@/stores/preferences";
import { useSessionDetailStore } from "@/stores/sessionDetail";
import { useToolResultLoader } from "./useToolResultLoader";

/**
 * Options for configuring useTimelineToolState behavior.
 */
export interface UseTimelineToolStateOptions {
  /**
   * Optional custom function to determine if a tool belongs to a specific turn.
   * Used for the turnOwnsSelected helper.
   *
   * @param turn - The turn to check
   * @param tool - The tool to check
   * @returns true if the tool belongs to the turn
   */
  turnOwnershipCheck?: (turn: ConversationTurn, tool: TurnToolCall) => boolean;
}

/**
 * Return type for useTimelineToolState composable.
 */
export interface UseTimelineToolStateReturn {
  // Store refs
  /** SessionDetail store instance */
  store: ReturnType<typeof useSessionDetailStore>;
  /** Preferences store instance */
  prefs: ReturnType<typeof usePreferencesStore>;

  // Tool result loading
  /** Map of tool call IDs to their full result data */
  fullResults: ReturnType<typeof useToolResultLoader>["fullResults"];
  /** Set of tool call IDs currently loading their full results */
  loadingResults: ReturnType<typeof useToolResultLoader>["loadingResults"];
  /** Set of tool call IDs that failed to load their full results */
  failedResults: ReturnType<typeof useToolResultLoader>["failedResults"];
  /** Function to load full result for a tool call ID */
  loadFullResult: ReturnType<typeof useToolResultLoader>["loadFullResult"];
  /** Function to retry loading a failed tool call result */
  retryFullResult: ReturnType<typeof useToolResultLoader>["retryFullResult"];

  // Expansion state
  /** Toggle set for expanded tool call args/results */
  expandedToolCalls: ReturnType<typeof useToggleSet<string>>;
  /** Toggle set for expanded reasoning/thinking sections */
  expandedReasoning: ReturnType<typeof useToggleSet<string>>;
  /** Toggle set for expanded output sections */
  expandedOutputs: ReturnType<typeof useToggleSet<string>>;

  // Tool call collection
  /** All tool calls from all turns (flattened) */
  allToolCalls: ComputedRef<TurnToolCall[]>;

  // Selected tool management
  /** Currently selected tool (null if none selected) */
  selectedTool: Ref<TurnToolCall | null>;
  /** Select or toggle a tool */
  selectTool: (tc: TurnToolCall) => void;
  /** Check if a tool is currently selected */
  isToolSelected: (tc: TurnToolCall) => boolean;
  /** Clear the current selection */
  clearSelection: () => void;

  /**
   * Helper to check if the selected tool belongs to a specific turn.
   * Only available if turnOwnershipCheck was provided in options.
   */
  turnOwnsSelected?: (turn: ConversationTurn) => boolean;

  /** Clear all expansion and selection state */
  clearAllState: () => void;
}

/**
 * Composable for managing shared state across timeline visualization components.
 *
 * Consolidates:
 * - Store access (sessionDetail, preferences)
 * - Tool result loading state
 * - Expansion state for tool calls, reasoning, and outputs
 * - Selected tool management with re-resolution on data changes
 * - Tool call collection
 *
 * This composable extracts common logic from AgentTreeView, NestedSwimlanesView,
 * and TurnWaterfallView to reduce duplication and improve maintainability.
 *
 * @example
 * ```typescript
 * const {
 *   store,
 *   prefs,
 *   fullResults,
 *   expandedToolCalls,
 *   selectedTool,
 *   selectTool,
 *   clearAllState,
 * } = useTimelineToolState();
 * ```
 *
 * @example With custom turn ownership check
 * ```typescript
 * const turnOwnershipCheck = (turn, tool) => {
 *   // Custom logic to determine if tool belongs to turn
 *   return turn.toolCalls.some(tc => tc.toolCallId === tool.toolCallId);
 * };
 *
 * const { turnOwnsSelected } = useTimelineToolState({ turnOwnershipCheck });
 * if (turnOwnsSelected(currentTurn)) {
 *   // Handle selection...
 * }
 * ```
 */
export function useTimelineToolState(
  options: UseTimelineToolStateOptions = {},
): UseTimelineToolStateReturn {
  // Store access
  const store = useSessionDetailStore();
  const prefs = usePreferencesStore();

  // Tool result loading
  const { fullResults, loadingResults, failedResults, loadFullResult, retryFullResult } =
    useToolResultLoader(() => store.sessionId);

  // Expansion state
  const expandedToolCalls = useToggleSet<string>();
  const expandedReasoning = useToggleSet<string>();
  const expandedOutputs = useToggleSet<string>();

  // Tool call collection
  const allToolCalls = computed(() => store.turns.flatMap((t) => t.toolCalls));

  // Selected tool management
  const selectedTool = ref<TurnToolCall | null>(null);

  /**
   * Select or toggle a tool.
   * If the tool is already selected, it will be deselected.
   */
  function selectTool(tc: TurnToolCall) {
    // Toggle if already selected (match by ID if available, otherwise by reference)
    if (selectedTool.value?.toolCallId === tc.toolCallId && tc.toolCallId) {
      selectedTool.value = null;
    } else if (selectedTool.value === tc && !tc.toolCallId) {
      selectedTool.value = null;
    } else {
      selectedTool.value = tc;
    }
  }

  /**
   * Check if a tool is currently selected.
   * Matches by toolCallId if available, otherwise by reference.
   */
  function isToolSelected(tc: TurnToolCall): boolean {
    if (!selectedTool.value) return false;
    if (tc.toolCallId && selectedTool.value.toolCallId) {
      return tc.toolCallId === selectedTool.value.toolCallId;
    }
    return selectedTool.value === tc;
  }

  /**
   * Clear the current tool selection.
   */
  function clearSelection() {
    selectedTool.value = null;
  }

  /**
   * Re-resolve selected tool after data refresh.
   * This keeps the detail panel open when the store refreshes and creates new object references.
   * We match by toolCallId to find the equivalent tool in the new data.
   * If the tool is no longer present, the selection is cleared.
   */
  watch(allToolCalls, (newAll) => {
    const sel = selectedTool.value;
    if (!sel || !sel.toolCallId) return;
    const match = newAll.find((tc) => tc.toolCallId === sel.toolCallId);
    if (match) {
      selectedTool.value = match;
    } else {
      // Tool was removed from store, clear the stale selection
      selectedTool.value = null;
    }
  });

  // Turn ownership check (if provided)
  const turnOwnsSelected = options.turnOwnershipCheck
    ? (turn: ConversationTurn) => {
        const sel = selectedTool.value;
        if (!sel) return false;
        return options.turnOwnershipCheck!(turn, sel);
      }
    : undefined;

  /**
   * Clear all expansion and selection state.
   * Useful when navigating between turns or changing view modes.
   */
  function clearAllState() {
    selectedTool.value = null;
    expandedToolCalls.clear();
    expandedReasoning.clear();
    expandedOutputs.clear();
  }

  return {
    store,
    prefs,
    fullResults,
    loadingResults,
    failedResults,
    loadFullResult,
    retryFullResult,
    expandedToolCalls,
    expandedReasoning,
    expandedOutputs,
    allToolCalls,
    selectedTool,
    selectTool,
    isToolSelected,
    clearSelection,
    turnOwnsSelected,
    clearAllState,
  };
}
