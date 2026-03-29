<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from "vue";
import type { TodoItem, TodoDep } from "@tracepilot/types";
import { truncateText } from "@tracepilot/ui";
import { buildTodoRelations } from "@/utils/todoStats";
import { getStatusColors } from "@/utils/designTokens";

const props = defineProps<{
  todos: TodoItem[];
  deps: TodoDep[];
}>();

// ── Layout constants ──
const NODE_W = 170;
const NODE_H = 54;
const GAP_X = 60;
const GAP_Y = 36;
const SUB_ROW_GAP = 16;
const MAX_PER_ROW = 5;

// Absolute zoom limits — independent of graph size
const ZOOM_MIN = 0.05;
const ZOOM_MAX = 5.0;
const FIT_PADDING = 0.9;

const STATUS_ICON: Record<string, string> = {
  done: "✓",
  in_progress: "●",
  pending: "○",
  blocked: "⊘",
};

// Status colors derived from design tokens at component mount
const STATUS_COLOR = computed<Record<string, { stroke: string; fill: string; text: string }>>(() => {
  const colors = getStatusColors();
  return {
    done: {
      stroke: colors.done,
      fill: `${colors.done}1f`, // ~12% opacity in hex
      text: colors.done
    },
    in_progress: {
      stroke: colors.inProgress,
      fill: `${colors.inProgress}1f`,
      text: colors.inProgress
    },
    pending: {
      stroke: "rgba(255,255,255,0.15)",
      fill: "rgba(161,161,170,0.08)",
      text: colors.pending
    },
    blocked: {
      stroke: colors.blocked,
      fill: `${colors.blocked}14`, // ~8% opacity
      text: colors.blocked
    },
  };
});

const STATUSES = ["done", "in_progress", "pending", "blocked"] as const;

const STATUS_LABEL: Record<string, string> = {
  done: "Done",
  in_progress: "In progress",
  pending: "Pending",
  blocked: "Blocked",
};

// ── State ──
const selectedNodeId = ref<string | null>(null);
const hoveredNodeId = ref<string | null>(null);

const todoRelations = computed(() => buildTodoRelations(props.todos, props.deps));
const todoById = computed(() => todoRelations.value.todoById);
const dependenciesByTodoId = computed(() => todoRelations.value.dependenciesByTodoId);
const dependentsByTodoId = computed(() => todoRelations.value.dependentsByTodoId);

// ── Filter & search state ──
const activeStatuses = ref<Set<string>>(new Set(STATUSES));
const searchQuery = ref("");
const pendingFitFromFilter = ref(false);

// All distinct statuses present in the data (includes non-canonical)
const allStatuses = computed(() => {
  const known = new Set<string>(STATUSES);
  const extra = new Set<string>();
  props.todos.forEach(t => { if (!known.has(t.status)) extra.add(t.status); });
  return [...STATUSES, ...extra];
});

// Ensure non-canonical statuses are active by default when first seen
watch(() => props.todos, () => {
  const next = new Set(activeStatuses.value);
  props.todos.forEach(t => {
    if (!next.has(t.status) && !(STATUSES as readonly string[]).includes(t.status)) {
      next.add(t.status);
    }
  });
  if (next.size !== activeStatuses.value.size) activeStatuses.value = next;
}, { immediate: true });

function toggleStatus(status: string) {
  const next = new Set(activeStatuses.value);
  if (next.has(status)) {
    if (next.size > 1) next.delete(status);
  } else {
    next.add(status);
  }
  activeStatuses.value = next;
  pendingFitFromFilter.value = true;
}

function statusCount(status: string): number {
  const counts = statusCounts.value;
  return counts.get(status) ?? 0;
}

const filteredTodos = computed(() =>
  props.todos.filter(t => activeStatuses.value.has(t.status))
);

const searchLower = computed(() => searchQuery.value.toLowerCase().trim());
const searchMatchIds = computed<Set<string> | null>(() => {
  if (!searchLower.value) return null;
  return new Set(
    filteredTodos.value
      .filter(t =>
        t.title.toLowerCase().includes(searchLower.value) ||
        (t.description ?? "").toLowerCase().includes(searchLower.value) ||
        t.id.toLowerCase().includes(searchLower.value)
      )
      .map(t => t.id)
  );
});

