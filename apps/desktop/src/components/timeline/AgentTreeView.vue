<script setup lang="ts">
import { computed, ref, nextTick, watch } from "vue";
import type { ConversationTurn, TurnToolCall } from "@tracepilot/types";
import { useSessionDetailStore } from "@/stores/sessionDetail";
import { useToolResultLoader } from "@/composables/useToolResultLoader";
import { usePreferencesStore } from "@/stores/preferences";
import {
  Badge,
  EmptyState,
  ExpandChevron,
  formatDuration,
  formatLiveDuration,
  formatTime,
  truncateText,
  toolIcon,
  formatArgsSummary,
  useToggleSet,
  useLiveDuration,
  ToolArgsRenderer,
  ToolResultRenderer,
  MarkdownContent,
  inferAgentTypeFromToolCall,
  AGENT_COLORS,
  extractPrompt,
  useTimelineNavigation,
  agentStatusFromToolCall,
  STATUS_ICONS,
  buildSubagentContentIndex,
  type SubagentContent,
} from "@tracepilot/ui";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgentNode {
  id: string;
  type: "main" | "explore" | "general-purpose" | "code-review" | "task";
  displayName: string;
  description?: string;
  model?: string;
  durationMs?: number;
  toolCount: number;
  status: "completed" | "failed" | "in-progress";
  toolCalls: TurnToolCall[];
  toolCallRef?: TurnToolCall; // The subagent tool call itself
  children?: AgentNode[];
  parallelGroup?: string;
  /** Assistant messages attributed to this agent. */
  messages: string[];
  /** Reasoning/thinking texts attributed to this agent. */
  reasoning: string[];
}

interface TreeData {
  root: AgentNode;
  children: AgentNode[];
}

interface ParallelGroup {
  label: string;
  nodeIds: string[];
}

// ---------------------------------------------------------------------------
// Store & State
// ---------------------------------------------------------------------------

const store = useSessionDetailStore();
const prefs = usePreferencesStore();
const { fullResults, loadingResults, failedResults, loadFullResult, retryFullResult } = useToolResultLoader(
  () => store.sessionId
);
const selectedNodeId = ref<string | null>(null);
const treeContainer = ref<HTMLElement | null>(null);
const rootRef = ref<HTMLElement | null>(null);
const expandedToolCalls = useToggleSet<string>();
const expandedReasoning = useToggleSet<string>();
const nodeRefs = ref<Map<string, HTMLElement>>(new Map());

// Live-ticking timer for in-progress agent durations (started when hasInProgress is true)
// Note: hasInProgress computed is declared later but used here via a ref bridge
// because useLiveDuration needs the ref at setup time before hasInProgress is defined.
const hasInProgressRef = ref(false);
const { nowMs } = useLiveDuration(hasInProgressRef);

/** Returns live elapsed ms for in-progress nodes, or the static durationMs for completed ones. */
function liveDuration(node: AgentNode): number | undefined {
  if (node.status === "in-progress" && node.toolCallRef?.startedAt) {
    return nowMs.value - new Date(node.toolCallRef.startedAt).getTime();
  }
  if (node.status === "in-progress" && node.type === "main" && currentTurn.value?.timestamp) {
    return nowMs.value - new Date(currentTurn.value.timestamp).getTime();
  }
  return node.durationMs;
}

// ---------------------------------------------------------------------------
// Turn Filtering — only turns that have subagents
// ---------------------------------------------------------------------------

const agentTurns = computed<ConversationTurn[]>(() =>
  store.turns.filter((t) => t.toolCalls.some((tc) => tc.isSubagent)),
);

