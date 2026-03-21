<script setup lang="ts">
/**
 * ModelSwitchBanner — inline banner displayed between steps when the model changes.
 */
defineProps<{
  previousModel: string;
  newModel: string;
}>();
</script>

<template>
  <div class="model-switch-banner" role="status">
    <span class="switch-icon">🔄</span>
    <span class="switch-label">Model switched:</span>
    <span class="switch-model old">{{ previousModel }}</span>
    <span class="switch-arrow">→</span>
    <span class="switch-model new">{{ newModel }}</span>
  </div>
</template>

<style scoped>
.model-switch-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  margin: 6px 0;
  background: var(--done-subtle);
  border: 1px solid rgba(167, 139, 250, 0.15);
  border-radius: var(--radius-sm);
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--done-fg);
}
.switch-icon { font-size: 0.875rem; }
.switch-label { color: var(--text-secondary); }
.switch-model {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
}
.switch-model.old {
  background: rgba(255, 255, 255, 0.06);
  text-decoration: line-through;
  opacity: 0.7;
}
.switch-model.new {
  background: var(--accent-muted);
  color: var(--accent-fg);
}
.switch-arrow { color: var(--text-tertiary); font-size: 0.875rem; }
</style>
