<script setup lang="ts">
import type { SkillScope } from "@tracepilot/types";

defineProps<{
  scope: SkillScope;
}>();
</script>

<template>
  <span class="scope-badge" :class="`scope-badge--${scope}`">
    {{ scope === "global" ? "Global" : "Repository" }}
  </span>
</template>

<style scoped>
.scope-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: capitalize;
  line-height: 1.4;
}

.scope-badge--global {
  background: var(--accent-muted);
  color: var(--accent-fg);
}

.scope-badge--repository {
  background: var(--success-muted);
  color: var(--success-fg);
}
</style>