const { turnIndex: agentTurnIndex, canPrev: canPrevAgent, canNext: canNextAgent, prevTurn: navPrev, nextTurn: navNext, jumpTo: agentJumpTo } = useTimelineNavigation({
  turns: agentTurns,
  rootRef,
  onEscape: () => { selectedNodeId.value = null; },
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

// Side effects on turn change (clear selection & expanded state)
watch(agentTurnIndex, () => {
  selectedNodeId.value = null;
  expandedToolCalls.clear();
  expandedReasoning.clear();
});

function prevAgentTurn() { navPrev(); }
function nextAgentTurn() { navNext(); }
function jumpToEarliestAgent() { agentJumpTo(0); }
function jumpToLatestAgent() { agentJumpTo(agentTurns.value.length - 1); }

// ---------------------------------------------------------------------------
// Agent Type Detection
// ---------------------------------------------------------------------------

const AGENT_TYPE_ICONS: Record<string, string> = {
  explore: "🔍",
  "general-purpose": "🛠",
  "code-review": "🔎",
  task: "⚡",
  main: "🤖",
};

// ---------------------------------------------------------------------------
// Tree Data
// ---------------------------------------------------------------------------

const allToolCalls = computed(() => store.turns.flatMap(t => t.toolCalls));

// Session-wide index of subagent output content (messages + reasoning)
const subagentContentIndex = computed(() => buildSubagentContentIndex(store.turns));

// Session-wide set of all known subagent tool call IDs (for main-agent filtering).
// Includes IDs from subagentContentIndex PLUS any subagents with no attributed content
// yet (e.g., in-progress agents). This prevents main-agent messages from accidentally
// including content that will later be attributed to a subagent.
const allSubagentIds = computed(() => {
  const ids = new Set<string>(subagentContentIndex.value.keys());
  for (const turn of store.turns) {
    for (const tc of turn.toolCalls) {
      if (tc.isSubagent && tc.toolCallId) ids.add(tc.toolCallId);
    }
  }
  return ids;
});

const treeData = computed<TreeData | null>(() => {
  const turn = currentTurn.value;
  if (!turn) return null;

  const subagentCalls = turn.toolCalls.filter((tc) => tc.isSubagent);
  const subagentIdSet = new Set(subagentCalls.map((tc) => tc.toolCallId).filter(Boolean));

  // Build AgentNode map for all subagents
  const nodeMap = new Map<string, AgentNode>();
  for (let idx = 0; idx < subagentCalls.length; idx++) {
    const tc = subagentCalls[idx];
    const nodeId = tc.toolCallId ?? `subagent-${idx}`;
    const childTools = tc.toolCallId
      ? allToolCalls.value.filter(
          (t) => t.parentToolCallId === tc.toolCallId && !t.isSubagent,
        )
      : [];
    const agentType = inferAgentTypeFromToolCall(tc);
    const content = subagentContentIndex.value.get(nodeId);
    nodeMap.set(nodeId, {
      id: nodeId,
      type: agentType,
      displayName: tc.agentDisplayName ?? `${agentType} #${idx + 1}`,
      description: tc.agentDescription,
      model: tc.model,
      durationMs: tc.durationMs,
      toolCount: childTools.length,
      status: agentStatusFromToolCall(tc),
      toolCalls: childTools,
      toolCallRef: tc,
      children: [],
      messages: content?.messages ?? [],
      reasoning: content?.reasoning ?? [],
    });
  }

  // Build hierarchy: subagents whose parentToolCallId points to another subagent
  const rootChildren: AgentNode[] = [];
  for (const [, node] of nodeMap) {
    const tc = node.toolCallRef;
    const parentId = tc?.parentToolCallId;
    if (parentId && subagentIdSet.has(parentId) && nodeMap.has(parentId)) {
      nodeMap.get(parentId)!.children!.push(node);
    } else {
      rootChildren.push(node);
    }
  }

  const directTools = turn.toolCalls.filter(
    (tc) => !tc.isSubagent && !tc.parentToolCallId,
  );
  // Include subagent-spawning tool calls so they appear in the main agent's tool list
  const subagentSpawnTools = turn.toolCalls.filter((tc) => tc.isSubagent);
  const mainToolCalls = [...subagentSpawnTools, ...directTools];
  const totalToolCount = turn.toolCalls.length;

  const mainStatus: "completed" | "failed" | "in-progress" = !turn.isComplete
    ? "in-progress"
    : "completed";

  // Collect main-agent messages (exclude those attributed to any known subagent)
  const knownSubagentIds = allSubagentIds.value;
  const mainMessages = turn.assistantMessages
    .filter(m => !m.parentToolCallId || !knownSubagentIds.has(m.parentToolCallId))
    .map(m => m.content);
  const mainReasoning = (turn.reasoningTexts ?? [])
    .filter(r => !r.parentToolCallId || !knownSubagentIds.has(r.parentToolCallId))
    .map(r => r.content);

  const root: AgentNode = {
    id: "main",
    type: "main",
    displayName: "Main Agent",
    model: turn.model,
    durationMs: turn.durationMs,
    toolCount: totalToolCount,
    status: mainStatus,
    toolCalls: mainToolCalls,
    children: [],
    messages: mainMessages,
    reasoning: mainReasoning,
  };

  return { root, children: rootChildren };
});

// ---------------------------------------------------------------------------
// Parallel Groups
// ---------------------------------------------------------------------------

const parallelGroups = computed<ParallelGroup[]>(() => {
  if (!treeData.value) return [];
  // Only compare direct children of the root (same hierarchy level)
  const children = treeData.value.children;
  if (children.length < 2) return [];

  // Parse time ranges
  interface TimedNode {
    node: AgentNode;
    start: number;
    end: number;
  }

  const timed: TimedNode[] = children
    .filter((c) => c.toolCallRef?.startedAt)
    .map((c) => ({
      node: c,
      start: new Date(c.toolCallRef!.startedAt!).getTime(),
      end: c.toolCallRef?.completedAt
        ? new Date(c.toolCallRef.completedAt).getTime()
        : new Date(c.toolCallRef!.startedAt!).getTime() + (c.durationMs ?? 0),
    }));

  if (timed.length < 2) return [];

  // Union-Find for grouping overlapping
  const parent = new Map<string, string>();
  function find(x: string): string {
    if (!parent.has(x)) parent.set(x, x);
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!));
    return parent.get(x)!;
  }
  function union(a: string, b: string) {
    parent.set(find(a), find(b));
  }

  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const a = timed[i];
      const b = timed[j];
      if (a.start < b.end && b.start < a.end) {
        union(a.node.id, b.node.id);
      }
    }
  }

  // Collect groups
  const groupMap = new Map<string, string[]>();
  for (const t of timed) {
    const root = find(t.node.id);
    if (!groupMap.has(root)) groupMap.set(root, []);
    groupMap.get(root)!.push(t.node.id);
  }

  const groups: ParallelGroup[] = [];
  let labelIdx = 0;
  for (const [, nodeIds] of groupMap) {
    if (nodeIds.length > 1) {
      const label = `Parallel Group ${String.fromCharCode(65 + labelIdx)}`;
      labelIdx++;
      groups.push({ label, nodeIds });
    }
  }

  // If there are no parallel groups, nothing to label
  if (groups.length === 0) return [];

  return groups;
});