// ── Pan & zoom ──
const viewportRef = ref<HTMLElement | null>(null);
const panX = ref(0);
const panY = ref(0);
const isPanning = ref(false);
const panStartX = ref(0);
const panStartY = ref(0);
const zoomLevel = ref(1);

function onPanStart(e: PointerEvent) {
  isPanning.value = true;
  panStartX.value = e.clientX - panX.value;
  panStartY.value = e.clientY - panY.value;
  // Use window listeners so drag continues outside viewport without
  // setPointerCapture (which would swallow click events on SVG nodes)
  window.addEventListener("pointermove", onPanMove);
  window.addEventListener("pointerup", onPanEnd);
}

function onPanMove(e: PointerEvent) {
  if (!isPanning.value) return;
  panX.value = e.clientX - panStartX.value;
  panY.value = e.clientY - panStartY.value;
}

function onPanEnd() {
  if (!isPanning.value) return;
  isPanning.value = false;
  window.removeEventListener("pointermove", onPanMove);
  window.removeEventListener("pointerup", onPanEnd);
}

function applyZoom(newZoom: number, anchorX: number, anchorY: number) {
  const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newZoom));
  const oldZoom = zoomLevel.value;
  panX.value = anchorX - (anchorX - panX.value) * (clamped / oldZoom);
  panY.value = anchorY - (anchorY - panY.value) * (clamped / oldZoom);
  zoomLevel.value = clamped;
}

function zoomIn() {
  const vp = viewportRef.value;
  const cx = vp ? vp.clientWidth / 2 : 0;
  const cy = vp ? vp.clientHeight / 2 : 0;
  applyZoom(zoomLevel.value * 1.2, cx, cy);
}

function zoomOut() {
  const vp = viewportRef.value;
  const cx = vp ? vp.clientWidth / 2 : 0;
  const cy = vp ? vp.clientHeight / 2 : 0;
  applyZoom(zoomLevel.value / 1.2, cx, cy);
}

function fitToView() {
  const vp = viewportRef.value;
  if (!vp) return;
  const vpW = vp.clientWidth;
  const vpH = vp.clientHeight;
  const vb = viewBox.value;
  if (vb.width <= 0 || vb.height <= 0) return;

  const fit = Math.min(vpW / vb.width, vpH / vb.height) * FIT_PADDING;
  const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, fit));
  zoomLevel.value = clamped;
  panX.value = (vpW - vb.width * clamped) / 2;
  panY.value = (vpH - vb.height * clamped) / 2;
}

function onWheel(e: WheelEvent) {
  e.preventDefault();
  const vp = viewportRef.value;
  if (!vp) return;
  const rect = vp.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  applyZoom(zoomLevel.value * factor, mouseX, mouseY);
}

const zoomPercent = computed(() => Math.round(zoomLevel.value * 100));

// ── Edges normalised to { from, to } (dependsOn → todoId) ──
const edges = computed(() => {
  const todoIds = new Set(filteredTodos.value.map(t => t.id));
  return props.deps
    .filter(d => todoIds.has(d.dependsOn) && todoIds.has(d.todoId))
    .map(d => ({ from: d.dependsOn, to: d.todoId }));
});

const statusCounts = computed(() => {
  const counts = new Map<string, number>();
  props.todos.forEach(todo => {
    counts.set(todo.status, (counts.get(todo.status) ?? 0) + 1);
  });
  return counts;
});

// ── Topological layout (Kahn's algorithm) with compact grid ──
interface NodePos { x: number; y: number; w: number; h: number }
interface LayoutResult { positions: Record<string, NodePos>; hasCycle: boolean }

