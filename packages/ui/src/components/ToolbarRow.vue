<!--
  @slots
    left   — left-aligned content (filter chips, title)
    center — optional centered content
    right  — right-aligned content (actions, search)
    default — alias for `left` when used without named slots
  Flat hairline toolbar replacing glass `enhanced-toolbar` patterns.
  See design-system/pages/02-primitives.md §ToolbarRow.
-->
<script setup lang="ts">
export interface ToolbarRowProps {
  /** comfortable=40px (default), compact=32px. */
  density?: "comfortable" | "compact";
  /** Sticks to top of scroll container with --z-header. */
  sticky?: boolean;
  /** header = canvas-subtle bg + hairline; inline = transparent. */
  variant?: "header" | "inline";
}

withDefaults(defineProps<ToolbarRowProps>(), {
  density: "comfortable",
  sticky: false,
  variant: "header",
});
</script>

<template>
  <div
    data-tp-component="ToolbarRow"
    class="tbr"
    :class="[
      `tbr--${density}`,
      `tbr--${variant}`,
      { 'tbr--sticky': sticky },
    ]"
    role="toolbar"
  >
    <div class="tbr__left">
      <slot name="left" />
      <slot v-if="!$slots.left" />
    </div>
    <div v-if="$slots.center" class="tbr__center">
      <slot name="center" />
    </div>
    <div v-if="$slots.right" class="tbr__right">
      <slot name="right" />
    </div>
  </div>
</template>

<style scoped>
.tbr {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--canvas-subtle);
}

.tbr--compact {
  min-height: 32px;
  padding: 0 8px;
}

.tbr--inline {
  background: transparent;
  border-bottom: 0;
}

.tbr--sticky {
  position: sticky;
  top: 0;
  z-index: var(--z-header);
}

.tbr__left {
  display: flex;
  gap: 8px;
  align-items: center;
  min-width: 0;
}

.tbr__center {
  display: flex;
  gap: 8px;
  align-items: center;
  margin: 0 auto;
}

.tbr__right {
  margin-left: auto;
  display: flex;
  gap: 8px;
  align-items: center;
}
</style>
