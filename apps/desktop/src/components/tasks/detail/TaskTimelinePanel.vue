<script setup lang="ts">
import type { Task } from "@tracepilot/types";
import { formatDate, formatRelativeTime } from "@tracepilot/ui";
import type { TimelineEvent } from "@/composables/useTaskDetail";

interface Props {
  task: Task;
  timelineEvents: TimelineEvent[];
  duration: string | null;
}

defineProps<Props>();
</script>

<template>
  <div class="panel-content">
    <div class="timeline">
      <div
        v-for="(evt, idx) in timelineEvents"
        :key="idx"
        class="tl-item"
        :class="[`tl-${evt.state}`, `tl-v-${evt.variant}`]"
      >
        <div class="tl-rail">
          <div class="tl-dot" />
          <div v-if="idx < timelineEvents.length - 1" class="tl-line" />
        </div>
        <div class="tl-body">
          <div class="tl-label">{{ evt.label }}</div>
          <div v-if="evt.timestamp" class="tl-time">
            {{ formatDate(evt.timestamp) }}
            <span class="tl-relative">
              · {{ formatRelativeTime(evt.timestamp) }}
            </span>
          </div>
          <div
            v-else-if="evt.state === 'active'"
            class="tl-time tl-active-text"
          >
            In progress…
          </div>
          <div
            v-else-if="evt.state === 'pending'"
            class="tl-time tl-pending-text"
          >
            Waiting
          </div>
        </div>
      </div>
    </div>

    <div class="tl-summary-grid">
      <div v-if="duration" class="tl-summary-item">
        <span class="tl-summary-label">Total Duration</span>
        <span class="tl-summary-value">{{ duration }}</span>
      </div>
      <div
        v-if="task.attemptCount > 1 || task.maxRetries > 1"
        class="tl-summary-item"
      >
        <span class="tl-summary-label">Attempts</span>
        <span class="tl-summary-value">
          {{ task.attemptCount }} / {{ task.maxRetries }}
        </span>
      </div>
      <div class="tl-summary-item">
        <span class="tl-summary-label">Last Updated</span>
        <span class="tl-summary-value">
          {{ formatRelativeTime(task.updatedAt) }}
        </span>
      </div>
    </div>
  </div>
</template>
