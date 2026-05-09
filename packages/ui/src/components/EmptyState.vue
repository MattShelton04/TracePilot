<!--
  @slots
    icon    — Lucide icon component (32px). Inherits --text-tertiary.
    default — description text (alternative to `message` / `description` props)
    actions — custom action row (alternative to primaryAction/secondaryAction props)
  Empty / "no results" / first-run pattern. The only legal place to render
  text.display (28/34 600). See 02-primitives.md §EmptyState.
-->
<script setup lang="ts">
export interface EmptyStateAction {
  label: string;
  onClick: () => void;
}

export interface EmptyStateProps {
  /** Title (rendered in text.display for size='lg', text.h2 for 'sm', text.h1 default). */
  title?: string;
  /** Body description. Either this prop or default slot. */
  description?: string;
  /** Legacy alias for `description`. Preserved for backward compat. */
  message?: string;
  /** Legacy text icon (emoji/string). Prefer the `icon` slot with a Lucide component. */
  icon?: string;
  /** sm = inline (text.h2 title); md = default (text.h1 title); lg = full empty page (text.display). */
  size?: "sm" | "md" | "lg";
  /** Legacy compact flag; equivalent to size='sm' and hides icon/title. */
  compact?: boolean;
  primaryAction?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
}

withDefaults(defineProps<EmptyStateProps>(), {
  size: "md",
});
</script>

<template>
  <div
    data-tp-component="EmptyState"
    :class="[
      'empty-state',
      `empty-state--${size}`,
      { 'empty-state--compact': compact },
    ]"
  >
    <div v-if="!compact && ($slots.icon || icon)" class="empty-state-icon">
      <slot name="icon">{{ icon }}</slot>
    </div>
    <h2 v-if="title && !compact" class="empty-state-title">{{ title }}</h2>
    <p class="empty-state-desc">
      <slot>{{ description ?? message ?? "No data found." }}</slot>
    </p>
    <div
      v-if="$slots.actions || primaryAction || secondaryAction"
      class="empty-state-actions"
    >
      <slot name="actions">
        <button
          v-if="primaryAction"
          type="button"
          class="empty-state-btn empty-state-btn--primary"
          @click="primaryAction.onClick"
        >
          {{ primaryAction.label }}
        </button>
        <button
          v-if="secondaryAction"
          type="button"
          class="empty-state-btn empty-state-btn--secondary"
          @click="secondaryAction.onClick"
        >
          {{ secondaryAction.label }}
        </button>
      </slot>
    </div>
  </div>
</template>

<style scoped>
.empty-state {
  display: grid;
  place-items: center;
  text-align: center;
  gap: 8px;
  padding: 40px 24px;
  color: var(--text-secondary);
}

.empty-state--sm { padding: 24px 16px; }
.empty-state--lg { padding: 64px 24px; }

.empty-state--compact { padding: 20px; }

.empty-state-icon {
  color: var(--text-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 4px;
}
.empty-state-icon :deep(svg) {
  width: 32px;
  height: 32px;
}
.empty-state--lg .empty-state-icon :deep(svg) {
  width: 40px;
  height: 40px;
}

.empty-state-title {
  font-size: 20px;
  line-height: 28px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.empty-state--sm .empty-state-title {
  font-size: 16px;
  line-height: 22px;
}

.empty-state--lg .empty-state-title {
  font-size: 28px;
  line-height: 34px;
}

.empty-state-desc {
  font-size: 13px;
  line-height: 18px;
  color: var(--text-secondary);
  margin: 0;
  max-width: 48ch;
}

.empty-state--compact .empty-state-desc {
  color: var(--text-tertiary);
}

.empty-state-actions {
  margin-top: 12px;
  display: flex;
  gap: 8px;
  justify-content: center;
  flex-wrap: wrap;
}

.empty-state-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  cursor: pointer;
  transition:
    background-color 120ms cubic-bezier(0.2, 0.6, 0.2, 1),
    border-color 120ms cubic-bezier(0.2, 0.6, 0.2, 1),
    color 120ms cubic-bezier(0.2, 0.6, 0.2, 1);
}

.empty-state-btn--primary {
  background: var(--accent-emphasis);
  color: var(--text-on-emphasis);
}
.empty-state-btn--primary:hover {
  background: var(--accent-emphasis-hover);
}

.empty-state-btn--secondary {
  background: transparent;
  color: var(--text-secondary);
  border-color: var(--border-default);
}
.empty-state-btn--secondary:hover {
  color: var(--text-primary);
  background: var(--surface-tertiary);
  border-color: var(--border-emphasis);
}

.empty-state-btn:focus-visible {
  outline: 2px solid var(--accent-emphasis);
  outline-offset: 2px;
}
</style>
