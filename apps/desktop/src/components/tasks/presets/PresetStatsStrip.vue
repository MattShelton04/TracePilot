<script setup lang="ts">
defineProps<{
  total: number;
  builtin: number;
  custom: number;
  enabled: number;
}>();
</script>

<template>
  <div class="stats-strip">
    <span class="stat-chip">
      <span class="stat-dot stat-dot--total" />
      {{ total }} Total
    </span>
    <span class="stat-sep">&middot;</span>
    <span class="stat-chip">
      <span class="stat-dot stat-dot--builtin" />
      {{ builtin }} Builtin
    </span>
    <span class="stat-sep">&middot;</span>
    <span class="stat-chip">
      <span class="stat-dot stat-dot--custom" />
      {{ custom }} Custom
    </span>
    <span class="stat-sep">&middot;</span>
    <span class="stat-chip">
      <span class="stat-dot stat-dot--enabled" />
      {{ enabled }} Enabled
    </span>
  </div>
</template>

<style scoped>
.stats-strip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 0 2px;
  flex-wrap: wrap;
}

.stat-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-secondary);
}

.stat-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.stat-dot--total {
  background: var(--accent-fg);
}

.stat-dot--builtin {
  background: var(--done-fg);
}

.stat-dot--custom {
  background: var(--accent-fg);
}

.stat-dot--enabled {
  background: var(--success-fg);
}

.stat-sep {
  color: var(--text-tertiary);
  font-size: 0.625rem;
  user-select: none;
}
</style>
