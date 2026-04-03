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
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

.priority-high {
  background: rgba(251, 146, 60, 0.15);
  color: #fb923c;
}

.priority-normal {
  background: rgba(161, 161, 170, 0.1);
  color: #a1a1aa;
}

.priority-low {
  background: rgba(113, 113, 122, 0.1);
  color: #71717a;
}
</style>