// Assign parallel group labels to tree nodes
const nodeParallelLabel = computed<Map<string, string>>(() => {
  const map = new Map<string, string>();
  for (const g of parallelGroups.value) {
    for (const id of g.nodeIds) {
      map.set(id, g.label);
    }
  }
  return map;
});

// ---------------------------------------------------------------------------
// Layout (horizontal tree)
// ---------------------------------------------------------------------------

const ROOT_WIDTH = 280;
const CHILD_WIDTH = 220;
const ROW_GAP = 80;
const COL_GAP = 24;
const MAX_PER_ROW = 5;

interface LayoutNode {
  node: AgentNode;
  x: number;
  y: number;
  width: number;
}

interface SvgLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  parentId: string;
  childId: string;
}

const layout = computed<{ nodes: LayoutNode[]; lines: SvgLine[]; width: number; height: number } | null>(() => {
  if (!treeData.value) return null;

  // Group nodes by depth level (BFS) so nested children appear below parents
  interface FlatChild { node: AgentNode; parentId: string; depth: number; }
  const levels: FlatChild[][] = [];
  let queue: FlatChild[] = treeData.value.children.map((n) => ({
    node: n,
    parentId: "main",
    depth: 0,
  }));
  while (queue.length > 0) {
    const nextQueue: FlatChild[] = [];
    for (const item of queue) {
      if (!levels[item.depth]) levels[item.depth] = [];
      levels[item.depth].push(item);
      if (item.node.children?.length) {
        for (const child of item.node.children) {
          nextQueue.push({ node: child, parentId: item.node.id, depth: item.depth + 1 });
        }
      }
    }
    queue = nextQueue;
  }

  // Chunk each depth level into rows of MAX_PER_ROW
  const rows: FlatChild[][] = [];
  for (const level of levels) {
    for (let i = 0; i < level.length; i += MAX_PER_ROW) {
      rows.push(level.slice(i, i + MAX_PER_ROW));
    }
  }

  const rootNodeHeight = 120;
  const childNodeHeight = 140;

  // Compute total width needed
  const maxRowWidth = Math.max(
    ROOT_WIDTH,
    ...rows.map((row) => row.length * CHILD_WIDTH + (row.length - 1) * COL_GAP),
  );
  const totalWidth = Math.max(maxRowWidth + 60, ROOT_WIDTH + 60);

  // Root centered at top
  const rootX = (totalWidth - ROOT_WIDTH) / 2;
  const rootY = 20;
  const nodes: LayoutNode[] = [
    { node: treeData.value.root, x: rootX, y: rootY, width: ROOT_WIDTH },
  ];

  // Track node positions for drawing parent → child lines
  const nodeCenters = new Map<string, { cx: number; bottomY: number }>();
  nodeCenters.set("main", {
    cx: rootX + ROOT_WIDTH / 2,
    bottomY: rootY + rootNodeHeight,
  });

  const lines: SvgLine[] = [];
  const rootBottomY = rootY + rootNodeHeight;

  rows.forEach((row, rowIdx) => {
    const rowWidth = row.length * CHILD_WIDTH + (row.length - 1) * COL_GAP;
    const startX = (totalWidth - rowWidth) / 2;
    const childY = rootBottomY + ROW_GAP + rowIdx * (childNodeHeight + ROW_GAP);

    row.forEach((item, colIdx) => {
      const childX = startX + colIdx * (CHILD_WIDTH + COL_GAP);
      nodes.push({ node: item.node, x: childX, y: childY, width: CHILD_WIDTH });

      nodeCenters.set(item.node.id, {
        cx: childX + CHILD_WIDTH / 2,
        bottomY: childY + childNodeHeight,
      });

      const parentCenter = nodeCenters.get(item.parentId);
      if (parentCenter) {
        lines.push({
          x1: parentCenter.cx,
          y1: parentCenter.bottomY,
          x2: childX + CHILD_WIDTH / 2,
          y2: childY,
          parentId: item.parentId,
          childId: item.node.id,
        });
      }
    });
  });

  const lastRow = rows[rows.length - 1];
  const lastRowY = lastRow
    ? rootBottomY + ROW_GAP + (rows.length - 1) * (childNodeHeight + ROW_GAP) + childNodeHeight
    : rootBottomY;
  const totalHeight = lastRowY + 30;

  return { nodes, lines, width: totalWidth, height: totalHeight };
});

// ---------------------------------------------------------------------------
// SVG Line Measurement (DOM-based)
// ---------------------------------------------------------------------------

const measuredLines = ref<SvgLine[]>([]);
const measuredCanvasHeight = ref<number>(0);

