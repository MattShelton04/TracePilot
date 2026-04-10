<script setup lang="ts">
import { formatTaskType } from "@/stores/tasks";

const props = defineProps<{ taskType: string }>();
</script>

<template>
  <span class="task-type-badge">
    {{ formatTaskType(props.taskType) }}
  </span>
</template>

<style scoped>
.task-type-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
  background: var(--accent-subtle);
  color: var(--accent-fg);
  white-space: nowrap;
}
</style>
