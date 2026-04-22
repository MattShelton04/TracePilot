<script setup lang="ts">
import type { Task } from "@tracepilot/types";
import { SectionPanel } from "@tracepilot/ui";
import TaskStatusBadge from "@/components/tasks/TaskStatusBadge.vue";
import TaskTypeBadge from "@/components/tasks/TaskTypeBadge.vue";

defineProps<{
  activeTaskIds: string[];
  activeTaskCount: number;
  hasHealth: boolean;
  isRunning: boolean;
  subagentLabel: (id: string) => string;
  resolveTask: (id: string) => Task | null;
  subagentStartTime: (id: string) => string | null;
  truncateId: (id: string, len?: number) => string;
  elapsedSince: (iso: string | null) => string;
}>();

const emit = defineEmits<(e: "view-task", id: string) => void>();
</script>

<template>
  <SectionPanel title="Active Tasks" class="fade-section" style="--stagger: 3">
    <template #actions>
      <span class="subagent-count-badge">{{ activeTaskCount }}</span>
    </template>
    <div v-if="!hasHealth && isRunning" class="empty-state">
      <span class="spinner" />
      <span>Waiting for heartbeat…</span>
    </div>
    <div v-else-if="activeTaskCount === 0" class="empty-state">
      <svg
        class="empty-icon"
        width="32"
        height="32"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="8" y1="12" x2="16" y2="12" />
      </svg>
      <span>No active tasks</span>
    </div>
    <div v-else class="active-task-grid">
      <button
        v-for="tid in activeTaskIds"
        :key="tid"
        class="active-task-card"
        @click="emit('view-task', tid)"
      >
        <div class="active-task-top">
          <TaskStatusBadge status="in_progress" />
          <span class="active-task-name">{{ subagentLabel(tid) }}</span>
        </div>
        <div v-if="resolveTask(tid)" class="active-task-meta">
          <TaskTypeBadge :task-type="resolveTask(tid)!.taskType" />
          <span class="active-task-id cell-mono">{{ truncateId(tid, 8) }}</span>
        </div>
        <div v-else class="active-task-meta">
          <span class="active-task-id cell-mono">{{ truncateId(tid, 20) }}</span>
        </div>
        <div v-if="resolveTask(tid)?.taskType" class="active-task-desc">
          {{ resolveTask(tid)!.presetId }}
        </div>
        <div class="active-task-bottom">
          <span v-if="subagentStartTime(tid)" class="active-task-elapsed">
            ⏱ {{ elapsedSince(subagentStartTime(tid)) }}
          </span>
          <span class="sa-link">View Task →</span>
        </div>
        <div class="subagent-progress">
          <div class="subagent-progress-fill running" />
        </div>
      </button>
    </div>
  </SectionPanel>
</template>