function setNodeRef(id: string, el: Element | null) {
  if (el instanceof HTMLElement) nodeRefs.value.set(id, el);
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
    const actualHeight = el ? el.offsetHeight : (ln.node.type === "main" ? 120 : 140);
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

// ---------------------------------------------------------------------------
// SVG path generation (bezier curves)
// ---------------------------------------------------------------------------

function bezierPath(line: SvgLine): string {
  const midY = (line.y1 + line.y2) / 2;
  return `M ${line.x1} ${line.y1} C ${line.x1} ${midY}, ${line.x2} ${midY}, ${line.x2} ${line.y2}`;
}

/** Resolve the color for a connector line based on the child node's agent type. */
function lineColor(line: SvgLine): string {
  if (!treeData.value) return AGENT_COLORS.main;
  // Search treeData for the child node to find its type
  function findType(nodes: AgentNode[]): string | undefined {
    for (const n of nodes) {
      if (n.id === line.childId) return AGENT_COLORS[n.type];
      if (n.children?.length) {
        const found = findType(n.children);
        if (found) return found;
      }
    }
    return undefined;
  }
  return findType(treeData.value.children) ?? AGENT_COLORS.main;
}

// ---------------------------------------------------------------------------
// Node Selection & Detail
// ---------------------------------------------------------------------------

const selectedNode = computed<AgentNode | null>(() => {
  if (!selectedNodeId.value || !treeData.value) return null;
  if (selectedNodeId.value === "main") return treeData.value.root;
  function findNode(nodes: AgentNode[]): AgentNode | null {
    for (const n of nodes) {
      if (n.id === selectedNodeId.value) return n;
      if (n.children?.length) {
        const found = findNode(n.children);
        if (found) return found;
      }
    }
    return null;
  }
  return findNode(treeData.value.children);
});

function agentPrompt(node: AgentNode): string | null {
  return extractPrompt(node.toolCallRef?.arguments ?? null);
}

function selectNode(id: string) {
  selectedNodeId.value = selectedNodeId.value === id ? null : id;
  expandedToolCalls.clear();
}

// Start/stop live timer based on whether any node is in-progress
const hasInProgress = computed(() => {
  if (!treeData.value) return false;
  const { root, children } = treeData.value;
  if (root.status === "in-progress") return true;
  function check(nodes: AgentNode[]): boolean {
    return nodes.some((n) => n.status === "in-progress" || (n.children?.length && check(n.children)));
  }
  return check(children);
});

watch(hasInProgress, (val) => {
  hasInProgressRef.value = val;
}, { immediate: true });

// Reset index when turns structurally change (new session loaded),
// but preserve selection when turns are appended or soft-refreshed.
let lastTurnKey = store.turns.map(t => t.turnIndex).join(",");
watch(
  () => store.turns,
  (newTurns) => {
    const newKey = newTurns.map(t => t.turnIndex).join(",");
    if (newKey !== lastTurnKey) {
      const oldKey = lastTurnKey;
      lastTurnKey = newKey;

      // If turns were only appended (new key starts with old key), preserve state
      if (oldKey && newKey.startsWith(oldKey)) {
        const maxIdx = agentTurns.value.length - 1;
        if (agentTurnIndex.value > maxIdx) {
          agentTurnIndex.value = Math.max(0, maxIdx);
        }
        return;
      }

      // Full structural change (new session or reorder) — reset everything
      const maxIdx = agentTurns.value.length - 1;
      if (agentTurnIndex.value > maxIdx) {
        agentTurnIndex.value = Math.max(0, maxIdx);
      }
      selectedNodeId.value = null;
      expandedToolCalls.clear();
      nodeRefs.value.clear();
    }
  },
);
</script>

<template>
  <div ref="rootRef" class="agent-tree-view" tabindex="0">
    <!-- Empty state -->
    <EmptyState
      v-if="agentTurns.length === 0"
      icon="🤖"
      title="No Agent Orchestration"
      message="No turns with subagent activity found in this session."
    />

    <template v-else>
      <!-- Turn navigation -->
      <div class="turn-nav">
        <button
          class="turn-nav-btn"
          :disabled="!canPrevAgent"
          @click="jumpToEarliestAgent"
          aria-label="Jump to earliest agent turn"
        >
          ⏮ Earliest
        </button>
        <button
          class="turn-nav-btn"
          :disabled="agentTurnIndex === 0"
          @click="prevAgentTurn"
          aria-label="Previous agent turn"
        >
          ◀ Prev
        </button>
        <span class="turn-nav-label">{{ turnNavLabel }}</span>
        <button
          class="turn-nav-btn"
          :disabled="agentTurnIndex === agentTurns.length - 1"
          @click="nextAgentTurn"
          aria-label="Next agent turn"
        >
          Next ▶
        </button>
        <button
          class="turn-nav-btn"
          :disabled="!canNextAgent"
          @click="jumpToLatestAgent"
          aria-label="Jump to latest agent turn"
        >
          Latest ⏭
        </button>
      </div>

      <!-- Tree visualization -->
      <div v-if="layout" ref="treeContainer" class="tree-container">
        <div
          class="tree-canvas"
          :style="{ width: `${layout.width}px`, height: `${canvasHeight}px` }"
        >
          <!-- SVG connections -->
          <svg
            class="tree-svg"
            :width="layout.width"
            :height="canvasHeight"
            :viewBox="`0 0 ${layout.width} ${canvasHeight}`"
            role="img"
            aria-label="Agent tree visualization showing the hierarchical structure of agent and tool call execution"
          >
            <!-- Static base line (subtle, behind the animated one) -->
            <path
              v-for="(line, i) in displayLines"
              :key="`base-${i}`"
              :d="bezierPath(line)"
              class="tree-connector tree-connector--base"
              :style="{ stroke: lineColor(line) }"
            />
            <!-- Animated flowing dash overlay -->
            <path
              v-for="(line, i) in displayLines"
              :key="`flow-${i}`"
              :d="bezierPath(line)"
              class="tree-connector tree-connector--flow"
              :style="{ stroke: lineColor(line) }"
            />
          </svg>

          <!-- Agent nodes -->
          <div
            v-for="ln in layout.nodes"
            :key="ln.node.id"
            :ref="(el: any) => setNodeRef(ln.node.id, el)"
            class="agent-node"
            :class="{
              'agent-node--main': ln.node.type === 'main',
              'agent-node--selected': selectedNodeId === ln.node.id,
              'agent-node--in-progress': ln.node.status === 'in-progress',
            }"
            :style="{
              left: `${ln.x}px`,
              top: `${ln.y}px`,
              width: `${ln.width}px`,
              '--node-color': AGENT_COLORS[ln.node.type] ?? AGENT_COLORS.main,
            }"
            role="button"
            tabindex="0"
            :aria-label="`${ln.node.displayName} — ${ln.node.status}`"
            @click="selectNode(ln.node.id)"
            @keydown.enter="selectNode(ln.node.id)"
            @keydown.space.prevent="selectNode(ln.node.id)"
          >
            <!-- Parallel group label -->
            <div
              v-if="nodeParallelLabel.get(ln.node.id)"
              class="parallel-badge"
            >
              {{ nodeParallelLabel.get(ln.node.id) }}
            </div>

            <div class="agent-node-header">
              <span class="agent-node-icon">
                {{ AGENT_TYPE_ICONS[ln.node.type] ?? "🤖" }}
              </span>
              <span class="agent-node-name">{{ ln.node.displayName }}</span>
            </div>

            <div v-if="ln.node.model" class="agent-node-model">
              {{ ln.node.model }}
            </div>

            <div class="agent-node-meta">
              <span v-if="liveDuration(ln.node) != null">
                {{ formatLiveDuration(liveDuration(ln.node)) }}
              </span>
              <span>{{ ln.node.toolCount }} tool{{ ln.node.toolCount !== 1 ? "s" : "" }}</span>
              <span class="agent-node-status" :class="{ 'agent-node-status--in-progress': ln.node.status === 'in-progress' }">
                {{ STATUS_ICONS[ln.node.status] }}
                <span v-if="ln.node.status === 'in-progress'" class="sr-only">In progress</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Detail panel -->
      <Transition name="detail-panel">
        <div v-if="selectedNode" class="detail-panel">
          <div class="detail-panel-header">
            <span class="detail-panel-icon">
              {{ AGENT_TYPE_ICONS[selectedNode.type] ?? "🤖" }}
            </span>
            <h3 class="detail-panel-title">{{ selectedNode.displayName }}</h3>
            <button
              class="detail-panel-close"
              aria-label="Close detail panel"
              @click="selectedNodeId = null"
            >
              ✕
            </button>
          </div>

          <div class="detail-panel-info">
            <div v-if="selectedNode.description" class="detail-info-row">
              <span class="detail-label">Description</span>
              <span class="detail-value">{{ selectedNode.description }}</span>
            </div>
            <div v-if="agentPrompt(selectedNode)" class="detail-section">
              <h4 class="detail-section-title">Prompt</h4>
              <MarkdownContent :content="agentPrompt(selectedNode)!" :render="prefs.isFeatureEnabled('renderMarkdown')" max-height="200px" />
            </div>
            <div class="detail-info-grid">
              <div class="detail-info-item">
                <span class="detail-label">Status</span>
                <Badge
                  :variant="
                    selectedNode.status === 'completed'
                      ? 'success'
                      : selectedNode.status === 'failed'
                        ? 'danger'
                        : 'warning'
                  "
                >
                  {{ STATUS_ICONS[selectedNode.status] }}
                  {{ selectedNode.status }}
                </Badge>
              </div>
              <div class="detail-info-item">
                <span class="detail-label">Duration</span>
                <span class="detail-value">
                  {{ formatLiveDuration(liveDuration(selectedNode)) || "—" }}
                </span>
              </div>
              <div class="detail-info-item">
                <span class="detail-label">Tools</span>
                <span class="detail-value">{{ selectedNode.toolCount }}</span>
              </div>
              <div v-if="selectedNode.model" class="detail-info-item">
                <span class="detail-label">Model</span>
                <Badge variant="done">{{ selectedNode.model }}</Badge>
              </div>
            </div>
          </div>

          <!-- Agent Output -->
          <div v-if="selectedNode.messages.filter(m => m.trim()).length > 0" class="detail-section">
            <h4 class="detail-section-title">Output</h4>
            <div class="detail-output">
              <MarkdownContent
                v-for="(msg, idx) in selectedNode.messages.filter(m => m.trim())"
                :key="`output-msg-${idx}`"
                class="detail-output-message"
                :content="msg"
                :render="prefs.isFeatureEnabled('renderMarkdown')"
              />
            </div>
          </div>

          <!-- Subagent Result Content (tool result from the task/read_agent call) -->
          <div
            v-if="selectedNode.toolCallRef?.resultContent || (selectedNode.toolCallRef?.toolCallId && fullResults.has(selectedNode.toolCallRef.toolCallId))"
            class="detail-section"
          >
            <h4 class="detail-section-title">Result</h4>
            <div class="detail-output">
              <ToolResultRenderer
                :tc="selectedNode.toolCallRef!"
                :content="fullResults.get(selectedNode.toolCallRef!.toolCallId ?? '') ?? selectedNode.toolCallRef!.resultContent ?? ''"
                :rich-enabled="prefs.isFeatureEnabled('renderMarkdown') && ['read_agent', 'task'].includes(selectedNode.toolCallRef!.toolName) ? true : prefs.isRichRenderingEnabled(selectedNode.toolCallRef!.toolName)"
                :is-truncated="!!(selectedNode.toolCallRef!.toolCallId && selectedNode.toolCallRef!.resultContent?.includes('…[truncated]') && !fullResults.has(selectedNode.toolCallRef!.toolCallId ?? ''))"
                :loading="!!(selectedNode.toolCallRef!.toolCallId && loadingResults.has(selectedNode.toolCallRef!.toolCallId))"
                @load-full="loadFullResult(selectedNode.toolCallRef!.toolCallId!)"
              />
            </div>
          </div>

          <!-- Agent Reasoning -->
          <div v-if="selectedNode.reasoning.length > 0" class="detail-section">
            <button
              class="reasoning-toggle"
              :aria-expanded="expandedReasoning.has(selectedNode.id)"
              @click="expandedReasoning.toggle(selectedNode.id)"
            >
              <ExpandChevron :expanded="expandedReasoning.has(selectedNode.id)" />
              💭 {{ selectedNode.reasoning.length }} reasoning block{{ selectedNode.reasoning.length !== 1 ? "s" : "" }}
            </button>
            <div v-if="expandedReasoning.has(selectedNode.id)" class="reasoning-content" tabindex="0">
              <template v-for="(text, rIdx) in selectedNode.reasoning" :key="`reasoning-${rIdx}`">
                <hr v-if="rIdx > 0" class="reasoning-divider" />
                <MarkdownContent :content="text" :render="prefs.isFeatureEnabled('renderMarkdown')" />
              </template>
            </div>
          </div>

          <!-- Tool calls list -->
          <div class="detail-tools">
            <h4 class="detail-tools-heading">
              {{ selectedNode.type === "main" ? "Tools & Agents" : "Tool Calls" }}
              <span class="detail-tools-count">({{ selectedNode.toolCalls.length }})</span>
            </h4>

            <EmptyState
              v-if="selectedNode.toolCalls.length === 0"
              message="No tool calls recorded."
            />

            <div v-else class="detail-tools-list">
              <div
                v-for="(tc, idx) in selectedNode.toolCalls"
                :key="tc.toolCallId ?? idx"
                class="detail-tool-row"
              >
                <button
                  type="button"
                  class="detail-tool-btn"
                  :aria-expanded="expandedToolCalls.has(tc.toolCallId ?? `tc-${idx}`)"
                  @click="expandedToolCalls.toggle(tc.toolCallId ?? `tc-${idx}`)"
                >
                  <span class="detail-tool-idx">{{ idx + 1 }}.</span>
                  <span class="detail-tool-icon">{{ toolIcon(tc.toolName) }}</span>
                  <span class="detail-tool-name">{{ tc.isSubagent && tc.agentDisplayName ? tc.agentDisplayName : tc.toolName }}</span>
                  <Badge v-if="tc.isSubagent" variant="neutral" class="detail-agent-badge">agent</Badge>
                  <span
                    v-if="tc.intentionSummary"
                    class="tool-call-intent"
                    :title="tc.intentionSummary"
                    style="flex: 1;"
                  >
                    {{ truncateText(tc.intentionSummary, 60) }}
                  </span>
                  <span
                    v-else-if="formatArgsSummary(tc.arguments, tc.toolName)"
                    class="detail-tool-args"
                    :title="formatArgsSummary(tc.arguments, tc.toolName)"
                  >
                    ({{ truncateText(formatArgsSummary(tc.arguments, tc.toolName), 60) }})
                  </span>
                  <span class="detail-tool-right">
                    <span v-if="tc.durationMs != null" class="detail-tool-dur">
                      {{ formatDuration(tc.durationMs) }}
                    </span>
                    <span v-if="tc.success === true" class="detail-tool-status success">✓</span>
                    <span v-else-if="tc.success === false" class="detail-tool-status failed">✗</span>
                    <span v-else class="detail-tool-status pending">○</span>
                  </span>
                </button>

                <!-- Expanded detail -->
                <div
                  v-if="expandedToolCalls.has(tc.toolCallId ?? `tc-${idx}`)"
                  class="detail-tool-expanded"
                >
                  <div v-if="tc.error" class="detail-tool-error">
                    <div class="detail-tool-error-label">Error</div>
                    <pre class="detail-tool-error-body">{{ tc.error }}</pre>
                  </div>
                  <div class="detail-tool-meta">
                    <div v-if="tc.startedAt" class="detail-meta-item">
                      <span class="detail-label">Started</span>
                      <span class="detail-value">{{ formatTime(tc.startedAt) }}</span>
                    </div>
                    <div v-if="tc.completedAt" class="detail-meta-item">
                      <span class="detail-label">Completed</span>
                      <span class="detail-value">{{ formatTime(tc.completedAt) }}</span>
                    </div>
                    <div v-if="tc.durationMs != null" class="detail-meta-item">
                      <span class="detail-label">Duration</span>
                      <span class="detail-value">{{ formatDuration(tc.durationMs) }}</span>
                    </div>
                    <div v-if="tc.toolCallId" class="detail-meta-item">
                      <span class="detail-label">Call ID</span>
                      <span class="detail-value font-mono">{{ tc.toolCallId }}</span>
                    </div>
                  </div>
                  <!-- Arguments (rich renderer) -->
                  <ToolArgsRenderer :tc="tc" :rich-enabled="prefs.isRichRenderingEnabled(tc.toolName)" />

                  <!-- Result (rich renderer) -->
                  <div v-if="tc.resultContent || (tc.toolCallId && fullResults.has(tc.toolCallId))" class="tool-result-section">
                    <ToolResultRenderer
                      :tc="tc"
                      :content="fullResults.get(tc.toolCallId ?? '') ?? tc.resultContent ?? ''"
                      :rich-enabled="prefs.isRichRenderingEnabled(tc.toolName)"
                      :is-truncated="!!(tc.toolCallId && tc.resultContent?.includes('…[truncated]') && !fullResults.has(tc.toolCallId))"
                      :loading="!!(tc.toolCallId && loadingResults.has(tc.toolCallId))"
                      @load-full="loadFullResult(tc.toolCallId!)"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </template>
  </div>
