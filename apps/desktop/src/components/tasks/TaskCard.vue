<script setup lang="ts">
import type { Task } from "@tracepilot/types";
import { formatDate } from "@tracepilot/ui";
import { taskTitle } from "@/stores/tasks";
import PriorityBadge from "./PriorityBadge.vue";
import TaskStatusBadge from "./TaskStatusBadge.vue";
import TaskTypeBadge from "./TaskTypeBadge.vue";

const props = defineProps<{ task: Task }>();

defineEmits<{
  click: [];
}>();
</script>

<template>
  <button class="task-card" @click="$emit('click')">
    <div class="task-card-header">
      <TaskStatusBadge :status="props.task.status" />
      <PriorityBadge v-if="props.task.priority !== 'normal'" :priority="props.task.priority" />
    </div>

    <div class="task-card-body">
      <h3 class="task-card-title">{{ taskTitle(props.task) }}</h3>
      <p v-if="props.task.resultSummary" class="task-card-summary">
        {{ props.task.resultSummary }}
      </p>
      <p v-else-if="props.task.errorMessage" class="task-card-error">
        {{ props.task.errorMessage }}
      </p>
    </div>

    <div class="task-card-footer">
      <TaskTypeBadge :task-type="props.task.taskType" />
      <span class="task-card-meta">
        {{ formatDate(props.task.createdAt) }}
      </span>
      <span v-if="props.task.attemptCount > 1" class="task-card-attempts">
        Attempt {{ props.task.attemptCount }}/{{ props.task.maxRetries }}
      </span>
    </div>
  </button>
</template>

<style scoped>
.task-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  background: var(--canvas-subtle);
  border: 1px solid var(--border-muted);
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.15s ease;
  text-align: left;
  width: 100%;
  color: inherit;
  font: inherit;
}

.task-card:hover {
  background: var(--canvas-overlay);
  border-color: var(--border-default);
  transform: translateY(-1px);
}

.task-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.task-card-body {
  min-height: 0;
}

.task-card-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.4;
}

.task-card-summary {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.task-card-error {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--danger-fg);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.task-card-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.task-card-meta {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-left: auto;
}

.task-card-attempts {
  font-size: 11px;
  color: var(--warning-fg);
  font-weight: 500;
}
</style>
