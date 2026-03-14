<script setup lang="ts">
import { computed, watch } from "vue";
import { useSessionDetailStore } from "@/stores/sessionDetail";

const store = useSessionDetailStore();

watch(
  () => store.sessionId,
  (id) => {
    if (!id) {
      return;
    }

    void store.loadTodos();
  },
  { immediate: true }
);

const todos = computed(() => store.todos?.todos ?? []);
const deps = computed(() => store.todos?.deps ?? []);

function statusIcon(status: string): string {
  switch (status) {
    case "done":
      return "✅";
    case "in_progress":
      return "🔄";
    case "blocked":
      return "🚫";
    default:
      return "⏳";
  }
}

function statusColor(status: string): string {
  switch (status) {
    case "done":
      return "text-[var(--success)]";
    case "in_progress":
      return "text-[var(--accent)]";
    case "blocked":
      return "text-[var(--error)]";
    default:
      return "text-[var(--text-muted)]";
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
    <div v-if="todos.length === 0" class="py-8 text-center text-sm text-[var(--text-muted)]">
      No todos found in this session.
    </div>

    <div v-else class="space-y-2">
      <div class="text-xs text-[var(--text-muted)]">
        {{ todos.filter((todo) => todo.status === "done").length }}/{{ todos.length }} completed
      </div>

      <div class="h-2 overflow-hidden rounded-full bg-[var(--border)]">
        <div
          class="h-full bg-[var(--success)] transition-all duration-300"
          :style="{ width: `${todos.length > 0 ? (todos.filter((todo) => todo.status === 'done').length / todos.length) * 100 : 0}%` }"
        />
      </div>

      <div
        v-for="todo in todos"
        :key="todo.id"
        class="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
      >
        <div class="flex items-start gap-3">
          <span class="flex-shrink-0 text-lg">{{ statusIcon(todo.status) }}</span>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium">{{ todo.title }}</span>
              <span
                class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                :class="statusColor(todo.status)"
              >
                {{ todo.status }}
              </span>
            </div>
            <div v-if="todo.description" class="mt-1 whitespace-pre-wrap text-xs text-[var(--text-muted)]">
              {{ todo.description }}
            </div>
            <div class="mt-1 font-mono text-xs text-[var(--text-muted)]">ID: {{ todo.id }}</div>
            <div v-if="getDependencies(todo.id).length > 0" class="mt-2 flex flex-wrap gap-1">
              <span class="text-xs text-[var(--text-muted)]">Depends on:</span>
              <span
                v-for="depId in getDependencies(todo.id)"
                :key="depId"
                class="inline-flex items-center rounded-full bg-[var(--border)] px-2 py-0.5 text-xs text-[var(--text-muted)]"
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
