<script setup lang="ts">
import { computed } from "vue";
import { useSessionDetailStore } from "@/stores/sessionDetail";
import { Badge, StatusIcon, EmptyState, SectionPanel, ProgressBar, useSessionTabLoader } from "@tracepilot/ui";

const store = useSessionDetailStore();

useSessionTabLoader(
  () => store.sessionId,
  () => store.loadTodos()
);

const todos = computed(() => store.todos?.todos ?? []);
const deps = computed(() => store.todos?.deps ?? []);

const completedCount = computed(() => todos.value.filter(t => t.status === 'done').length);
const inProgressCount = computed(() => todos.value.filter(t => t.status === 'in_progress').length);
const blockedCount = computed(() => todos.value.filter(t => t.status === 'blocked').length);
const pendingCount = computed(() => todos.value.filter(t => t.status !== 'done' && t.status !== 'in_progress' && t.status !== 'blocked').length);
const progressPercent = computed(() => todos.value.length > 0 ? (completedCount.value / todos.value.length) * 100 : 0);

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
    <EmptyState v-if="todos.length === 0" message="No todos found in this session." />

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
        <ProgressBar
          :percent="progressPercent"
          color="success"
          class="progress-bar-todo"
          :aria-label="`${completedCount} of ${todos.length} todos completed`"
        />
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

      <!-- Todo list -->
      <SectionPanel title="Tasks">
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

/* Override progress bar height and color to match variant-c */
.progress-bar-todo {
  margin-bottom: 10px;
}
.progress-bar-todo :deep(.progress-bar) {
  height: 8px;
}
.progress-bar-todo :deep(.progress-bar-fill) {
  background: var(--success-fg);
}

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
