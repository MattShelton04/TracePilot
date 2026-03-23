<script setup lang="ts">
import { computed, ref } from "vue";
import { useSessionDetailStore } from "@/stores/sessionDetail";
import { Badge, StatusIcon, EmptyState, SectionPanel, LoadingSpinner, useSessionTabLoader } from "@tracepilot/ui";
import TodoDependencyGraph from "@/components/TodoDependencyGraph.vue";

const store = useSessionDetailStore();
const isTodosLoading = ref(false);
let loadToken = 0;

useSessionTabLoader(
  () => store.sessionId,
  async () => {
    const token = ++loadToken;
    if (!store.sessionId || store.loaded.has("todos")) return;
    isTodosLoading.value = true;
    try {
      await store.loadTodos();
    } finally {
      if (loadToken === token) isTodosLoading.value = false;
    }
  },
  {
    onClear() {
      loadToken++;
      isTodosLoading.value = false;
    },
  }
);

const todos = computed(() => store.todos?.todos ?? []);
const deps = computed(() => store.todos?.deps ?? []);
const hasTodos = computed(() => todos.value.length > 0);

const completedCount = computed(() => todos.value.filter(t => t.status === 'done').length);
const inProgressCount = computed(() => todos.value.filter(t => t.status === 'in_progress').length);
const blockedCount = computed(() => todos.value.filter(t => t.status === 'blocked').length);
const pendingCount = computed(() => todos.value.filter(t => t.status !== 'done' && t.status !== 'in_progress' && t.status !== 'blocked').length);
const progressPercent = computed(() => todos.value.length > 0 ? (completedCount.value / todos.value.length) * 100 : 0);

const viewMode = ref<'list' | 'graph'>('graph');

function statusBadgeVariant(status: string): 'done' | 'accent' | 'danger' | 'neutral' {
  switch (status) {
    case "done": return "done";
    case "in_progress": return "accent";
    case "blocked": return "danger";
    default: return "neutral";
  }
}

function getDependencies(todoId: string): string[] {
  return deps.value.filter((dep) => dep.todoId === todoId).map((dep) => dep.dependsOn);
}

function getTodoTitle(id: string): string {
  const todo = todos.value.find((item) => item.id === id);
  return todo?.title || id;
}
</script>