const layoutResult = computed<LayoutResult>(() => {
  const todos = filteredTodos.value;
  const edgeList = edges.value;

  const inDeg: Record<string, number> = {};
  const adj: Record<string, string[]> = {};
  todos.forEach(t => {
    inDeg[t.id] = 0;
    adj[t.id] = [];
  });
  edgeList.forEach(e => {
    adj[e.from].push(e.to);
    inDeg[e.to]++;
  });

  const levels: Record<string, number> = {};
  const queue: string[] = [];
  todos.forEach(t => {
    if (inDeg[t.id] === 0) {
      queue.push(t.id);
      levels[t.id] = 0;
    }
  });

  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    for (const next of adj[cur]) {
      levels[next] = Math.max(levels[next] ?? 0, levels[cur] + 1);
      inDeg[next]--;
      if (inDeg[next] === 0) queue.push(next);
    }
  }

  const cycleNodes = todos.filter(t => levels[t.id] === undefined);
  const detectedCycle = cycleNodes.length > 0;
  const maxLevel = Math.max(0, ...Object.values(levels));
  const cycleLevel = cycleNodes.length > 0 ? maxLevel + 1 : maxLevel;
  cycleNodes.forEach(t => { levels[t.id] = cycleLevel; });

  const byLevel: Record<number, TodoItem[]> = {};
  todos.forEach(t => {
    const lv = levels[t.id] ?? 0;
    if (!byLevel[lv]) byLevel[lv] = [];
    byLevel[lv].push(t);
  });

  const effectiveMax = cycleNodes.length > 0 ? cycleLevel : maxLevel;
  const positions: Record<string, NodePos> = {};

  let cumulativeY = 0;
  for (let lv = 0; lv <= effectiveMax; lv++) {
    const items = byLevel[lv] || [];
    if (items.length === 0) {
      cumulativeY += NODE_H + GAP_Y;
      continue;
    }

    // Chunk into sub-rows to avoid excessive horizontal spread
    const subRows: TodoItem[][] = [];
    for (let i = 0; i < items.length; i += MAX_PER_ROW) {
      subRows.push(items.slice(i, i + MAX_PER_ROW));
    }

    subRows.forEach((row, rowIdx) => {
      const totalW = row.length * NODE_W + (row.length - 1) * GAP_X;
      const startX = -totalW / 2;
      row.forEach((t, i) => {
        positions[t.id] = {
          x: startX + i * (NODE_W + GAP_X),
          y: cumulativeY + rowIdx * (NODE_H + SUB_ROW_GAP),
          w: NODE_W,
          h: NODE_H,
        };
      });
    });

    const levelHeight = subRows.length * NODE_H + (subRows.length - 1) * SUB_ROW_GAP;
    cumulativeY += levelHeight + GAP_Y;
  }

  return { positions, hasCycle: detectedCycle };
});

const layout = computed(() => layoutResult.value.positions);
const hasCycle = computed(() => layoutResult.value.hasCycle);

// ── SVG viewBox ──
const viewBox = computed(() => {
  const positions = Object.values(layout.value);
  if (positions.length === 0) return { minX: 0, minY: 0, width: 400, height: 200 };
  const minX = Math.min(...positions.map(p => p.x)) - 30;
  const maxX = Math.max(...positions.map(p => p.x + p.w)) + 30;
  const minY = Math.min(...positions.map(p => p.y)) - 20;
  const maxY = Math.max(...positions.map(p => p.y + p.h)) + 20;
  return { minX, minY, width: maxX - minX, height: maxY - minY };
});

// ── Edge paths ──
const edgePaths = computed(() =>
  edges.value.map((e, i) => {
    const from = layout.value[e.from];
    const to = layout.value[e.to];
    if (!from || !to) return null;
    const x1 = from.x + from.w / 2;
    const y1 = from.y + from.h;
    const x2 = to.x + to.w / 2;
    const y2 = to.y;
    const cy1 = y1 + (y2 - y1) * 0.4;
    const cy2 = y1 + (y2 - y1) * 0.6;
    // Retain horizontal offset in last control point so the arrow
    // tangent reflects the actual approach angle instead of always
    // pointing straight down.
    const cx2 = x2 + (x1 - x2) * 0.25;
    const targetTodo = filteredTodos.value.find(t => t.id === e.to);
    const status = targetTodo?.status || "pending";
    const color = STATUS_COLOR.value[status]?.stroke ?? STATUS_COLOR.value.pending.stroke;
    return {
      id: `edge-${i}`,
      d: `M${x1},${y1} C${x1},${cy1} ${cx2},${cy2} ${x2},${y2}`,
      color,
      status,
      from: e.from,
      to: e.to,
    };
  }).filter(Boolean) as {
    id: string; d: string; color: string; status: string; from: string; to: string;
  }[]
);

