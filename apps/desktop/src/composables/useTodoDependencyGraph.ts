import type { TodoDep, TodoItem } from "@tracepilot/types";
import {
  computed,
  type InjectionKey,
  inject,
  nextTick,
  onMounted,
  onUnmounted,
  type Ref,
  ref,
  watch,
} from "vue";
import { STATUSES, type StatusColor } from "@/components/todoDependencyGraph/constants";
import { getStatusColors } from "@/utils/designTokens";
import {
  computeEdgePaths,
  computeLayout,
  computeViewBox,
  type LayoutEdge,
} from "@/utils/todoDepLayout";
import { buildTodoRelations } from "@/utils/todoStats";

const ZOOM_MIN = 0.05;
const ZOOM_MAX = 5.0;
const FIT_PADDING = 0.9;

export interface UseTodoDependencyGraphOptions {
  todos: Ref<TodoItem[]>;
  deps: Ref<TodoDep[]>;
}

export type TodoDependencyGraphContext = ReturnType<typeof useTodoDependencyGraph>;

export const TodoDependencyGraphKey: InjectionKey<TodoDependencyGraphContext> =
  Symbol("TodoDependencyGraphKey");

export function useTodoDependencyGraphContext(): TodoDependencyGraphContext {
  const ctx = inject(TodoDependencyGraphKey);
  if (!ctx) {
    throw new Error(
      "useTodoDependencyGraphContext() called outside of TodoDependencyGraph provider",
    );
  }
  return ctx;
}