<template>
  <div>
    <div v-if="isTodosLoading" class="todos-loading">
      <LoadingSpinner size="sm" />
      <span class="loading-text">Loading todos…</span>
    </div>

    <EmptyState v-else-if="!hasTodos" message="No todos found in this session." />

    <template v-else>
      <!-- Progress section -->
      <div class="progress-section">
        <div class="flex items-center justify-between mb-2">
          <span class="text-[0.8125rem] font-semibold text-[var(--text-primary)]">
            {{ completedCount }}/{{ todos.length }} completed
          </span>
          <span class="text-[0.8125rem] font-semibold text-[var(--success-fg)]" style="font-variant-numeric: tabular-nums;">
            {{ Math.round(progressPercent) }}%
          </span>
        </div>
        <div class="segmented-progress-bar"
          role="progressbar"
          :aria-valuenow="Math.round(progressPercent)"
          :aria-valuemin="0"
          :aria-valuemax="100"
          :aria-label="`${completedCount} of ${todos.length} todos completed`"
        >
          <div class="seg seg-done" :style="{ width: `${(completedCount / todos.length) * 100}%` }" />
          <div class="seg seg-progress" :style="{ width: `${(inProgressCount / todos.length) * 100}%` }" />
          <div class="seg seg-blocked" :style="{ width: `${(blockedCount / todos.length) * 100}%` }" />
          <div class="seg seg-pending" :style="{ width: `${(pendingCount / todos.length) * 100}%` }" />
        </div>
        <div class="flex items-center gap-3 text-xs flex-wrap">
          <span class="text-[var(--success-fg)]">✓ {{ completedCount }} done</span>
          <span class="text-[var(--text-placeholder)]">·</span>
          <span class="text-[var(--accent-fg)]">● {{ inProgressCount }} in progress</span>
          <span class="text-[var(--text-placeholder)]">·</span>
          <span class="text-[var(--text-tertiary)]">○ {{ pendingCount }} pending</span>
          <span class="text-[var(--text-placeholder)]">·</span>
          <span class="text-[var(--danger-fg)]">⊘ {{ blockedCount }} blocked</span>
        </div>
      </div>

      <!-- View toggle -->
      <div class="view-toggle">
        <button
          :class="['toggle-btn', { active: viewMode === 'list' }]"
          @click="viewMode = 'list'"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2 4h12v1H2V4zm0 4h12v1H2V8zm0 4h12v1H2v-1z"/>
          </svg>
          List
        </button>
        <button
          :class="['toggle-btn', { active: viewMode === 'graph' }]"
          @click="viewMode = 'graph'"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M3 1a2 2 0 0 0-2 2v1a2 2 0 0 0 1.5 1.937V8.5a.5.5 0 0 0 .5.5h4v2.063A2 2 0 0 0 6 13v1a2 2 0 0 0 4 0v-1a2 2 0 0 0-1.5-1.937V9h4a.5.5 0 0 0 .5-.5V5.937A2 2 0 0 0 14.5 4V3a2 2 0 0 0-4 0v1a2 2 0 0 0 1.5 1.937V8H4V5.937A2 2 0 0 0 5.5 4V3a2 2 0 0 0-2-2H3z"/>
          </svg>
          Graph
        </button>
      </div>

      <!-- Graph view -->
      <TodoDependencyGraph
        v-if="viewMode === 'graph'"
        :todos="todos"
        :deps="deps"
      />

      <!-- Todo list -->
      <SectionPanel v-else title="Tasks">
        <template v-for="(todo, index) in todos" :key="todo.id">
          <div
            class="todo-item"
            :style="index === todos.length - 1 ? 'border-bottom: none' : ''"
          >
            <StatusIcon
              :status="todo.status as 'done' | 'in_progress' | 'blocked' | 'pending'"
              style="width: 18px; height: 18px; margin-top: 1px;"
            />
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="todo-title">{{ todo.title }}</span>
                <Badge
                  :variant="statusBadgeVariant(todo.status)"
                  style="font-size: 0.5625rem; padding: 1px 6px;"
                >
                  {{ todo.status.replace('_', ' ') }}
                </Badge>
              </div>
              <div v-if="todo.description" class="todo-desc whitespace-pre-wrap">
                {{ todo.description }}
              </div>
              <div v-if="getDependencies(todo.id).length > 0" class="todo-deps">
                <span style="font-size: 0.5625rem; color: var(--text-placeholder); margin-right: 2px;">depends on:</span>
                <Badge
                  v-for="depId in getDependencies(todo.id)"
                  :key="depId"
                  variant="neutral"
                  style="font-size: 0.5625rem;"
                >
                  {{ getTodoTitle(depId) }}
                </Badge>
              </div>
            </div>
          </div>
        </template>
      </SectionPanel>
    </template>
  </div>
</template>

<style scoped>
.progress-section {
  padding: 16px 18px;
  background: var(--canvas-subtle);
  background-image: var(--gradient-card);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  margin-bottom: 20px;
}

/* View toggle */
.view-toggle {
  display: flex;
  gap: 2px;
  margin-bottom: 16px;
  background: var(--canvas-default);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  padding: 3px;
  width: fit-content;
}

.todos-loading {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background: var(--canvas-subtle);
}

.loading-text {
  font-size: 0.8125rem;
  color: var(--text-secondary);
}

.toggle-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 14px;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-tertiary);
  background: transparent;
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.15s ease;
}
.toggle-btn:hover {
  color: var(--text-secondary);
}
.toggle-btn.active {
  background: var(--canvas-subtle);
  color: var(--text-primary);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
}

/* Segmented progress bar */
.segmented-progress-bar {
  display: flex;
  height: 6px;
  border-radius: 3px;
  overflow: hidden;
  background: var(--canvas-overlay);
  margin-bottom: 8px;
}
.seg {
  height: 100%;
  transition: width 0.3s ease;
}
.seg-done { background: var(--success-fg); }
.seg-progress { background: var(--accent-fg); }
.seg-blocked { background: var(--danger-fg); }
.seg-pending { background: var(--text-placeholder); opacity: 0.3; }

/* Remove section-panel-body padding so items render flush */
:deep(.section-panel-body) {
  padding: 0;
}

/* Flat list todo items with border-bottom separators */
.todo-item {
  display: flex;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-subtle);
  align-items: flex-start;
}

.todo-title {
  font-size: 0.8125rem;
  font-weight: 500;
}

.todo-desc {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  margin-top: 2px;
  line-height: 1.5;
}

.todo-deps {
  margin-top: 4px;
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  align-items: center;
}
</style>
