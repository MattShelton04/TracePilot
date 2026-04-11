<script setup lang="ts">
defineProps<{
  title: string;
  subtitle?: string;
}>();
</script>

<template>
  <div class="page-header">
    <div class="page-header__row">
      <h1 class="page-title">
        <span v-if="$slots.icon" class="title-icon-tile">
          <slot name="icon" />
        </span>
        {{ title }}
      </h1>
      <p v-if="subtitle" class="page-subtitle">{{ subtitle }}</p>
      <div v-if="$slots.actions" class="title-actions">
        <slot name="actions" />
      </div>
    </div>
    <slot />
  </div>
</template>

<style scoped>
.page-header {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 4px;
}

.page-header__row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
}

.page-title {
  font-size: 1.375rem;
  font-weight: 700;
  letter-spacing: -0.025em;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  white-space: nowrap;
}

.title-icon-tile {
  width: 30px;
  height: 30px;
  border-radius: var(--radius-md);
  background: var(--accent-muted);
  border: 1px solid var(--border-accent, var(--accent-fg));
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent-fg);
  flex-shrink: 0;
}

.title-icon-tile :deep(svg) {
  width: 16px;
  height: 16px;
}

.page-subtitle {
  font-size: 0.8125rem;
  color: var(--text-tertiary);
  margin: 0;
  flex: 1;
  min-width: 180px;
}

.title-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
</style>
