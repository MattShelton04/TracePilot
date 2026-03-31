<script setup lang="ts">
import type { McpHealthStatus } from "@tracepilot/types";

const props = withDefaults(
  defineProps<{
    status?: McpHealthStatus;
    size?: number;
  }>(),
  {
    status: "unknown",
    size: 8,
  },
);

const statusLabels: Record<McpHealthStatus, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  unreachable: "Unreachable",
  unknown: "Unknown",
  disabled: "Disabled",
};
</script>

<template>
  <span
    class="mcp-status-dot"
    :class="`status-${status}`"
    :style="{ width: `${size}px`, height: `${size}px` }"
    :title="statusLabels[status]"
    role="status"
    :aria-label="statusLabels[status]"
  />
</template>

<style scoped>
.mcp-status-dot {
  display: inline-block;
  border-radius: var(--radius-full);
  flex-shrink: 0;
}

.status-healthy {
  background-color: var(--success-emphasis);
  box-shadow: 0 0 6px var(--success-muted);
}

.status-degraded {
  background-color: var(--warning-emphasis);
  box-shadow: 0 0 6px var(--warning-muted);
}

.status-unreachable {
  background-color: var(--danger-emphasis);
  box-shadow: 0 0 6px var(--danger-muted);
}

.status-unknown {
  background-color: var(--neutral-emphasis);
}

.status-disabled {
  background-color: var(--neutral-emphasis);
  opacity: 0.5;
}
</style>