export function useTodoDependencyGraph(options: UseTodoDependencyGraphOptions) {
  const { todos, deps } = options;

  const statusColor = computed<Record<string, StatusColor>>(() => {
    const colors = getStatusColors();
    return {
      done: {
        stroke: colors.done,
        fill: `color-mix(in srgb, ${colors.done} 12%, transparent)`,
        text: colors.done,
      },
      in_progress: {
        stroke: colors.inProgress,
        fill: `color-mix(in srgb, ${colors.inProgress} 12%, transparent)`,
        text: colors.inProgress,
      },
      pending: {
        stroke: "rgba(255,255,255,0.15)",
        fill: "rgba(161,161,170,0.08)",
        text: colors.pending,
      },
      blocked: {
        stroke: colors.blocked,
        fill: `color-mix(in srgb, ${colors.blocked} 8%, transparent)`,
        text: colors.blocked,
      },
    };
  });

  // Selection & hover
  const selectedNodeId = ref<string | null>(null);
  const hoveredNodeId = ref<string | null>(null);

  const todoRelations = computed(() => buildTodoRelations(todos.value, deps.value));
  const todoById = computed(() => todoRelations.value.todoById);
  const dependenciesByTodoId = computed(() => todoRelations.value.dependenciesByTodoId);
  const dependentsByTodoId = computed(() => todoRelations.value.dependentsByTodoId);

  // Filter & search
  const activeStatuses = ref<Set<string>>(new Set(STATUSES));
  const searchQuery = ref("");
  const pendingFitFromFilter = ref(false);

  const statusCounts = computed(() => {
    const counts = new Map<string, number>();
    todos.value.forEach((todo) => {
      counts.set(todo.status, (counts.get(todo.status) ?? 0) + 1);
    });
    return counts;
  });

  function statusCount(status: string): number {
    return statusCounts.value.get(status) ?? 0;
  }

  const allStatuses = computed(() => {
    const known = new Set<string>(STATUSES);
    const extra = new Set<string>();
    todos.value.forEach((t) => {
      if (!known.has(t.status)) extra.add(t.status);
    });
    return [...STATUSES, ...extra];
  });

  // Ensure non-canonical statuses are active by default when first seen
  watch(
    () => todos.value,
    () => {
      const next = new Set(activeStatuses.value);
      todos.value.forEach((t) => {
        if (!next.has(t.status) && !(STATUSES as readonly string[]).includes(t.status)) {
          next.add(t.status);
        }
      });
      if (next.size !== activeStatuses.value.size) activeStatuses.value = next;
    },
    { immediate: true },
  );

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

  const filteredTodos = computed(() =>
    todos.value.filter((t) => activeStatuses.value.has(t.status)),
  );

  const searchLower = computed(() => searchQuery.value.toLowerCase().trim());
  const searchMatchIds = computed<Set<string> | null>(() => {
    if (!searchLower.value) return null;
    return new Set(
      filteredTodos.value
        .filter(
          (t) =>
            t.title.toLowerCase().includes(searchLower.value) ||
            (t.description ?? "").toLowerCase().includes(searchLower.value) ||
            t.id.toLowerCase().includes(searchLower.value),
        )
        .map((t) => t.id),
    );
  });

  // Edges normalised to { from, to } (dependsOn → todoId)
  const edges = computed<LayoutEdge[]>(() => {
    const todoIds = new Set(filteredTodos.value.map((t) => t.id));
    return deps.value
      .filter((d) => todoIds.has(d.dependsOn) && todoIds.has(d.todoId))
      .map((d) => ({ from: d.dependsOn, to: d.todoId }));
  });

  // Layout
  const layoutResult = computed(() => computeLayout(filteredTodos.value, edges.value));
  const layout = computed(() => layoutResult.value.positions);
  const hasCycle = computed(() => layoutResult.value.hasCycle);
  const viewBox = computed(() => computeViewBox(layout.value));

  // Edge paths with color/status
  const edgePaths = computed(() => {
    const base = computeEdgePaths(edges.value, layout.value);
    return base.map((p) => {
      const targetTodo = filteredTodos.value.find((t) => t.id === p.to);
      const status = targetTodo?.status || "pending";
      const color = statusColor.value[status]?.stroke ?? statusColor.value.pending.stroke;
      return { ...p, color, status };
    });
  });

  // Hover / selection helpers
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

  function isEdgeConnected(edge: LayoutEdge, todoId: string): boolean {
    return edge.from === todoId || edge.to === todoId;
  }

  function nodeClass(todo: TodoItem): string {
    const classes = ["dag-node"];
    if (todo.status === "done") classes.push("done-node");
    if (selectedNodeId.value === todo.id) classes.push("selected");

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

  function edgeClass(edge: LayoutEdge): string {
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

  function edgeOpacity(edge: LayoutEdge): number {
    if (searchMatchIds.value) {
      return searchMatchIds.value.has(edge.from) || searchMatchIds.value.has(edge.to) ? 0.6 : 0.08;
    }
    const activeId = hoveredNodeId.value ?? selectedNodeId.value;
    if (!activeId) return 0.35;
    return isEdgeConnected(edge, activeId) ? 0.8 : 0.1;
  }

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

  const selectedTodo = computed(() =>
    selectedNodeId.value ? (todos.value.find((t) => t.id === selectedNodeId.value) ?? null) : null,
  );

  function getDependencies(todoId: string): TodoItem[] {
    const depIds = dependenciesByTodoId.value.get(todoId);
    if (!depIds) return [];
    return depIds.map((id) => todoById.value.get(id)).filter(Boolean) as TodoItem[];
  }

  function getDependents(todoId: string): TodoItem[] {
    const depIds = dependentsByTodoId.value.get(todoId);
    if (!depIds) return [];
    return depIds.map((id) => todoById.value.get(id)).filter(Boolean) as TodoItem[];
  }

  // Preserve selection across refreshes — clear if node removed or filtered out
  watch(
    () => todos.value,
    (newTodos) => {
      if (selectedNodeId.value && !newTodos.some((t) => t.id === selectedNodeId.value)) {
        selectedNodeId.value = null;
      }
      if (hoveredNodeId.value && !newTodos.some((t) => t.id === hoveredNodeId.value)) {
        hoveredNodeId.value = null;
      }
    },
  );

  watch(filteredTodos, (visible) => {
    if (selectedNodeId.value && !visible.some((t) => t.id === selectedNodeId.value)) {
      selectedNodeId.value = null;
    }
    if (hoveredNodeId.value && !visible.some((t) => t.id === hoveredNodeId.value)) {
      hoveredNodeId.value = null;
    }
  });

  // Pan & zoom
  const viewportRef = ref<HTMLElement | null>(null);
  const panX = ref(0);
  const panY = ref(0);
  const isPanning = ref(false);
  const panStartX = ref(0);
  const panStartY = ref(0);
  const zoomLevel = ref(1);

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

  function onPanStart(e: PointerEvent) {
    isPanning.value = true;
    panStartX.value = e.clientX - panX.value;
    panStartY.value = e.clientY - panY.value;
    window.addEventListener("pointermove", onPanMove);
    window.addEventListener("pointerup", onPanEnd);
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

  // Auto-fit on mount and visibility transitions (hidden container → visible)
  let resizeObserver: ResizeObserver | null = null;
  let hasInitialSize = false;

  onMounted(() => {
    nextTick(() => fitToView());

    if (viewportRef.value && typeof ResizeObserver !== "undefined") {
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

  const ctx = {
    todos,
    deps,
    activeStatuses,
    searchQuery,
    allStatuses,
    statusCount,
    toggleStatus,
    filteredTodos,
    edges,
    searchMatchIds,
    layout,
    hasCycle,
    viewBox,
    edgePaths,
    statusColor,
    selectedNodeId,
    hoveredNodeId,
    selectedTodo,
    onNodeClick,
    onNodeEnter,
    onNodeLeave,
    closeDetail,
    nodeClass,
    edgeClass,
    edgeOpacity,
    getDependencies,
    getDependents,
    viewportRef,
    panX,
    panY,
    zoomLevel,
    zoomPercent,
    onPanStart,
    onWheel,
    zoomIn,
    zoomOut,
    fitToView,
  };

  return ctx;
}