</template>

<style scoped>
/* ------------------------------------------------------------------ */
/* Screen-reader only utility                                          */
/* ------------------------------------------------------------------ */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* ------------------------------------------------------------------ */
/* Root                                                                */
/* ------------------------------------------------------------------ */
.agent-tree-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* ------------------------------------------------------------------ */
/* Turn Navigation                                                     */
/* ------------------------------------------------------------------ */
.turn-nav {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 8px 12px;
  background: var(--canvas-subtle);
  border: 1px solid var(--border-muted);
  border-radius: 8px;
}

.turn-nav-btn {
  padding: 4px 12px;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--accent-fg);
  background: transparent;
  border: 1px solid var(--border-default);
  border-radius: 6px;
  cursor: pointer;
  transition:
    background var(--transition-fast, 150ms),
    border-color var(--transition-fast, 150ms);
}

.turn-nav-btn:hover:not(:disabled) {
  background: var(--accent-subtle);
  border-color: var(--accent-fg);
}

.turn-nav-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.turn-nav-label {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
}

/* ------------------------------------------------------------------ */
/* Tree Container                                                      */
/* ------------------------------------------------------------------ */
.tree-container {
  overflow-x: auto;
  padding: 8px 0;
}

.tree-canvas {
  position: relative;
  margin: 0 auto;
}

