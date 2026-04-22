<script setup lang="ts">
import type { TodoDep, TodoItem } from "@tracepilot/types";
import { provide, toRef } from "vue";
import { STATUSES } from "@/components/todoDependencyGraph/constants";
import TodoDepDetailSlideover from "@/components/todoDependencyGraph/TodoDepDetailSlideover.vue";
import TodoDepGraphEdge from "@/components/todoDependencyGraph/TodoDepGraphEdge.vue";
import TodoDepGraphLegend from "@/components/todoDependencyGraph/TodoDepGraphLegend.vue";
import TodoDepGraphNode from "@/components/todoDependencyGraph/TodoDepGraphNode.vue";
import TodoDepGraphToolbar from "@/components/todoDependencyGraph/TodoDepGraphToolbar.vue";
import {
  TodoDependencyGraphKey,
  useTodoDependencyGraph,
} from "@/composables/useTodoDependencyGraph";
import "@/styles/features/todo-dependency-graph.css";

const props = defineProps<{
  todos: TodoItem[];
  deps: TodoDep[];
}>();

const ctx = useTodoDependencyGraph({
  todos: toRef(props, "todos"),
  deps: toRef(props, "deps"),
});

provide(TodoDependencyGraphKey, ctx);
</script>

<template>
  <div class="todo-graph-root">
    <TodoDepGraphToolbar />

    <div v-if="ctx.hasCycle.value" class="cycle-warning">
      ⚠ Dependency cycle detected — some nodes are shown in a separate row.
    </div>

    <div class="graph-panel">
      <div class="zoom-controls">
        <button class="zoom-btn" @click="ctx.zoomIn" title="Zoom in">+</button>
        <button class="zoom-btn" @click="ctx.zoomOut" title="Zoom out">−</button>
        <span class="zoom-pct" :title="`Zoom: ${ctx.zoomPercent.value}%`">{{ ctx.zoomPercent.value }}%</span>
        <button class="zoom-btn" @click="ctx.fitToView" title="Fit to view">⊡</button>
      </div>
      <div
        :ref="(el) => { ctx.viewportRef.value = el as HTMLElement | null; }"
        class="graph-viewport"
        @pointerdown="ctx.onPanStart"
        @wheel.prevent="ctx.onWheel"
      >
        <div
          class="graph-transform"
          :style="{ transform: `translate(${ctx.panX.value}px, ${ctx.panY.value}px) scale(${ctx.zoomLevel.value})` }"
        >
          <svg
            class="graph-svg"
            :width="ctx.viewBox.value.width"
            :height="ctx.viewBox.value.height"
            :viewBox="`${ctx.viewBox.value.minX} ${ctx.viewBox.value.minY} ${ctx.viewBox.value.width} ${ctx.viewBox.value.height}`"
            xmlns="http://www.w3.org/2000/svg"
            role="img"
            aria-label="Dependency graph showing todo item relationships"
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
                  :fill="ctx.statusColor.value[s].stroke"
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

            <TodoDepGraphEdge
              v-for="edge in ctx.edgePaths.value"
              :key="edge.id"
              :edge="edge"
            />

            <TodoDepGraphNode
              v-for="todo in ctx.filteredTodos.value"
              :key="todo.id"
              :todo="todo"
            />
          </svg>
        </div>
      </div>
    </div>

    <TodoDepGraphLegend />

    <TodoDepDetailSlideover />
  </div>
</template>
