<script setup lang="ts">
import { formatDate } from "@tracepilot/ui";
import PriorityBadge from "@/components/tasks/PriorityBadge.vue";
import TaskStatusBadge from "@/components/tasks/TaskStatusBadge.vue";
import TaskTypeBadge from "@/components/tasks/TaskTypeBadge.vue";
import { taskTitle } from "@/stores/tasks";
import type { Task } from "@tracepilot/types";

interface Props {
  task: Task;
  truncatedId: string;
  duration: string | null;
  canCancel: boolean;
  canRetry: boolean;
  cancelling: boolean;
  retrying: boolean;
  copiedSection: string | null;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: "cancel"): void;
  (e: "retry"): void;
  (e: "delete"): void;
  (e: "copy", text: string, section: string): void;
}>();

function copyId() {
  emit("copy", props.task.id, "id");
}
</script>

<template>
  <div class="detail-header">
    <div class="detail-header-left">
      <h1 class="detail-title">{{ taskTitle(task) }}</h1>
      <div class="detail-badges">
        <TaskStatusBadge :status="task.status" />
        <TaskTypeBadge :task-type="task.taskType" />
        <PriorityBadge :priority="task.priority" />
      </div>
      <div class="detail-meta">
        <button
          class="meta-chip meta-chip-id"
          :title="`Copy ID: ${task.id}`"
          @click="copyId"
        >
          {{ copiedSection === "id" ? "Copied ✓" : `ID: ${truncatedId}` }}
        </button>
        <span class="meta-chip">
          {{ formatDate(task.createdAt) }}
        </span>
        <span v-if="duration" class="meta-chip meta-chip-accent">
          ⏱ {{ duration }}
        </span>
      </div>
    </div>
    <div class="detail-actions">
      <button
        v-if="canCancel"
        class="btn btn-warning"
        :disabled="cancelling"
        @click="emit('cancel')"
      >
        {{ cancelling ? "Cancelling…" : "Cancel" }}
      </button>
      <button
        v-if="canRetry"
        class="btn btn-accent"
        :disabled="retrying"
        @click="emit('retry')"
      >
        {{ retrying ? "Retrying…" : "Retry" }}
      </button>
      <button class="btn btn-danger" @click="emit('delete')">Delete</button>
    </div>
  </div>
</template>
