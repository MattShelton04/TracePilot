<script setup lang="ts">
import type { TaskStatus } from "@tracepilot/types";

const props = defineProps<{ status: TaskStatus }>();

const config: Record<TaskStatus, { label: string; cssClass: string }> = {
  pending: { label: "Pending", cssClass: "status-pending" },
  claimed: { label: "Claimed", cssClass: "status-claimed" },
  in_progress: { label: "In Progress", cssClass: "status-in-progress" },
  done: { label: "Done", cssClass: "status-done" },
  failed: { label: "Failed", cssClass: "status-failed" },
  cancelled: { label: "Cancelled", cssClass: "status-cancelled" },
  expired: { label: "Expired", cssClass: "status-expired" },
  dead_letter: { label: "Dead Letter", cssClass: "status-dead-letter" },
};
</script>

<template>
  <span class="task-status-badge" :class="config[props.status]?.cssClass ?? 'status-pending'">
    <span class="status-dot" />
    {{ config[props.status]?.label ?? props.status }}
  </span>
</template>

<style scoped>
.task-status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  line-height: 1.6;
  white-space: nowrap;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-pending {
  background: var(--neutral-subtle);
  color: var(--neutral-fg);
}
.status-pending .status-dot {
  background: var(--neutral-fg);
}

.status-claimed {
  background: var(--accent-subtle);
  color: var(--accent-fg);
}
.status-claimed .status-dot {
  background: var(--accent-fg);
}

.status-in-progress {
  background: var(--accent-subtle);
  color: var(--accent-fg);
}
.status-in-progress .status-dot {
  background: var(--accent-fg);
  animation: pulse-dot 1.5s ease-in-out infinite;
}

.status-done {
  background: var(--success-subtle);
  color: var(--success-fg);
}
.status-done .status-dot {
  background: var(--success-fg);
}

.status-failed {
  background: var(--danger-subtle);
  color: var(--danger-fg);
}
.status-failed .status-dot {
  background: var(--danger-fg);
}

.status-cancelled {
  background: var(--warning-subtle);
  color: var(--warning-fg);
}
.status-cancelled .status-dot {
  background: var(--warning-fg);
}

.status-expired {
  background: var(--done-subtle);
  color: var(--done-fg);
}
.status-expired .status-dot {
  background: var(--done-fg);
}

.status-dead-letter {
  background: var(--danger-subtle);
  color: var(--danger-emphasis);
}
.status-dead-letter .status-dot {
  background: var(--danger-emphasis);
}

@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
</style>
