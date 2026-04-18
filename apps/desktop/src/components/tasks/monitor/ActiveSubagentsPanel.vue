<script setup lang="ts">
import { SectionPanel } from "@tracepilot/ui";
import type { TrackedSubagent } from "@tracepilot/types";

defineProps<{
  agents: TrackedSubagent[];
  sessionUuid: string | null;
  subagentLabel: (id: string) => string;
  truncateId: (id: string, len?: number) => string;
  elapsedSince: (iso: string | null) => string;
}>();

const emit = defineEmits<{
  (e: "view-task", id: string): void;
}>();
</script>

<template>
  <SectionPanel title="Active Subagents" class="fade-section" style="--stagger: 4">
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
        <circle cx="12" cy="12" r="10" />
        <line x1="8" y1="12" x2="16" y2="12" />
      </svg>
      <span>{{ sessionUuid ? "No active subagents" : "Waiting for session discovery…" }}</span>
    </div>
    <div v-else class="subagent-grid">
      <div
        v-for="agent in agents"
        :key="agent.taskId"
        class="subagent-card"
      >
        <div class="subagent-card-top">
          <span class="subagent-name">{{ subagentLabel(agent.taskId) }}</span>
          <span class="subagent-status-badge" :class="agent.status">
            <span v-if="agent.status === 'running' || agent.status === 'spawning'" class="spinner-xs" />
            <svg v-else width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
              <path
                d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"
              />
            </svg>
            {{ agent.status }}
          </span>
        </div>
        <div class="subagent-task-id cell-mono">{{ truncateId(agent.taskId) }}</div>
        <div class="subagent-card-meta">
          <span class="subagent-elapsed">⏱ {{ elapsedSince(agent.startedAt) }}</span>
        </div>
        <div class="subagent-progress">
          <div class="subagent-progress-fill" :class="agent.status" />
        </div>
        <div class="subagent-card-footer">
          <button class="sa-link" @click="emit('view-task', agent.taskId)">View Task →</button>
        </div>
      </div>
    </div>
  </SectionPanel>
</template>