// ── Hover / selection helpers ──
function getConnectedNodeIds(todoId: string): Set<string> {
  const set = new Set<string>([todoId]);
  edges.value.forEach(e => {
    if (e.from === todoId || e.to === todoId) {
      set.add(e.from);
      set.add(e.to);
    }
  });
  return set;
}

function isEdgeConnected(edge: { from: string; to: string }, todoId: string): boolean {
  return edge.from === todoId || edge.to === todoId;
}

function nodeClass(todo: TodoItem): string {
  const classes = ["dag-node"];
  if (todo.status === "done") classes.push("done-node");
  if (selectedNodeId.value === todo.id) classes.push("selected");

  // Determine which node drives highlighting: hover takes priority, then selection
  const activeId = hoveredNodeId.value ?? selectedNodeId.value;

  if (searchMatchIds.value) {
    classes.push(searchMatchIds.value.has(todo.id) ? "search-match" : "search-dim");
  } else if (activeId) {
    const connected = getConnectedNodeIds(activeId);
    if (connected.has(todo.id)) {
      classes.push("highlighted");
    } else if (selectedNodeId.value !== todo.id) {
      classes.push("faded");
    }
  }
  return classes.join(" ");
}

function edgeClass(edge: { from: string; to: string }): string {
  const classes = ["dag-edge"];
  const activeId = hoveredNodeId.value ?? selectedNodeId.value;
  if (searchMatchIds.value) {
    const hasMatch = searchMatchIds.value.has(edge.from) || searchMatchIds.value.has(edge.to);
    classes.push(hasMatch ? "search-match" : "search-dim");
  } else if (activeId) {
    classes.push(isEdgeConnected(edge, activeId) ? "highlighted" : "faded");
  }
  return classes.join(" ");
}

function edgeOpacity(edge: { from: string; to: string }): number {
  if (searchMatchIds.value) {
    return (searchMatchIds.value.has(edge.from) || searchMatchIds.value.has(edge.to)) ? 0.6 : 0.08;
  }
  const activeId = hoveredNodeId.value ?? selectedNodeId.value;
  if (!activeId) return 0.35;
  return isEdgeConnected(edge, activeId) ? 0.8 : 0.1;
}

// ── Click / hover handlers ──
function onNodeClick(todoId: string) {
  selectedNodeId.value = selectedNodeId.value === todoId ? null : todoId;
}
function onNodeEnter(todoId: string) {
  hoveredNodeId.value = todoId;
}
function onNodeLeave() {
  hoveredNodeId.value = null;
}
function closeDetail() {
  selectedNodeId.value = null;
}

// ── Selected todo detail ──
const selectedTodo = computed(() =>
  selectedNodeId.value ? props.todos.find(t => t.id === selectedNodeId.value) ?? null : null
);

function getDependencies(todoId: string): TodoItem[] {
  const depIds = dependenciesByTodoId.value.get(todoId);
  if (!depIds) return [];
  return depIds
    .map(id => todoById.value.get(id))
    .filter(Boolean) as TodoItem[];
}

function getDependents(todoId: string): TodoItem[] {
  const depIds = dependentsByTodoId.value.get(todoId);
  if (!depIds) return [];
  return depIds
    .map(id => todoById.value.get(id))
    .filter(Boolean) as TodoItem[];
}

// Preserve selection across refreshes — clear if node is removed or filtered out
watch(() => props.todos, (newTodos) => {
  if (selectedNodeId.value && !newTodos.some(t => t.id === selectedNodeId.value)) {
    selectedNodeId.value = null;
  }
  if (hoveredNodeId.value && !newTodos.some(t => t.id === hoveredNodeId.value)) {
    hoveredNodeId.value = null;
  }
});

watch(filteredTodos, (visible) => {
  if (selectedNodeId.value && !visible.some(t => t.id === selectedNodeId.value)) {
    selectedNodeId.value = null;
  }
  if (hoveredNodeId.value && !visible.some(t => t.id === hoveredNodeId.value)) {
    hoveredNodeId.value = null;
  }
});

// ── Auto-fit on mount and explicit view changes ──
let resizeObserver: ResizeObserver | null = null;
let hasInitialSize = false;

