<script setup lang="ts">
import { computed } from "vue";
import { useSessionDetailStore } from "@/stores/sessionDetail";
import { StatCard, Badge, StatusIcon, EmptyState, SectionPanel, ProgressBar, useSessionTabLoader } from "@tracepilot/ui";

const store = useSessionDetailStore();

useSessionTabLoader(
  () => store.sessionId,
  () => store.loadTodos()
);

const todos = computed(() => store.todos?.todos ?? []);
const deps = computed(() => store.todos?.deps ?? []);

const completedCount = computed(() => todos.value.filter(t => t.status === 'done').length);
const inProgressCount = computed(() => todos.value.filter(t => t.status === 'in_progress').length);
const pendingCount = computed(() => todos.value.filter(t => t.status !== 'done' && t.status !== 'in_progress').length);
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
      <SectionPanel title="Progress" class="mb-6">
        <div class="flex items-center justify-end mb-3">
          <span class="text-xs text-[var(--text-secondary)]">
            {{ completedCount }}/{{ todos.length }} completed
          </span>
        </div>
        <ProgressBar
          :percent="progressPercent"
          color="success"
          :aria-label="`${completedCount} of ${todos.length} todos completed`"
        />
      </SectionPanel>

      <!-- Status summary stat cards -->
      <div class="grid-3 mb-6">
        <StatCard :value="completedCount" label="Done" color="success" />
        <StatCard :value="inProgressCount" label="In Progress" color="accent" />
        <StatCard :value="pendingCount" label="Pending" color="done" />
      </div>

      <!-- Todo list -->
      <div class="space-y-3">
        <div
          v-for="todo in todos"
          :key="todo.id"
          class="rounded-lg border border-[var(--border-default)] bg-[var(--canvas-subtle)] p-5"
        >
          <div class="flex items-start gap-3">
            <StatusIcon :status="todo.status as 'done' | 'in_progress' | 'blocked' | 'pending'" class="mt-0.5" />
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-sm font-medium text-[var(--text-primary)]">{{ todo.title }}</span>
                <Badge :variant="statusBadgeVariant(todo.status)">
                  {{ todo.status.replace('_', ' ') }}
                </Badge>
              </div>
              <div v-if="todo.description" class="mt-1.5 whitespace-pre-wrap text-xs text-[var(--text-secondary)] leading-relaxed">
                {{ todo.description }}
              </div>
              <div class="mt-1.5 font-mono text-[11px] text-[var(--text-tertiary)]">{{ todo.id }}</div>
              <div v-if="getDependencies(todo.id).length > 0" class="mt-2 flex flex-wrap items-center gap-1.5">
                <span class="text-[11px] text-[var(--text-tertiary)]">Depends on:</span>
                <Badge
                  v-for="depId in getDependencies(todo.id)"
                  :key="depId"
                  variant="neutral"
                >
                  {{ getTodoTitle(depId) }}
                </Badge>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
