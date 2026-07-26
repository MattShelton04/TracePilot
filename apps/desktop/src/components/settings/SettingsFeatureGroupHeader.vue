<script setup lang="ts">
import { Tooltip } from "@tracepilot/ui";
import { CircleHelp } from "lucide-vue-next";

defineProps<{
  label: string;
  tooltip: string;
  tone: "recommended" | "experimental";
}>();
</script>

<template>
  <div class="feature-group-heading">
    <span class="feature-group-title" :class="`feature-group-title--${tone}`">
      {{ label }}
    </span>
    <Tooltip :text="tooltip" position="right">
      <span
        class="feature-group-help"
        :class="`feature-group-help--${tone}`"
        tabindex="0"
        :aria-label="`About ${label.toLowerCase()} features`"
      >
        <CircleHelp :size="14" :stroke-width="1.75" aria-hidden="true" />
      </span>
    </Tooltip>
  </div>
</template>

<style scoped>
.feature-group-heading {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0 4px 8px;
  min-height: 20px;
}

.feature-group-title {
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.feature-group-title--recommended {
  color: var(--success-fg);
}

.feature-group-title--experimental {
  color: var(--warning-fg);
}

.feature-group-help {
  display: inline-flex;
  align-items: center;
  color: var(--text-tertiary);
  cursor: help;
  border-radius: var(--radius-sm);
}

.feature-group-help:hover,
.feature-group-help:focus-visible {
  outline: none;
}

.feature-group-help--recommended:hover,
.feature-group-help--recommended:focus-visible {
  color: var(--success-fg);
}

.feature-group-help--experimental:hover,
.feature-group-help--experimental:focus-visible {
  color: var(--warning-fg);
}

.feature-group-help--recommended:focus-visible {
  box-shadow: 0 0 0 2px var(--success-muted);
}

.feature-group-help--experimental:focus-visible {
  box-shadow: 0 0 0 2px var(--warning-muted);
}
</style>
