<script setup lang="ts">
defineProps<{
  title: string;
  subtitle?: string;
  /**
   * When true, renders the subtitle on the same line as the title
   * (separated by a bullet) instead of on a new line.
   */
  inlineSubtitle?: boolean;
  /**
   * Title size. `md` (default) matches the original 1.375rem/700 look,
   * `sm` is 1.25rem/600 (used by secondary launch surfaces), `lg` scales
   * the title up for landing/hero-style headers.
   */
  size?: "sm" | "md" | "lg";
}>();
</script>

<template>
  <div class="page-header" :class="[`page-header--${size ?? 'md'}`]">
    <div class="page-header__row">
      <h1 class="page-title">
        <span v-if="$slots.icon" class="title-icon-tile">
          <slot name="icon" />
        </span>
        {{ title }}
        <span v-if="inlineSubtitle && subtitle" class="page-subtitle-inline">
          <span class="page-subtitle-sep" aria-hidden="true">•</span>
          {{ subtitle }}
        </span>
      </h1>
      <div v-if="$slots.actions" class="title-actions">
        <slot name="actions" />
      </div>
    </div>
    <p v-if="subtitle && !inlineSubtitle" class="page-subtitle">{{ subtitle }}</p>
    <slot />
  </div>
</template>

<style scoped>
.page-header {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 24px;
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

.page-header--sm .page-title {
  font-size: 1.25rem;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.page-header--lg .page-title {
  font-size: 1.75rem;
  font-weight: 700;
  letter-spacing: -0.03em;
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
}

.page-subtitle-inline {
  font-size: 0.8125rem;
  font-weight: 400;
  color: var(--text-tertiary);
  letter-spacing: normal;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.page-subtitle-sep {
  color: var(--text-tertiary);
  opacity: 0.6;
}

.title-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
</style>
