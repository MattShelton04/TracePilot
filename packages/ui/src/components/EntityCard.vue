<!--
  @slots
    icon    — Lucide icon component (16/20px). Inherits tone color.
    status  — status pill / right-side header element
    default — body content (optional)
    actions — actions row (buttons). Click events stop propagation from card click.
  Single canonical card archetype. See 02-primitives.md §EntityCard.
-->
<script setup lang="ts">
import { computed } from "vue";

export type EntityCardTone = "accent" | "success" | "warning" | "danger" | "neutral" | "done";

export interface EntityCardMeta {
  label: string;
  mono?: boolean;
}

export interface EntityCardProps {
  title: string;
  /** Tone for the icon container. */
  iconTone?: EntityCardTone;
  /** Pipe-separated metadata row. */
  meta?: EntityCardMeta[];
  /** Whole-card click target. */
  to?: string;
  /** aria-selected state. */
  selected?: boolean;
  /** comfortable (default) or compact. */
  density?: "comfortable" | "compact";
}

const props = withDefaults(defineProps<EntityCardProps>(), {
  iconTone: "neutral",
  density: "comfortable",
  selected: false,
});

const emit = defineEmits<{
  activate: [event: MouseEvent | KeyboardEvent];
}>();

const isInteractive = computed(() => Boolean(props.to));

function handleClick(e: MouseEvent) {
  // Don't activate when clicking inside the actions slot.
  const target = e.target as HTMLElement | null;
  if (target?.closest?.("[data-tp-card-actions]")) return;
  emit("activate", e);
}

function handleKeydown(e: KeyboardEvent) {
  if (!isInteractive.value) return;
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    emit("activate", e);
  }
}
</script>

<template>
  <div
    data-tp-component="EntityCard"
    class="ec"
    :class="[
      `ec--${density}`,
      `ec--tone-${iconTone}`,
      { 'ec--interactive': isInteractive, 'ec--selected': selected },
    ]"
    :tabindex="isInteractive ? 0 : undefined"
    :role="isInteractive ? 'button' : undefined"
    :aria-selected="selected || undefined"
    @click="isInteractive && handleClick($event)"
    @keydown="handleKeydown"
  >
    <div class="ec__head">
      <span v-if="$slots.icon" class="ec__icon" aria-hidden="true">
        <slot name="icon" />
      </span>
      <h3 class="ec__title" :title="title">{{ title }}</h3>
      <span v-if="$slots.status" class="ec__status">
        <slot name="status" />
      </span>
    </div>

    <div v-if="meta && meta.length" class="ec__meta">
      <template v-for="(m, i) in meta" :key="i">
        <span v-if="i > 0" class="ec__meta-sep" aria-hidden="true">·</span>
        <span :class="['ec__meta-item', { 'ec__meta-item--mono': m.mono }]">{{ m.label }}</span>
      </template>
    </div>

    <div v-if="$slots.default" class="ec__body">
      <slot />
    </div>

    <div
      v-if="$slots.actions"
      class="ec__actions"
      data-tp-card-actions
      @click.stop
    >
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
.ec {
  background: var(--canvas-raised);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: 16px;
  display: grid;
  gap: 8px;
  transition:
    background-color 120ms cubic-bezier(0.2, 0.6, 0.2, 1),
    border-color 120ms cubic-bezier(0.2, 0.6, 0.2, 1),
    color 120ms cubic-bezier(0.2, 0.6, 0.2, 1);
}

.ec--compact { padding: 12px; }
.ec--interactive { cursor: pointer; }

.ec--interactive:hover {
  background: var(--surface-tertiary);
  border-color: var(--border-emphasis);
}

.ec--selected {
  border-color: var(--border-accent);
  background: var(--accent-subtle);
}

.ec__head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.ec__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
  flex-shrink: 0;
}
.ec__icon :deep(svg) { width: 16px; height: 16px; }

.ec--tone-accent  .ec__icon { background: var(--accent-subtle);  color: var(--accent-fg); }
.ec--tone-success .ec__icon { background: var(--success-subtle); color: var(--success-fg); }
.ec--tone-warning .ec__icon { background: var(--warning-subtle); color: var(--warning-fg); }
.ec--tone-danger  .ec__icon { background: var(--danger-subtle);  color: var(--danger-fg); }
.ec--tone-done    .ec__icon { background: var(--done-subtle);    color: var(--done-fg); }
.ec--tone-neutral .ec__icon { background: var(--neutral-subtle); color: var(--text-secondary); }

.ec__title {
  font-size: 14px;
  line-height: 20px;
  font-weight: 600;
  color: var(--text-primary);
  flex: 1;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ec__status { flex-shrink: 0; }

.ec__meta {
  font-size: 12px;
  line-height: 16px;
  color: var(--text-secondary);
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  align-items: baseline;
}
.ec__meta-sep { color: var(--text-tertiary); }
.ec__meta-item--mono {
  font-family: var(--font-mono);
  font-feature-settings: "tnum" 1;
}

.ec__body {
  font-size: 13px;
  line-height: 18px;
  color: var(--text-secondary);
}

.ec__actions {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 4px;
}

.ec--interactive:focus-visible {
  outline: 2px solid var(--accent-emphasis);
  outline-offset: 2px;
}
</style>
