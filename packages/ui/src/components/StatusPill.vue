<!--
  @slots
    icon — optional Lucide icon, sized 12–14px. Inherits currentColor.
  Compact, semantically toned status pill. Always pairs color with text.
  See design-system/pages/02-primitives.md §StatusPill.
-->
<script setup lang="ts">
export type StatusPillTone =
  | "accent"
  | "success"
  | "warning"
  | "danger"
  | "done"
  | "neutral"
  | "attention";

export interface StatusPillProps {
  tone: StatusPillTone;
  label: string;
  /** xs = 18px height, sm = 22px (default). */
  size?: "xs" | "sm";
  /** subtle = bg subtle + fg color (default); solid = bg emphasis + on-emphasis text. */
  variant?: "subtle" | "solid";
}

withDefaults(defineProps<StatusPillProps>(), {
  size: "sm",
  variant: "subtle",
});
</script>

<template>
  <span
    data-tp-component="StatusPill"
    class="pill"
    :class="[
      `pill--${tone}`,
      `pill--${size}`,
      `pill--${variant}`,
    ]"
    role="status"
    :aria-label="label"
  >
    <span v-if="$slots.icon" class="pill__icon" aria-hidden="true">
      <slot name="icon" />
    </span>
    <span class="pill__label">{{ label }}</span>
  </span>
</template>

<style scoped>
.pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  height: 22px;
  border-radius: var(--radius-full);
  font-size: 11px;
  line-height: 14px;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  white-space: nowrap;
}

.pill--xs {
  height: 18px;
  padding: 0 6px;
  font-size: 10px;
}

.pill__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.pill__icon :deep(svg) { width: 12px; height: 12px; }
.pill--sm .pill__icon :deep(svg) { width: 14px; height: 14px; }

/* ── Subtle (default) ───────────────────────────────────── */
.pill--subtle.pill--accent     { background: var(--accent-subtle);     color: var(--accent-fg); }
.pill--subtle.pill--success    { background: var(--success-subtle);    color: var(--success-fg); }
.pill--subtle.pill--warning    { background: var(--warning-subtle);    color: var(--warning-fg); }
.pill--subtle.pill--danger     { background: var(--danger-subtle);     color: var(--danger-fg); }
.pill--subtle.pill--done       { background: var(--done-subtle);       color: var(--done-fg); }
.pill--subtle.pill--neutral    { background: var(--neutral-subtle);    color: var(--text-secondary); }
.pill--subtle.pill--attention  { background: var(--attention-subtle);  color: var(--attention-fg); }

/* ── Solid ──────────────────────────────────────────────── */
.pill--solid                    { color: var(--text-on-emphasis); }
.pill--solid.pill--accent       { background: var(--accent-emphasis); }
.pill--solid.pill--success      { background: var(--success-emphasis); }
.pill--solid.pill--warning      { background: var(--warning-emphasis); }
.pill--solid.pill--danger       { background: var(--danger-emphasis); }
.pill--solid.pill--done         { background: var(--done-emphasis); }
.pill--solid.pill--neutral      { background: var(--neutral-emphasis); }
.pill--solid.pill--attention    { background: var(--attention-fg); }
</style>
