import type { ConversationTurn, TurnToolCall } from "@tracepilot/types";
import {
  buildSubagentContentIndex,
  extractPrompt,
  useLiveDuration,
  useTimelineNavigation,
} from "@tracepilot/ui";
import { computed, type InjectionKey, inject, nextTick, provide, ref, watch } from "vue";
import { useParallelAgentDetection } from "@/composables/useParallelAgentDetection";
import { useTimelineToolState } from "@/composables/useTimelineToolState";
import {
  type AgentNode,
  type AgentTreeBuilderContext,
  buildPaginatedTree,
  buildUnifiedTree,
  findAgentNode,
  type TreeData,
  treeHasInProgress,
} from "@/utils/agentTreeBuilder";
import {
  type AgentTreeLayoutResult,
  type AgentTreeSvgLine,
  bezierPath as bezierPathUtil,
  buildAgentTreeLayout,
  DEFAULT_AGENT_TREE_LAYOUT_CONFIG,
} from "@/utils/agentTreeLayout";

export type { AgentNode, TreeData } from "@/utils/agentTreeBuilder";
export type AgentTreeLayout = AgentTreeLayoutResult<AgentNode>;
export type AgentTreeSvgLineT = AgentTreeSvgLine;

export function useAgentTree() {
  const {
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
    clearAllState,
  } = useTimelineToolState();

  const selectedNodeId = ref<string | null>(null);
  const viewMode = ref<"paginated" | "unified">("paginated");
  const rootRef = ref<HTMLElement | null>(null);
  const nodeRefs = ref<Map<string, HTMLElement>>(new Map());

  const hasInProgressRef = ref(false);
  const { nowMs } = useLiveDuration(hasInProgressRef);

  const sessionStartTime = computed(() => {
    const firstTurn = store.turns[0];
    if (!firstTurn?.timestamp) return undefined;
    const t = new Date(firstTurn.timestamp).getTime();
    return Number.isNaN(t) ? undefined : t;
  });

  function liveDuration(node: AgentNode): number | undefined {
    if (node.status === "in-progress" && node.toolCallRef?.startedAt) {
      return nowMs.value - new Date(node.toolCallRef.startedAt).getTime();
    }
    if (node.status === "in-progress" && node.type === "main") {
      if (viewMode.value === "unified" && sessionStartTime.value) {
        return nowMs.value - sessionStartTime.value;
      }
      if (currentTurn.value?.timestamp) {
        return nowMs.value - new Date(currentTurn.value.timestamp).getTime();
      }
    }
    return node.durationMs;
  }

  const agentTurns = computed<ConversationTurn[]>(() =>
    store.turns.filter((t) => t.toolCalls.some((tc) => tc.isSubagent)),
  );

  const {
    turnIndex: agentTurnIndex,
    canPrev: canPrevAgent,
    canNext: canNextAgent,
    prevTurn: navPrev,
    nextTurn: navNext,
    jumpTo: agentJumpTo,
  } = useTimelineNavigation({
    turns: agentTurns,
    rootRef,
    onEscape: () => {
      selectedNodeId.value = null;
    },
  });

  const currentTurn = computed<ConversationTurn | undefined>(
    () => agentTurns.value[agentTurnIndex.value],
  );

  const turnNavLabel = computed(() => {
    const turn = currentTurn.value;
    if (!turn) return "";
    const pos = agentTurnIndex.value + 1;
    const total = agentTurns.value.length;
    return `Turn ${turn.turnIndex} (${pos} of ${total} with agents)`;
  });

  watch(agentTurnIndex, () => {
    selectedNodeId.value = null;
    clearAllState();
  });

  function prevAgentTurn() {
    navPrev();
  }
  function nextAgentTurn() {
    navNext();
  }
  function jumpToEarliestAgent() {
    agentJumpTo(0);
  }
  function jumpToLatestAgent() {
    agentJumpTo(agentTurns.value.length - 1);
  }
  function setViewMode(mode: "paginated" | "unified") {
    if (viewMode.value === mode) return;
    viewMode.value = mode;
    selectedNodeId.value = null;
    clearAllState();
  }

  const allSubagentToolCalls = computed(() => {
    const map = new Map<string, TurnToolCall>();
    for (const turn of store.turns) {
      for (const tc of turn.toolCalls) {
        if (tc.isSubagent && tc.toolCallId) map.set(tc.toolCallId, tc);
      }
    }
    return map;
  });

  const subagentSourceTurn = computed(() => {
    const map = new Map<string, number>();
    for (const turn of store.turns) {
      for (const tc of turn.toolCalls) {
        if (tc.isSubagent && tc.toolCallId) map.set(tc.toolCallId, turn.turnIndex);
      }
    }
    return map;
  });

  const subagentContentIndex = computed(() => buildSubagentContentIndex(store.turns));

  const allSubagentIds = computed(() => {
    const ids = new Set<string>(subagentContentIndex.value.keys());
    for (const [id] of allSubagentToolCalls.value) {
      ids.add(id);
    }
    return ids;
  });

  const builderCtx = computed<AgentTreeBuilderContext>(() => ({
    allToolCalls: allToolCalls.value,
    subagentContentIndex: subagentContentIndex.value,
    subagentSourceTurn: subagentSourceTurn.value,
    allSubagentToolCalls: allSubagentToolCalls.value,
    allSubagentIds: allSubagentIds.value,
  }));

  const treeData = computed<TreeData | null>(() => {
    return viewMode.value === "paginated"
      ? buildPaginatedTree(currentTurn.value, builderCtx.value)
      : buildUnifiedTree(store.turns, builderCtx.value);
  });

  const timedNodes = computed(() => {
    if (!treeData.value) return [];
    return treeData.value.children
      .filter(
        (c): c is typeof c & { toolCallRef: { startedAt: string } } => !!c.toolCallRef?.startedAt,
      )
      .map((c) => ({
        id: c.id,
        startedAt: c.toolCallRef.startedAt,
        completedAt: c.toolCallRef.completedAt ?? null,
        durationMs: c.durationMs,
      }));
  });

  const { idToLabel: nodeParallelLabel } = useParallelAgentDetection(timedNodes, {
    generateLabels: true,
    labelPrefix: "Parallel Group",
  });

  const layout = computed<AgentTreeLayout | null>(() => {
    if (!treeData.value) return null;
    return buildAgentTreeLayout(
      treeData.value.root,
      treeData.value.children,
      DEFAULT_AGENT_TREE_LAYOUT_CONFIG,
    );
  });

  const measuredLines = ref<AgentTreeSvgLine[]>([]);
  const measuredCanvasHeight = ref<number>(0);

  function setNodeRef(id: string, el: Element | null) {
    // Guard for SSR / test environments where HTMLElement is not defined.
    if (typeof HTMLElement !== "undefined" && el instanceof HTMLElement) nodeRefs.value.set(id, el);
    else nodeRefs.value.delete(id);
  }

  function updateMeasuredLines() {
    if (!layout.value) {
      measuredLines.value = [];
      measuredCanvasHeight.value = 0;
      return;
    }
    const nodeBottoms = new Map<string, number>();
    let maxBottom = 0;
    for (const ln of layout.value.nodes) {
      const el = nodeRefs.value.get(ln.node.id);
      const actualHeight = el ? el.offsetHeight : ln.node.type === "main" ? 120 : 140;
      const bottom = ln.y + actualHeight;
      nodeBottoms.set(ln.node.id, bottom);
      if (bottom > maxBottom) maxBottom = bottom;
    }
    measuredLines.value = layout.value.lines.map((line) => ({
      ...line,
      y1: nodeBottoms.get(line.parentId) ?? line.y1,
    }));
    measuredCanvasHeight.value = maxBottom + 30;
  }

  const displayLines = computed(() =>
    measuredLines.value.length > 0 ? measuredLines.value : (layout.value?.lines ?? []),
  );

  const canvasHeight = computed(() => {
    const base = layout.value?.height ?? 0;
    return measuredCanvasHeight.value > 0 ? Math.max(base, measuredCanvasHeight.value) : base;
  });

  watch(
    layout,
    () => {
      measuredLines.value = [];
      measuredCanvasHeight.value = 0;
      nextTick(() => updateMeasuredLines());
    },
    { immediate: true },
  );

  function bezierPath(line: AgentTreeSvgLine): string {
    return bezierPathUtil(line);
  }

  const selectedNode = computed<AgentNode | null>(() =>
    selectedNodeId.value && treeData.value
      ? findAgentNode(treeData.value, selectedNodeId.value)
      : null,
  );

  function agentPrompt(node: AgentNode): string | null {
    return extractPrompt(node.toolCallRef?.arguments ?? null);
  }

  function selectNode(id: string) {
    if (selectedNodeId.value === id) {
      selectedNodeId.value = null;
      expandedToolCalls.clear();
      return;
    }

    // In paginated mode the tree only renders the current turn; when the caller
    // passes a toolCallId for a subagent in another turn (common for nested
    // subagents launched from cross-turn fan-out) we switch turns first.
    let needsSwitch = false;
    if (viewMode.value === "paginated" && treeData.value) {
      const inCurrent = findAgentNode(treeData.value, id);
      if (!inCurrent) {
        const containingIdx = agentTurns.value.findIndex((t) =>
          t.toolCalls.some((tc) => tc.toolCallId === id || tc.parentToolCallId === id),
        );
        if (containingIdx >= 0 && containingIdx !== agentTurnIndex.value) {
          agentJumpTo(containingIdx);
          needsSwitch = true;
        }
      }
    }

    if (needsSwitch) {
      // The agentTurnIndex watcher clears selectedNodeId; set after it flushes.
      nextTick(() => {
        selectedNodeId.value = id;
        expandedToolCalls.clear();
      });
    } else {
      selectedNodeId.value = id;
      expandedToolCalls.clear();
    }
  }

  function closeDetail() {
    selectedNodeId.value = null;
  }

  const hasInProgress = computed(() =>
    treeData.value ? treeHasInProgress(treeData.value) : false,
  );

  watch(
    hasInProgress,
    (val) => {
      hasInProgressRef.value = val;
    },
    { immediate: true },
  );

  let lastTurnKey = store.turns.map((t) => t.turnIndex).join(",");
  watch(
    () => store.turns,
    (newTurns) => {
      const newKey = newTurns.map((t) => t.turnIndex).join(",");
      if (newKey === lastTurnKey) return;

      const oldKey = lastTurnKey;
      lastTurnKey = newKey;

      if (oldKey && newKey.startsWith(oldKey)) {
        const maxIdx = agentTurns.value.length - 1;
        if (agentTurnIndex.value > maxIdx) {
          agentTurnIndex.value = Math.max(0, maxIdx);
        }
        return;
      }

      const maxIdx = agentTurns.value.length - 1;
      if (agentTurnIndex.value > maxIdx) {
        agentTurnIndex.value = Math.max(0, maxIdx);
      }
      selectedNodeId.value = null;
      expandedToolCalls.clear();
      nodeRefs.value.clear();
    },
  );

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
    selectedNodeId,
    viewMode,
    rootRef,
    nodeRefs,
    agentTurns,
    agentTurnIndex,
    canPrevAgent,
    canNextAgent,
    currentTurn,
    turnNavLabel,
    treeData,
    layout,
    displayLines,
    canvasHeight,
    nodeParallelLabel,
    selectedNode,
    hasInProgress,
    prevAgentTurn,
    nextAgentTurn,
    jumpToEarliestAgent,
    jumpToLatestAgent,
    setViewMode,
    selectNode,
    closeDetail,
    setNodeRef,
    liveDuration,
    agentPrompt,
    bezierPath,
    updateMeasuredLines,
  };
}

export type AgentTreeContext = ReturnType<typeof useAgentTree>;

export const AgentTreeKey: InjectionKey<AgentTreeContext> = Symbol("AgentTreeContext");

export function provideAgentTree(ctx: AgentTreeContext) {
  provide(AgentTreeKey, ctx);
}

export function useAgentTreeContext(): AgentTreeContext {
  const ctx = inject(AgentTreeKey);
  if (!ctx) throw new Error("useAgentTreeContext must be used within AgentTreeView");
  return ctx;
}