/* ------------------------------------------------------------------ */
/* SVG Connectors                                                      */
/* ------------------------------------------------------------------ */
.tree-svg {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
}

.tree-connector {
  stroke-width: 2;
  fill: none;
}

.tree-connector--base {
  opacity: 0.18;
}

.tree-connector--flow {
  stroke-dasharray: 8 14;
  stroke-dashoffset: 0;
  animation: connector-flow 1.2s linear infinite;
  opacity: 0.7;
}

@keyframes connector-flow {
  to {
    stroke-dashoffset: -22;
  }
}

/* ------------------------------------------------------------------ */
/* Agent Nodes                                                         */
/* ------------------------------------------------------------------ */
.agent-node {
  position: absolute;
  padding: 12px 14px;
  background: var(--canvas-raised);
  border: 1px solid var(--border-default);
  border-radius: 8px;
  cursor: pointer;
  transition:
    border-color var(--transition-fast, 150ms),
    box-shadow var(--transition-fast, 150ms),
    transform var(--transition-fast, 150ms);
  user-select: none;
  /* Subtle top-accent bar via gradient */
  border-top: 2px solid var(--node-color, var(--border-default));
}

.agent-node:hover {
  border-color: var(--node-color, var(--accent-fg));
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.25);
  transform: translateY(-1px);
}

