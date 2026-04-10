<script setup lang="ts">
const props = defineProps<{ priority: string }>();

const config: Record<string, { label: string; cssClass: string }> = {
  critical: { label: "Critical", cssClass: "priority-critical" },
  high: { label: "High", cssClass: "priority-high" },
  normal: { label: "Normal", cssClass: "priority-normal" },
  low: { label: "Low", cssClass: "priority-low" },
};
</script>

<template>
  <span
    class="priority-badge"
    :class="config[props.priority]?.cssClass ?? 'priority-normal'"
  >
    {{ config[props.priority]?.label ?? props.priority }}
  </span>
</template>

<style scoped>
.priority-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  white-space: nowrap;
}

.priority-critical {
  background: var(--danger-muted);
  color: var(--danger-emphasis);
}

.priority-high {
  background: var(--warning-muted);
  color: var(--attention-fg);
}

.priority-normal {
  background: var(--neutral-subtle);
  color: var(--neutral-fg);
}

.priority-low {
  background: var(--neutral-subtle);
  color: var(--neutral-emphasis);
}
</style>
