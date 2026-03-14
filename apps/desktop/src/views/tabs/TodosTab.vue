<script setup lang="ts">
import { computed } from "vue";
import { useSessionDetailStore } from "@/stores/sessionDetail";
import { StatusIcon, EmptyState, SectionPanel, ProgressBar, useSessionTabLoader } from "@tracepilot/ui";

const store = useSessionDetailStore();

useSessionTabLoader(
  () => store.sessionId,
  () => store.loadTodos()
);

const todos = computed(() => store.todos?.todos ?? []);
const deps = computed(() => store.todos?.deps ?? []);

const completedCount = computed(() => todos.value.filter(t => t.status === 'done').length);
const progressPercent = computed(() => todos.value.length > 0 ? (completedCount.value / todos.value.length) * 100 : 0);

function statusColor(status: string): string {
  switch (status) {
    case "done": return "text-[var(--color-success-fg)]";
    case "in_progress": return "text-[var(--color-accent-fg)]";
    case "blocked": return "text-[var(--color-danger-fg)]";
    default: return "text-[var(--color-text-tertiary)]";
  }
}

function statusBg(status: string): string {
  switch (status) {
    case "done": return "bg-[var(--color-success-muted)]";
    case "in_progress": return "bg-[var(--color-accent-muted)]";
    case "blocked": return "bg-[var(--color-danger-muted)]";
    default: return "bg-[var(--color-neutral-muted)]";
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
  <div class="space-y-4">
    <EmptyState v-if="todos.length === 0" message="No todos found in this session." />

    <div v-else class="space-y-5">
      <!-- Progress bar -->
      <SectionPanel title="Progress">
        <div class="flex items-center justify-end mb-3">
          <span class="text-xs text-[var(--color-text-secondary)]">
            {{ completedCount }}/{{ todos.length }} completed
          </span>
        </div>
        <ProgressBar
          :percent="progressPercent"
          color="var(--color-success-emphasis)"
          :aria-label="`${completedCount} of ${todos.length} todos completed`"
        />
      </SectionPanel>

      <!-- Todo items -->
      <div
        v-for="todo in todos"
        :key="todo.id"
        class="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-canvas-subtle)] p-5"
      >
        <div class="flex items-start gap-3">
          <StatusIcon :status="todo.status as 'done' | 'in_progress' | 'blocked' | 'pending'" class="mt-0.5" />
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-sm font-medium text-[var(--color-text-primary)]">{{ todo.title }}</span>
              <span
                class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
                :class="[statusColor(todo.status), statusBg(todo.status)]"
              >
                {{ todo.status.replace('_', ' ') }}
              </span>
            </div>
            <div v-if="todo.description" class="mt-1.5 whitespace-pre-wrap text-xs text-[var(--color-text-secondary)] leading-relaxed">
              {{ todo.description }}
            </div>
            <div class="mt-1.5 font-mono text-[11px] text-[var(--color-text-tertiary)]">{{ todo.id }}</div>
            <div v-if="getDependencies(todo.id).length > 0" class="mt-2 flex flex-wrap items-center gap-1.5">
              <span class="text-[11px] text-[var(--color-text-tertiary)]">Depends on:</span>
              <span
                v-for="depId in getDependencies(todo.id)"
                :key="depId"
                class="inline-flex items-center rounded-md bg-[var(--color-neutral-muted)] px-1.5 py-0.5 text-[11px] text-[var(--color-text-secondary)]"
              >
                {{ getTodoTitle(depId) }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