.agent-node--selected {
  border-color: var(--accent-fg);
  box-shadow: 0 0 0 2px var(--accent-muted);
}

.agent-node--main {
  background: linear-gradient(
    135deg,
    var(--canvas-raised) 0%,
    rgba(99, 102, 241, 0.08) 100%
  );
}

.agent-node--in-progress {
  border-color: var(--node-color, var(--accent-fg));
  animation: node-pulse 2s ease-in-out infinite;
}

@keyframes node-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.3); }
  50% { box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.1); }
}

.agent-node:focus-visible {
  outline: 2px solid var(--accent-fg);
  outline-offset: 2px;
}

/* Parallel group badge */
.parallel-badge {
  position: absolute;
  top: -10px;
  right: 8px;
  padding: 1px 8px;
  font-size: 0.625rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--text-primary);
  background: var(--accent-emphasis);
  border-radius: 10px;
  white-space: nowrap;
}

/* Node internals */
.agent-node-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.agent-node-icon {
  font-size: 1rem;
  line-height: 1;
  flex-shrink: 0;
}

.agent-node-name {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.agent-node-model {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  margin-bottom: 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.agent-node-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.agent-node-status {
  margin-left: auto;
  font-size: 0.8125rem;
  line-height: 1;
}

.agent-node-status--in-progress {
  animation: pulse-in-progress 1.5s ease-in-out infinite;
}

@keyframes pulse-in-progress {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

/* ------------------------------------------------------------------ */
/* Detail Panel                                                        */
/* ------------------------------------------------------------------ */
.detail-panel {
  background: var(--canvas-raised);
  border: 1px solid var(--border-default);
  border-radius: 8px;
  overflow: hidden;
}

.detail-panel-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-muted);
}

.detail-panel-icon {
  font-size: 1.125rem;
  line-height: 1;
}

.detail-panel-title {
  flex: 1;
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.detail-panel-close {
  padding: 4px 8px;
  font-size: 0.875rem;
  color: var(--text-tertiary);
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: color var(--transition-fast, 150ms);
}

.detail-panel-close:hover {
  color: var(--text-primary);
}

/* Info section */
.detail-panel-info {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-muted);
}

.detail-info-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
}

