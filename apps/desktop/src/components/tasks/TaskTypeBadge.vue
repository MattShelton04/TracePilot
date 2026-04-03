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
  background: rgba(129, 140, 248, 0.1);
  color: #818cf8;
  white-space: nowrap;
}
</style>
