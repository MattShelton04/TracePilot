<script setup lang="ts">
import { ref, computed, watch } from "vue";
import type { TodoItem, TodoDep } from "@tracepilot/types";

const props = defineProps<{
  todos: TodoItem[];
  deps: TodoDep[];
}>();

// ── Constants ──
const NODE_W = 170;
const NODE_H = 54;
const GAP_X = 60;
const GAP_Y = 36;

const STATUS_ICON: Record<string, string> = {
  done: "✓",
  in_progress: "●",
  pending: "○",
  blocked: "⊘",
};

const STATUS_COLOR: Record<string, { stroke: string; fill: string; text: string }> = {
  done: { stroke: "#34d399", fill: "rgba(52,211,153,0.12)", text: "#34d399" },
  in_progress: { stroke: "#818cf8", fill: "rgba(99,102,241,0.12)", text: "#818cf8" },
  pending: { stroke: "rgba(255,255,255,0.15)", fill: "rgba(161,161,170,0.08)", text: "#a1a1aa" },
  blocked: { stroke: "#fb7185", fill: "rgba(251,113,133,0.08)", text: "#fb7185" },
};

const STATUSES = ["done", "in_progress", "pending", "blocked"] as const;

// ── State ──
const selectedNodeId = ref<string | null>(null);
const hoveredNodeId = ref<string | null>(null);

// ── Edges normalised to { from, to } (dependsOn → todoId) ──
const edges = computed(() =>
  props.deps
    .filter(
      (d) =>
        props.todos.some((t) => t.id === d.dependsOn) &&
        props.todos.some((t) => t.id === d.todoId)
    )
    .map((d) => ({ from: d.dependsOn, to: d.todoId }))
);

// ── Topological layout (Kahn's algorithm) ──
interface NodePos { x: number; y: number; w: number; h: number }
interface LayoutResult { positions: Record<string, NodePos>; hasCycle: boolean }

