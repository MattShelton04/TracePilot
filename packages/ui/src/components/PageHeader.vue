<!--
  Canonical PageHeader. See design-system/pages/01-chrome.md §1.4.

  Layout (top → bottom):
    1. Breadcrumb row    — optional, rendered when `crumbs` provided
    2. Title row         — icon (Lucide) · <Heading level=1> title · status pill · #actions slot
    3. Subtitle row      — optional
    4. Hairline divider  — always
    5. Toolbar row       — optional #toolbar slot

  Backward-compat:
    • `size` prop is accepted but ignored beyond an applied class — title
      is always rendered through <Heading level=1> (capped at 20px) per spec.
    • `inlineSubtitle` still bullets the subtitle inline with the title.
    • `#icon` slot still works for callers that hand-roll an icon node;
      `iconName` (Lucide kebab name) is the new preferred path.
-->
<script setup lang="ts">
import * as LucideIcons from "lucide-vue-next";
import { computed } from "vue";
import { type LucideName } from "../icons/templateCatalogue";
import BreadcrumbNav, { type BreadcrumbItem } from "./BreadcrumbNav.vue";
import Heading from "./Heading.vue";
import StatusPill, { type StatusPillTone } from "./StatusPill.vue";

export interface PageHeaderStatus {
  tone: StatusPillTone;
  label: string;
  iconName?: LucideName;
}

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  /** Hierarchical context (rendered as BreadcrumbNav above title row). */
  crumbs?: BreadcrumbItem[];
  /** Lucide kebab-case icon name. Rendered 20px in --accent-fg. */
  iconName?: LucideName;
  /** Inline status pill (right of title row, before #actions). */
  status?: PageHeaderStatus;
  /** Density modifier; `compact` halves vertical padding. */
  density?: "comfortable" | "compact";
  /**
   * Render subtitle on the same line as the title (separated by a bullet)
   * instead of beneath it.
   */
  inlineSubtitle?: boolean;
  /**
   * Visual modifier kept for backward-compat with existing consumers.
   * Title size is always text.h1 (20px) per design-system §1.4.
   */
  size?: "sm" | "md" | "lg";
}

const props = withDefaults(defineProps<PageHeaderProps>(), {
  density: "comfortable",
  size: "md",
});

function kebabToPascal(name: string): string {
  return name
    .split("-")
    .map((p) => (p.length ? p[0].toUpperCase() + p.slice(1) : p))
    .join("");
}

const titleIconComponent = computed(() => {
  if (!props.iconName) return null;
  const pascal = kebabToPascal(props.iconName);
  return (LucideIcons as Record<string, unknown>)[pascal] ?? null;
});

const statusIconComponent = computed(() => {
  if (!props.status?.iconName) return null;
  const pascal = kebabToPascal(props.status.iconName);
  return (LucideIcons as Record<string, unknown>)[pascal] ?? null;
});
</script>

<template>
  <header
    class="page-header"
    :class="[`page-header--${size}`, `page-header--${density}`]"
    data-tp-component="PageHeader"
  >
    <div v-if="crumbs && crumbs.length" class="page-header__crumbs">
      <BreadcrumbNav :crumbs="crumbs" />
    </div>

    <div class="page-header__row">
      <span v-if="$slots.icon" class="title-icon-tile">
        <slot name="icon" />
      </span>
      <span v-else-if="titleIconComponent" class="title-icon" aria-hidden="true">
        <component :is="titleIconComponent" :size="20" :stroke-width="1.5" />
      </span>

      <Heading :level="1" class="page-title" truncate>
        {{ title }}<span
          v-if="inlineSubtitle && subtitle"
          class="page-subtitle-inline"
        >
          <span class="page-subtitle-sep" aria-hidden="true">•</span>
          {{ subtitle }}
        </span>
      </Heading>

      <StatusPill
        v-if="status"
        :tone="status.tone"
        :label="status.label"
        size="sm"
        class="page-header__status"
      >
        <template v-if="statusIconComponent" #icon>
          <component :is="statusIconComponent" :size="12" :stroke-width="1.5" />
        </template>
      </StatusPill>

      <div v-if="$slots.actions" class="title-actions">
        <slot name="actions" />
      </div>
    </div>

    <p v-if="subtitle && !inlineSubtitle" class="page-subtitle">{{ subtitle }}</p>

    <slot />

    <div v-if="$slots.toolbar" class="page-header__toolbar">
      <slot name="toolbar" />
    </div>
  </header>
</template>

<style scoped>
.page-header {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px 24px;
  border-bottom: 1px solid var(--border-subtle);
}

.page-header--compact {
  padding: 12px 16px;
}

.page-header__crumbs {
  min-height: 16px;
}

.page-header__row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  min-height: 28px;
}

.page-title {
  flex: 1;
  min-width: 0;
}

.title-icon-tile {
  width: 30px;
  height: 30px;
  border-radius: var(--radius-md);
  background: var(--accent-muted);
  border: 1px solid var(--border-accent);
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

.title-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--accent-fg);
  flex-shrink: 0;
}

.page-header__status {
  flex-shrink: 0;
}

.title-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  flex-shrink: 0;
}

.page-subtitle {
  font-size: 13px;
  line-height: 18px;
  color: var(--text-secondary);
  margin: 0;
}

.page-subtitle-inline {
  font-size: 13px;
  font-weight: 400;
  color: var(--text-tertiary);
  letter-spacing: normal;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: 8px;
}

.page-subtitle-sep {
  color: var(--text-tertiary);
  opacity: 0.6;
}

.page-header__toolbar {
  margin-top: 4px;
  padding-top: 12px;
  border-top: 1px solid var(--border-subtle);
}
</style>
