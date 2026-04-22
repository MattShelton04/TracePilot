<script setup lang="ts">
import type { TrackedSubagent } from "@tracepilot/types";
import { SectionPanel } from "@tracepilot/ui";

defineProps<{
  agents: TrackedSubagent[];
  subagentLabel: (id: string) => string;
  truncateId: (id: string, len?: number) => string;
  truncateError: (err: string | null, len?: number) => string;
  durationBetween: (start: string | null, end: string | null) => string;
}>();

const emit = defineEmits<(e: "view-task", id: string) => void>();
</script>

<template>
  <SectionPanel title="Completed Subagents" class="fade-section" style="--stagger: 5">
    <template #actions>
      <span class="subagent-count-badge">{{ agents.length }}</span>
    </template>
    <div v-if="agents.length === 0" class="empty-state">
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
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
      <span>No completed subagents yet</span>
    </div>
    <div v-else class="subagent-grid">
      <div
        v-for="agent in agents"
        :key="agent.taskId"
        class="subagent-card"
        :class="{ 'card-failed': agent.status === 'failed' }"
      >
        <div class="subagent-card-top">
          <span class="subagent-name">{{ subagentLabel(agent.taskId) }}</span>
          <span class="subagent-status-badge" :class="agent.status">
            <svg v-if="agent.status === 'completed'" width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
              <path
                d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"
              />
            </svg>
            <svg v-else-if="agent.status === 'failed'" width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
              <path
                d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"
              />
            </svg>
            {{ agent.status }}
          </span>
        </div>
        <div class="subagent-task-id cell-mono">{{ truncateId(agent.taskId) }}</div>
        <div class="subagent-card-meta">
          <span class="subagent-elapsed">{{ durationBetween(agent.startedAt, agent.completedAt) }}</span>
        </div>
        <div v-if="agent.error" class="completed-error" :title="agent.error">
          {{ truncateError(agent.error, 40) }}
        </div>
        <div class="subagent-card-footer">
          <button class="sa-link" @click="emit('view-task', agent.taskId)">View Task →</button>
        </div>
      </div>
    </div>
  </SectionPanel>
</template>
