<script setup lang="ts">
defineProps<{
  message?: string;
  icon?: string;
  title?: string;
  compact?: boolean;
}>();
</script>

<template>
  <div :class="['empty-state', { 'empty-state--compact': compact }]">
    <div v-if="icon && !compact" class="empty-state-icon">{{ icon }}</div>
    <h2 v-if="title && !compact" class="empty-state-title">{{ title }}</h2>
    <p class="empty-state-desc">
      <slot>{{ message ?? "No data found." }}</slot>
    </p>
    <div v-if="$slots.actions" class="empty-state-actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
.empty-state {
  text-align: center;
  padding: 40px 24px;
  color: var(--text-placeholder);
}

.empty-state--compact {
  padding: 20px;
}

.empty-state-icon {
  font-size: 36px;
  margin-bottom: 12px;
  opacity: 0.3;
}

.empty-state-title {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--text-tertiary);
  margin: 0 0 6px;
}

.empty-state-desc {
  font-size: 0.8125rem;
  color: var(--text-placeholder);
  margin: 0;
}

.empty-state--compact .empty-state-desc {
  color: var(--text-tertiary);
}

.empty-state-actions {
  margin-top: 16px;
}
</style>
