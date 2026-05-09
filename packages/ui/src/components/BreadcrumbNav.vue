<!--
  Canonical breadcrumb. Renders the "where am I within this view" hierarchy
  inside <PageHeader>. Generic shell — route-meta wiring lives in app code
  (apps/desktop/src/composables/useBreadcrumbs.ts). See
  design-system/pages/01-chrome.md §1.2.

  - <nav aria-label="Breadcrumb"> with <ol>
  - last crumb is aria-current="page" and not a link
  - chevron-right Lucide separator, --text-tertiary
  - middle-truncate when crumbs.length > maxCrumbs (default 4): keeps the
    first crumb + "…" + the trailing (maxCrumbs - 1). The collapsed "…"
    surfaces the hidden labels via <Tooltip>.
  - per-crumb labels longer than 32 chars middle-truncate; full label sits
    in `title` and inside a Tooltip.
-->
<script setup lang="ts">
import { ChevronRight, MoreHorizontal } from "lucide-vue-next";
import { computed } from "vue";
import type { RouteLocationRaw } from "vue-router";
import Tooltip from "./Tooltip.vue";

export interface BreadcrumbItem {
  label: string;
  to?: RouteLocationRaw;
  /** Render label in --font-mono (UUIDs, hashes). */
  mono?: boolean;
  /** Optional stable key when labels collide. */
  id?: string;
}

export interface BreadcrumbNavProps {
  crumbs: BreadcrumbItem[];
  /** When more than this many crumbs are present, middle-truncate. */
  maxCrumbs?: number;
  /** Per-label character cap before middle-truncation. */
  maxLabelChars?: number;
}

const props = withDefaults(defineProps<BreadcrumbNavProps>(), {
  maxCrumbs: 4,
  maxLabelChars: 32,
});

interface DisplayCrumb {
  kind: "crumb" | "ellipsis";
  item?: BreadcrumbItem;
  hiddenLabels?: string[];
  isLast: boolean;
  truncated?: string;
}

function truncateMiddle(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}

const displayCrumbs = computed<DisplayCrumb[]>(() => {
  const all = props.crumbs;
  const lastIndex = all.length - 1;
  const out: DisplayCrumb[] = [];

  if (all.length <= props.maxCrumbs) {
    for (let i = 0; i < all.length; i++) {
      const item = all[i];
      out.push({
        kind: "crumb",
        item,
        isLast: i === lastIndex,
        truncated: truncateMiddle(item.label, props.maxLabelChars),
      });
    }
    return out;
  }

  // Keep first + collapse middle + tail
  const tailCount = props.maxCrumbs - 1;
  const tailStart = all.length - tailCount;
  const head = all[0];
  out.push({
    kind: "crumb",
    item: head,
    isLast: false,
    truncated: truncateMiddle(head.label, props.maxLabelChars),
  });
  out.push({
    kind: "ellipsis",
    isLast: false,
    hiddenLabels: all.slice(1, tailStart).map((c) => c.label),
  });
  for (let i = tailStart; i < all.length; i++) {
    const item = all[i];
    out.push({
      kind: "crumb",
      item,
      isLast: i === lastIndex,
      truncated: truncateMiddle(item.label, props.maxLabelChars),
    });
  }
  return out;
});
</script>

<template>
  <nav class="breadcrumb-nav" aria-label="Breadcrumb" data-tp-component="BreadcrumbNav">
    <ol class="breadcrumb-nav__list">
      <template v-for="(d, i) in displayCrumbs" :key="d.item?.id ?? d.item?.label ?? `e${i}`">
        <li
          v-if="d.kind === 'crumb' && d.item"
          class="breadcrumb-nav__item"
          :class="{ 'breadcrumb-nav__item--mono': d.item.mono }"
        >
          <Tooltip
            v-if="d.item.label !== d.truncated"
            :text="d.item.label"
            position="bottom"
          >
            <router-link
              v-if="d.item.to && !d.isLast"
              :to="d.item.to"
              class="breadcrumb-nav__link"
              :title="d.item.label"
            >{{ d.truncated }}</router-link>
            <span
              v-else
              class="breadcrumb-nav__current"
              :aria-current="d.isLast ? 'page' : undefined"
              :title="d.item.label"
            >{{ d.truncated }}</span>
          </Tooltip>
          <template v-else>
            <router-link
              v-if="d.item.to && !d.isLast"
              :to="d.item.to"
              class="breadcrumb-nav__link"
            >{{ d.item.label }}</router-link>
            <span
              v-else
              class="breadcrumb-nav__current"
              :aria-current="d.isLast ? 'page' : undefined"
            >{{ d.item.label }}</span>
          </template>
        </li>
        <li v-else-if="d.kind === 'ellipsis'" class="breadcrumb-nav__item breadcrumb-nav__ellipsis">
          <Tooltip :text="(d.hiddenLabels ?? []).join(' › ')" position="bottom">
            <span class="breadcrumb-nav__more" aria-label="Show hidden breadcrumbs">
              <MoreHorizontal :size="14" :stroke-width="1.5" />
            </span>
          </Tooltip>
        </li>
        <li
          v-if="i < displayCrumbs.length - 1"
          aria-hidden="true"
          class="breadcrumb-nav__sep"
        >
          <ChevronRight :size="14" :stroke-width="1.5" />
        </li>
      </template>
    </ol>
  </nav>
</template>

<style scoped>
.breadcrumb-nav {
  display: flex;
  align-items: center;
  min-width: 0;
}

.breadcrumb-nav__list {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  list-style: none;
  margin: 0;
  padding: 0;
  min-width: 0;
}

.breadcrumb-nav__item {
  display: inline-flex;
  align-items: center;
  font-size: 12px;
  line-height: 16px;
  color: var(--text-tertiary);
  min-width: 0;
}

.breadcrumb-nav__item--mono,
.breadcrumb-nav__item--mono .breadcrumb-nav__current,
.breadcrumb-nav__item--mono .breadcrumb-nav__link {
  font-family: var(--font-mono);
  font-feature-settings: "tnum" 1;
}

.breadcrumb-nav__link {
  color: var(--text-secondary);
  text-decoration: none;
  border-radius: var(--radius-sm);
  padding: 2px 4px;
  margin: 0 -4px;
  transition: color 120ms cubic-bezier(0.2, 0.6, 0.2, 1);
}

.breadcrumb-nav__link:hover {
  color: var(--text-primary);
}

.breadcrumb-nav__link:focus-visible {
  outline: 2px solid var(--accent-emphasis);
  outline-offset: 2px;
}

.breadcrumb-nav__current {
  color: var(--text-primary);
  font-weight: 500;
  user-select: text;
}

.breadcrumb-nav__sep {
  display: inline-flex;
  align-items: center;
  color: var(--text-tertiary);
  margin: 0 6px;
  flex-shrink: 0;
}

.breadcrumb-nav__more {
  display: inline-flex;
  align-items: center;
  color: var(--text-tertiary);
  padding: 2px 4px;
  border-radius: var(--radius-sm);
}

.breadcrumb-nav__more:focus-visible {
  outline: 2px solid var(--accent-emphasis);
  outline-offset: 2px;
}
</style>