const layoutResult = computed<LayoutResult>(() => {
  const todos = props.todos;
  const edgeList = edges.value;

  // Build adjacency & in-degree
  const inDeg: Record<string, number> = {};
  const adj: Record<string, string[]> = {};
  todos.forEach((t) => {
    inDeg[t.id] = 0;
    adj[t.id] = [];
  });
  edgeList.forEach((e) => {
    adj[e.from].push(e.to);
    inDeg[e.to]++;
  });

  // Kahn's
  const levels: Record<string, number> = {};
  const queue: string[] = [];
  todos.forEach((t) => {
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

  // Detect cycle: any node not yet assigned a level
  const cycleNodes = todos.filter((t) => levels[t.id] === undefined);
  const detectedCycle = cycleNodes.length > 0;

  // Place cycle nodes in one extra row at the end
  const maxLevel = Math.max(0, ...Object.values(levels));
  const cycleLevel = cycleNodes.length > 0 ? maxLevel + 1 : maxLevel;
  cycleNodes.forEach((t) => {
    levels[t.id] = cycleLevel;
  });

  // Group by level
  const byLevel: Record<number, TodoItem[]> = {};
  todos.forEach((t) => {
    const lv = levels[t.id] ?? 0;
    if (!byLevel[lv]) byLevel[lv] = [];
    byLevel[lv].push(t);
  });

  const effectiveMax = cycleNodes.length > 0 ? cycleLevel : maxLevel;
  const positions: Record<string, NodePos> = {};
  for (let lv = 0; lv <= effectiveMax; lv++) {
    const items = byLevel[lv] || [];
    const totalW = items.length * NODE_W + (items.length - 1) * GAP_X;
    const startX = -totalW / 2;
    items.forEach((t, i) => {
      positions[t.id] = {
        x: startX + i * (NODE_W + GAP_X),
        y: lv * (NODE_H + GAP_Y),
        w: NODE_W,
        h: NODE_H,
      };
    });
  }

  return { positions, hasCycle: detectedCycle };
});

const layout = computed(() => layoutResult.value.positions);
const hasCycle = computed(() => layoutResult.value.hasCycle);

// ── SVG viewBox ──
const viewBox = computed(() => {
  const positions = Object.values(layout.value);
  if (positions.length === 0) return { minX: 0, minY: 0, width: 400, height: 200 };
  const minX = Math.min(...positions.map((p) => p.x)) - 30;
  const maxX = Math.max(...positions.map((p) => p.x + p.w)) + 30;
  const minY = Math.min(...positions.map((p) => p.y)) - 20;
  const maxY = Math.max(...positions.map((p) => p.y + p.h)) + 20;
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
    const targetTodo = props.todos.find((t) => t.id === e.to);
    const status = targetTodo?.status || "pending";
    const color = STATUS_COLOR[status]?.stroke ?? STATUS_COLOR.pending.stroke;
    return {
      id: `edge-${i}`,
      d: `M${x1},${y1} C${x1},${cy1} ${x2},${cy2} ${x2},${y2}`,
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
  edges.value.forEach((e) => {
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

  if (hoveredNodeId.value) {
    const connected = getConnectedNodeIds(hoveredNodeId.value);
    classes.push(connected.has(todo.id) ? "highlighted" : "faded");
  }
  return classes.join(" ");
}

function edgeClass(edge: { from: string; to: string }): string {
  const classes = ["dag-edge"];
  if (hoveredNodeId.value) {
    classes.push(isEdgeConnected(edge, hoveredNodeId.value) ? "highlighted" : "faded");
  }
  return classes.join(" ");
}

function edgeOpacity(edge: { from: string; to: string }): number {
  if (!hoveredNodeId.value) return 0.35;
  return isEdgeConnected(edge, hoveredNodeId.value) ? 0.8 : 0.1;
}

function truncate(s: string, len: number): string {
  return s.length > len ? s.slice(0, len) + "…" : s;
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
  selectedNodeId.value ? props.todos.find((t) => t.id === selectedNodeId.value) ?? null : null
);

function getDependencies(todoId: string): TodoItem[] {
  const depIds = props.deps.filter((d) => d.todoId === todoId).map((d) => d.dependsOn);
  return depIds
    .map((id) => props.todos.find((t) => t.id === id))
    .filter(Boolean) as TodoItem[];
}

function getDependents(todoId: string): TodoItem[] {
  const depIds = props.deps.filter((d) => d.dependsOn === todoId).map((d) => d.todoId);
  return depIds
    .map((id) => props.todos.find((t) => t.id === id))
    .filter(Boolean) as TodoItem[];
}

// Reset selection when todos change
watch(() => props.todos, () => {
  selectedNodeId.value = null;
  hoveredNodeId.value = null;
});
</script>

<template>
  <div class="todo-graph-root">
    <!-- Cycle warning -->
    <div v-if="hasCycle" class="cycle-warning">
      ⚠ Dependency cycle detected — some nodes are shown in a separate row.
    </div>

    <!-- Graph panel -->
    <div class="graph-panel">
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
          v-for="todo in todos"
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
          >{{ truncate(todo.title, 18) }}</text>
          <text
            class="node-desc"
            :x="(layout[todo.id]?.x ?? 0) + 10"
            :y="(layout[todo.id]?.y ?? 0) + 38"
          >{{ truncate(todo.description ?? "", 28) }}</text>
        </g>
      </svg>
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
  overflow: auto;
}
.graph-svg {
  display: block;
  margin: 0 auto;
}

/* Node styles */
.dag-node { cursor: pointer; transition: opacity 0.2s ease; }
.dag-node:hover .node-rect { filter: brightness(1.2); }
.dag-node.selected .node-rect { stroke-width: 2.5; }
.dag-node.faded { opacity: 0.25; }
.dag-node.highlighted { opacity: 1; }
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
.legend-swatch.pending { background: rgba(161, 161, 170, 0.08); border-color: rgba(255, 255, 255, 0.2); }
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
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
