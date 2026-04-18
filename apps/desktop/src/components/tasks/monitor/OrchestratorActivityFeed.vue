<script setup lang="ts">
import { SectionPanel } from "@tracepilot/ui";
import type { ActivityEntry } from "@/stores/orchestrator";

defineProps<{
  entries: ActivityEntry[];
  isRunning: boolean;
  formatActivityTime: (iso: string) => string;
}>();
</script>

<template>
  <SectionPanel title="Activity Feed" class="fade-section" style="--stagger: 6">
    <template #actions>
      <span class="subagent-count-badge">{{ entries.length }}</span>
    </template>
    <div v-if="entries.length === 0" class="empty-state">
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
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
      <span>{{ isRunning ? "Waiting for activity…" : "Start the orchestrator to see activity" }}</span>
    </div>
    <div v-else class="activity-feed">
      <div
        v-for="entry in entries"
        :key="entry.id"
        class="activity-entry"
        :class="'activity-' + entry.eventType.replace(/\./g, '-')"
      >
        <span class="activity-icon">{{ entry.icon }}</span>
        <div class="activity-content">
          <span class="activity-label">{{ entry.label }}</span>
          <span v-if="entry.detail" class="activity-detail">{{ entry.detail }}</span>
        </div>
        <span class="activity-time">{{ formatActivityTime(entry.timestamp) }}</span>
      </div>
    </div>
  </SectionPanel>
</template>
