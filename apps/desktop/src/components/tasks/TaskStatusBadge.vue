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
  background: rgba(161, 161, 170, 0.12);
  color: #a1a1aa;
}
.status-pending .status-dot {
  background: #a1a1aa;
}

.status-claimed {
  background: rgba(96, 165, 250, 0.12);
  color: #60a5fa;
}
.status-claimed .status-dot {
  background: #60a5fa;
}

.status-in-progress {
  background: rgba(99, 102, 241, 0.12);
  color: #818cf8;
}
.status-in-progress .status-dot {
  background: #818cf8;
  animation: pulse-dot 1.5s ease-in-out infinite;
}

.status-done {
  background: rgba(52, 211, 153, 0.12);
  color: #34d399;
}
.status-done .status-dot {
  background: #34d399;
}

.status-failed {
  background: rgba(248, 113, 113, 0.12);
  color: #f87171;
}
.status-failed .status-dot {
  background: #f87171;
}

.status-cancelled {
  background: rgba(251, 191, 36, 0.12);
  color: #fbbf24;
}
.status-cancelled .status-dot {
  background: #fbbf24;
}

.status-expired {
  background: rgba(167, 139, 250, 0.12);
  color: #a78bfa;
}
.status-expired .status-dot {
  background: #a78bfa;
}

.status-dead-letter {
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
}
.status-dead-letter .status-dot {
  background: #ef4444;
}

@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
</style>