onMounted(() => {
  nextTick(() => fitToView());

  // ResizeObserver handles hidden-container → visible transitions (e.g., tab switch)
  if (viewportRef.value) {
    resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry && entry.contentRect.width > 0 && entry.contentRect.height > 0) {
        if (!hasInitialSize) {
          hasInitialSize = true;
          nextTick(() => fitToView());
        }
      } else {
        hasInitialSize = false;
      }
    });
    resizeObserver.observe(viewportRef.value);
  }
});

onUnmounted(() => {
  resizeObserver?.disconnect();
  window.removeEventListener("pointermove", onPanMove);
  window.removeEventListener("pointerup", onPanEnd);
});

// Only re-fit when the user explicitly toggles a filter, not on auto-refresh
watch(filteredTodos, () => {
  if (pendingFitFromFilter.value) {
    pendingFitFromFilter.value = false;
    nextTick(() => fitToView());
  }
});
</script>

<template>
  <div class="todo-graph-root">
    <!-- Toolbar: status filters + search -->
    <div class="graph-toolbar">
      <div class="status-filters">
        <button
          v-for="status in allStatuses"
          :key="status"
          :class="['filter-chip', status, { active: activeStatuses.has(status) }]"
          :aria-pressed="activeStatuses.has(status)"
          @click="toggleStatus(status)"
        >
          <span class="filter-icon">{{ STATUS_ICON[status] ?? "?" }}</span>
          {{ STATUS_LABEL[status] ?? status }}
          <span class="filter-count">{{ statusCount(status) }}</span>
        </button>
      </div>
      <div class="search-box">
        <svg class="search-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path d="M11.5 7a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Zm-.82 4.74a6 6 0 1 1 1.06-1.06l3.04 3.04a.75.75 0 1 1-1.06 1.06l-3.04-3.04Z"/>
        </svg>
        <input
          type="text"
          v-model="searchQuery"
          placeholder="Search todos…"
          class="search-input"
        />
        <button
          v-if="searchQuery"
          class="search-clear"
          @click="searchQuery = ''"
          aria-label="Clear search"
        >✕</button>
      </div>
    </div>

    <!-- Cycle warning -->
    <div v-if="hasCycle" class="cycle-warning">
      ⚠ Dependency cycle detected — some nodes are shown in a separate row.
    </div>

    <!-- Graph panel -->
    <div class="graph-panel">
      <div class="zoom-controls">
        <button class="zoom-btn" @click="zoomIn" title="Zoom in">+</button>
        <button class="zoom-btn" @click="zoomOut" title="Zoom out">−</button>
        <span class="zoom-pct" :title="`Zoom: ${zoomPercent}%`">{{ zoomPercent }}%</span>
        <button class="zoom-btn" @click="fitToView" title="Fit to view">⊡</button>
      </div>
      <div
        ref="viewportRef"
        class="graph-viewport"
        @pointerdown="onPanStart"
        @wheel.prevent="onWheel"
      >
        <div class="graph-transform" :style="{ transform: `translate(${panX}px, ${panY}px) scale(${zoomLevel})` }">
          <svg
            class="graph-svg"
            :width="viewBox.width"
            :height="viewBox.height"
            :viewBox="`${viewBox.minX} ${viewBox.minY} ${viewBox.width} ${viewBox.height}`"
            xmlns="http://www.w3.org/2000/svg"
          >
        <defs>
          <marker
            v-for="s in STATUSES"
            :key="s"
            :id="`arrow-${s}`"
            markerWidth="8"
            markerHeight="6"
            refX="8"
            refY="3"
            orient="auto"
          >
            <polygon
              points="0 0, 8 3, 0 6"
              :fill="STATUS_COLOR[s].stroke"
              opacity="0.6"
              class="edge-arrow"
            />
          </marker>
          <marker
            id="legend-arrow"
            markerWidth="6"
            markerHeight="4"
            refX="6"
            refY="2"
            orient="auto"
          >
            <polygon points="0 0, 6 2, 0 4" fill="var(--text-placeholder)" />
          </marker>
        </defs>

        <!-- Edges -->
        <path
          v-for="edge in edgePaths"
          :key="edge.id"
          :class="edgeClass(edge)"
          :d="edge.d"
          :stroke="edge.color"
          :opacity="edgeOpacity(edge)"
          :marker-end="`url(#arrow-${edge.status})`"
        />

        <!-- Nodes -->
        <g
          v-for="todo in filteredTodos"
          :key="todo.id"
          :class="nodeClass(todo)"
          :data-id="todo.id"
          @click="onNodeClick(todo.id)"
          @mouseenter="onNodeEnter(todo.id)"
          @mouseleave="onNodeLeave()"
        >
          <rect
            :class="['node-rect', todo.status]"
            :x="layout[todo.id]?.x ?? 0"
            :y="layout[todo.id]?.y ?? 0"
            :width="NODE_W"
            :height="NODE_H"
            :stroke-dasharray="todo.status === 'blocked' ? '6 3' : undefined"
          />
          <text
            class="node-status-icon"
            :x="(layout[todo.id]?.x ?? 0) + 10"
            :y="(layout[todo.id]?.y ?? 0) + 20"
            :fill="STATUS_COLOR[todo.status]?.text ?? STATUS_COLOR.pending.text"
          >{{ STATUS_ICON[todo.status] ?? "○" }}</text>
          <text
            class="node-title"
            :x="(layout[todo.id]?.x ?? 0) + 26"
            :y="(layout[todo.id]?.y ?? 0) + 20"
          >{{ truncateText(todo.title, 18) }}</text>
          <text
            class="node-desc"
            :x="(layout[todo.id]?.x ?? 0) + 10"
            :y="(layout[todo.id]?.y ?? 0) + 38"
          >{{ truncateText(todo.description ?? "", 28) }}</text>
        </g>
      </svg>
        </div>
      </div>
    </div>

    <!-- Legend -->
    <div class="legend-bar">
      <div class="legend-item">
        <div class="legend-swatch done"></div> Done (✓)
      </div>
      <div class="legend-item">
        <div class="legend-swatch in_progress"></div> In Progress (●)
      </div>
      <div class="legend-item">
        <div class="legend-swatch pending"></div> Pending (○)
      </div>
      <div class="legend-item">
        <div class="legend-swatch blocked"></div> Blocked (⊘)
      </div>
      <div class="legend-item legend-direction">
        <svg width="24" height="8">
          <path
            d="M0,4 C8,4 16,4 24,4"
            stroke="var(--text-placeholder)"
            stroke-width="1.5"
            fill="none"
            marker-end="url(#legend-arrow)"
          />
        </svg>
        Dependency direction
      </div>
    </div>

    <!-- Detail panel -->
    <div v-if="selectedTodo" class="detail-panel">
      <div class="detail-panel-header">
        <div class="detail-panel-title">
          <span
            class="detail-status-icon"
            :style="{ color: STATUS_COLOR[selectedTodo.status]?.text }"
          >{{ STATUS_ICON[selectedTodo.status] ?? "○" }}</span>
          <span>{{ selectedTodo.title }}</span>
          <span :class="['detail-badge', selectedTodo.status]">
            {{ selectedTodo.status.replace("_", " ") }}
          </span>
        </div>
        <button class="close-detail" @click="closeDetail" aria-label="Close detail panel">✕</button>
      </div>
      <div class="detail-panel-body">
        <div class="detail-section">
          <h4>Description</h4>
          <p class="detail-description">
            {{ selectedTodo.description || "No description" }}
          </p>
          <div class="detail-id">
            ID: <code>{{ selectedTodo.id }}</code>
          </div>
        </div>
        <div class="detail-section">
          <h4>Dependencies ({{ getDependencies(selectedTodo.id).length }})</h4>
          <ul class="dep-list">
            <li v-if="getDependencies(selectedTodo.id).length === 0" class="dep-empty">
              No dependencies
            </li>
            <li v-for="dep in getDependencies(selectedTodo.id)" :key="dep.id">
              <span :style="{ color: STATUS_COLOR[dep.status]?.text }">
                {{ STATUS_ICON[dep.status] ?? "○" }}
              </span>
              {{ dep.title }}
            </li>
          </ul>
        </div>
        <div class="detail-section">
          <h4>Dependents ({{ getDependents(selectedTodo.id).length }})</h4>
          <ul class="dep-list">
            <li v-if="getDependents(selectedTodo.id).length === 0" class="dep-empty">
              No dependents
            </li>
            <li v-for="dep in getDependents(selectedTodo.id)" :key="dep.id">
              <span :style="{ color: STATUS_COLOR[dep.status]?.text }">
                {{ STATUS_ICON[dep.status] ?? "○" }}
              </span>
              {{ dep.title }}
            </li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.todo-graph-root {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* Toolbar */
.graph-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.status-filters {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  font-size: 0.6875rem;
  font-weight: 500;
  border-radius: var(--radius-full);
  border: 1px solid var(--border-default);
  background: var(--canvas-default);
  color: var(--text-tertiary);
  cursor: pointer;
  transition: all 0.15s ease;
  opacity: 0.5;
  user-select: none;
}
.filter-chip:hover { opacity: 0.75; }
.filter-chip.active { opacity: 1; }
.filter-chip.active.done { background: rgba(52, 211, 153, 0.1); border-color: #34d399; color: #34d399; }
.filter-chip.active.in_progress { background: rgba(99, 102, 241, 0.1); border-color: #818cf8; color: #818cf8; }
.filter-chip.active.pending { background: rgba(161, 161, 170, 0.08); border-color: var(--border-default); color: #a1a1aa; }
.filter-chip.active.blocked { background: rgba(251, 113, 133, 0.08); border-color: #fb7185; color: #fb7185; }

.filter-icon { font-size: 0.75rem; }
.filter-count {
  font-size: 0.5625rem;
  background: rgba(255, 255, 255, 0.06);
  padding: 0 5px;
  border-radius: var(--radius-full);
  font-variant-numeric: tabular-nums;
}

/* Search */
.search-box {
  position: relative;
  display: flex;
  align-items: center;
  margin-left: auto;
}
.search-icon {
  position: absolute;
  left: 8px;
  color: var(--text-placeholder);
  pointer-events: none;
}
.search-input {
  padding: 5px 28px 5px 28px;
  font-size: 0.75rem;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--canvas-default);
  color: var(--text-primary);
  outline: none;
  width: 180px;
  transition: border-color 0.15s, width 0.2s;
}
.search-input:focus {
  border-color: var(--accent-fg);
  width: 220px;
}
.search-input::placeholder { color: var(--text-placeholder); }
.search-clear {
  position: absolute;
  right: 6px;
  background: none;
  border: none;
  color: var(--text-placeholder);
  cursor: pointer;
  font-size: 11px;
  padding: 2px;
  border-radius: var(--radius-sm);
  transition: color 0.15s;
}
.search-clear:hover { color: var(--text-primary); }

/* Cycle warning */
.cycle-warning {
  padding: 10px 16px;
  background: rgba(251, 113, 133, 0.08);
  border: 1px solid #fb7185;
  border-radius: var(--radius-lg);
  color: #fb7185;
  font-size: 0.8125rem;
  font-weight: 500;
}

/* Graph panel */
.graph-panel {
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  padding: 20px;
  min-height: 440px;
  position: relative;
  overflow: hidden;
}
.graph-viewport {
  overflow: hidden;
  cursor: grab;
  min-height: 440px;
  touch-action: none;
  user-select: none;
}
.graph-viewport:active { cursor: grabbing; }
.graph-transform {
  transform-origin: 0 0;
  transition: transform 0.1s ease;
}
.graph-svg {
  display: block;
}
.zoom-controls {
  position: absolute;
  top: 12px;
  right: 12px;
  display: flex;
  align-items: center;
  gap: 4px;
  z-index: 10;
}
.zoom-btn {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-default);
  background: var(--canvas-overlay);
  color: var(--text-secondary);
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}
.zoom-btn:hover {
  background: var(--canvas-subtle);
  color: var(--text-primary);
}
.zoom-pct {
  font-size: 0.625rem;
  font-weight: 500;
  color: var(--text-tertiary);
  min-width: 36px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  user-select: none;
}

/* Node styles */
.dag-node { cursor: pointer; transition: opacity 0.2s ease; }
.dag-node:hover .node-rect { filter: brightness(1.2); }
.dag-node.selected .node-rect { stroke-width: 2.5; filter: brightness(1.3); }
.dag-node.selected { opacity: 1 !important; }
.dag-node.faded { opacity: 0.25; }
.dag-node.highlighted { opacity: 1; }
.dag-node.search-match { opacity: 1; }
.dag-node.search-dim { opacity: 0.15; }
.done-node { opacity: 0.7; }

.node-rect {
  rx: 8;
  ry: 8;
  stroke-width: 1.5;
  transition: filter 0.2s ease, stroke-width 0.2s ease;
}
.node-rect.done { fill: rgba(52, 211, 153, 0.12); stroke: #34d399; }
.node-rect.in_progress { fill: rgba(99, 102, 241, 0.12); stroke: #818cf8; }
.node-rect.pending { fill: rgba(161, 161, 170, 0.08); stroke: rgba(255, 255, 255, 0.15); }
.node-rect.blocked { fill: rgba(251, 113, 133, 0.08); stroke: #fb7185; }

.node-title { font-size: 11px; font-weight: 600; fill: var(--text-primary); }
.node-desc { font-size: 9.5px; fill: var(--text-tertiary); }
.node-status-icon { font-size: 12px; }

/* Edge styles */
.dag-edge {
  fill: none;
  stroke-width: 1.5;
  transition: stroke 0.2s ease, opacity 0.2s ease;
}
.dag-edge.faded { opacity: 0.1; }
.dag-edge.highlighted { stroke-width: 2.5; opacity: 1; }
.dag-edge.search-dim { opacity: 0.08; }
.dag-edge.search-match { stroke-width: 2; }
.edge-arrow { transition: fill 0.2s ease; }

/* Legend bar */
.legend-bar {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 10px 16px;
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
}
.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}
.legend-direction {
  margin-left: auto;
  color: var(--text-placeholder);
}
.legend-swatch {
  width: 14px;
  height: 14px;
  border-radius: 4px;
  border: 1.5px solid;
}
.legend-swatch.done { background: rgba(52, 211, 153, 0.15); border-color: #34d399; }
.legend-swatch.in_progress { background: rgba(99, 102, 241, 0.15); border-color: #818cf8; }
.legend-swatch.pending { background: rgba(161, 161, 170, 0.08); border-color: var(--border-default); }
.legend-swatch.blocked { background: rgba(251, 113, 133, 0.08); border-color: #fb7185; border-style: dashed; }

/* Detail panel */
.detail-panel {
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  overflow: hidden;
  animation: fadeIn 0.2s ease;
}
.detail-panel-header {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-default);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.detail-panel-title {
  font-size: 0.875rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
}
.detail-status-icon {
  font-size: 14px;
}
.detail-badge {
  font-size: 0.625rem;
  padding: 2px 8px;
  border-radius: var(--radius-full);
  font-weight: 500;
  text-transform: capitalize;
}
.detail-badge.done { background: rgba(52, 211, 153, 0.15); color: #34d399; }
.detail-badge.in_progress { background: rgba(99, 102, 241, 0.15); color: #818cf8; }
.detail-badge.pending { background: rgba(161, 161, 170, 0.1); color: #a1a1aa; }
.detail-badge.blocked { background: rgba(251, 113, 133, 0.1); color: #fb7185; }

.detail-panel-body {
  padding: 16px;
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 16px;
}
.detail-section h4 {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 8px;
}
.detail-description {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  line-height: 1.6;
}
.detail-id {
  margin-top: 10px;
  font-size: 0.6875rem;
  color: var(--text-placeholder);
}
.detail-id code {
  color: var(--text-tertiary);
  font-family: monospace;
}
.dep-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0;
  margin: 0;
}
.dep-list li {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
  color: var(--text-secondary);
  padding: 4px 8px;
  background: var(--canvas-default);
  border-radius: var(--radius-sm);
}
.dep-empty {
  color: var(--text-placeholder) !important;
  background: none !important;
}
.close-detail {
  background: none;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  padding: 4px;
  border-radius: var(--radius-sm);
  font-size: 14px;
  transition: color 0.15s;
}
.close-detail:hover { color: var(--text-primary); }

@media (max-width: 900px) {
  .detail-panel-body { grid-template-columns: 1fr; }
  .graph-toolbar { flex-direction: column; align-items: stretch; }
  .search-box { margin-left: 0; }
  .search-input { width: 100%; }
  .search-input:focus { width: 100%; }
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