.detail-section {
  margin-bottom: 12px;
}

.detail-section-title {
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-tertiary);
  margin: 0 0 6px;
}

.detail-prompt {
  margin: 0;
  padding: 10px 12px;
  font-size: 0.75rem;
  font-family: monospace;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 200px;
  overflow-y: auto;
  color: var(--text-secondary);
  background: var(--canvas-inset);
  border: 1px solid var(--border-muted);
  border-radius: 6px;
}

.detail-info-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}

.detail-info-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.detail-label {
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-tertiary);
}

.detail-value {
  font-size: 0.8125rem;
  color: var(--text-secondary);
}

/* Tool calls list */
.detail-tools {
  padding: 12px 16px 16px;
}

.detail-tools-heading {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 10px;
}

.detail-tools-count {
  font-weight: 400;
  color: var(--text-tertiary);
}

.detail-tools-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.detail-tool-row {
  border-radius: 6px;
  border: 1px solid var(--border-muted);
  overflow: hidden;
}

.detail-tool-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 8px 10px;
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 0.8125rem;
  text-align: left;
  color: var(--text-primary);
  transition: background var(--transition-fast, 150ms);
}

.detail-tool-btn:hover {
  background: var(--canvas-subtle);
}

.detail-tool-idx {
  color: var(--text-tertiary);
  font-size: 0.75rem;
  min-width: 20px;
}

.detail-tool-icon {
  font-size: 0.875rem;
  flex-shrink: 0;
}

.detail-tool-name {
  font-weight: 500;
  white-space: nowrap;
}

.detail-agent-badge {
  font-size: 0.625rem;
  flex-shrink: 0;
}

.detail-tool-args {
  color: var(--text-tertiary);
  font-family: monospace;
  font-size: 0.75rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  flex: 1;
}

.detail-tool-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.detail-tool-dur {
  font-size: 0.75rem;
  color: var(--text-tertiary);
}

.detail-tool-status {
  font-size: 0.75rem;
}

.detail-tool-status.success {
  color: var(--success-fg);
}

.detail-tool-status.failed {
  color: var(--danger-fg);
}

.detail-tool-status.pending {
  color: var(--text-tertiary);
}

/* Expanded tool detail */
.detail-tool-expanded {
  padding: 10px 12px;
  border-top: 1px solid var(--border-muted);
  background: var(--canvas-inset);
}

.detail-tool-error {
  margin-bottom: 8px;
  padding: 8px 10px;
  background: var(--danger-muted);
  border: 1px solid var(--danger-muted);
  border-radius: 6px;
}

.detail-tool-error-label {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--danger-fg);
  margin-bottom: 4px;
}

.detail-tool-error-body {
  font-size: 0.75rem;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--text-primary);
  margin: 0;
  font-family: monospace;
}

.detail-tool-meta {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 16px;
  font-size: 0.75rem;
}

.detail-meta-item {
  display: flex;
  gap: 6px;
  align-items: center;
}

.detail-tool-arguments {
  margin-top: 8px;
}

.detail-tool-args-body {
  margin: 4px 0 0;
  padding: 8px 10px;
  font-size: 0.75rem;
  font-family: monospace;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 160px;
  overflow-y: auto;
  color: var(--text-secondary);
  background: var(--canvas-default);
  border: 1px solid var(--border-muted);
  border-radius: 6px;
}

.font-mono {
  font-family: monospace;
}

/* ------------------------------------------------------------------ */
/* Transition                                                          */
/* ------------------------------------------------------------------ */
.detail-panel-enter-active,
.detail-panel-leave-active {
  transition:
    opacity 200ms ease,
    transform 200ms ease;
}

.detail-panel-enter-from,
.detail-panel-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

/* ------------------------------------------------------------------ */
/* Agent Output & Reasoning                                            */
/* ------------------------------------------------------------------ */
.detail-output {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 300px;
  overflow-y: auto;
  padding: 10px 12px;
  background: var(--canvas-inset);
  border: 1px solid var(--border-muted);
  border-radius: 6px;
}

.detail-output-message {
  font-size: 0.8125rem;
  line-height: 1.5;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;
}

.reasoning-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  width: 100%;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-secondary);
  background: var(--canvas-subtle);
  border: 1px solid var(--border-muted);
  border-radius: 6px;
  cursor: pointer;
  transition: background var(--transition-fast, 150ms);
}

.reasoning-toggle:hover {
  background: var(--canvas-inset);
}

.reasoning-content {
  margin-top: 6px;
  padding: 10px 12px;
  font-size: 0.8125rem;
  line-height: 1.5;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
  background: var(--canvas-inset);
  border: 1px solid var(--border-muted);
  border-radius: 6px;
  max-height: 300px;
  overflow-y: auto;
}

.reasoning-divider {
  border: none;
  border-top: 1px solid var(--border-muted);
  margin: 8px 0;
}
</style>
