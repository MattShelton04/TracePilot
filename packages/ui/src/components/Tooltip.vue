<!--
  @slots default — single trigger element (the wrapper sets aria-describedby on it).
  Lightweight CSS-only tooltip — visibility flips on :hover / :focus-within of
  the inline-block wrapper. No floating-ui, no JS positioning, no portals.
  Position is one of top/bottom/left/right; long copy may overflow into the
  surrounding canvas — pick a side with room.
  See design-system/pages/02-primitives.md §Tooltip.
-->
<script setup lang="ts">
import { computed } from "vue";

export interface TooltipProps {
  text: string;
  position?: "top" | "bottom" | "left" | "right";
  /** When true, never render the tooltip (e.g. when text is redundant). */
  disabled?: boolean;
}

const props = withDefaults(defineProps<TooltipProps>(), {
  position: "top",
  disabled: false,
});

const tipId = `tp-tt-${Math.random().toString(36).slice(2, 9)}`;
const positionClass = computed(() => `tooltip--${props.position}`);
</script>

<template>
  <span
    data-tp-component="Tooltip"
    class="tooltip"
    :class="[positionClass, { 'tooltip--disabled': disabled }]"
    :aria-describedby="disabled ? undefined : tipId"
  >
    <slot />
    <span
      v-if="!disabled"
      :id="tipId"
      role="tooltip"
      class="tooltip__bubble"
    >{{ text }}</span>
  </span>
</template>

<style scoped>
.tooltip {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.tooltip__bubble {
  position: absolute;
  z-index: var(--z-tooltip);
  padding: 4px 8px;
  background: var(--canvas-overlay);
  color: var(--text-primary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-md);
  font-size: 12px;
  line-height: 16px;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  visibility: hidden;
  transition: opacity 120ms cubic-bezier(0.2, 0.6, 0.2, 1);
}

.tooltip:hover .tooltip__bubble,
.tooltip:focus-within .tooltip__bubble {
  opacity: 1;
  visibility: visible;
}

.tooltip--top .tooltip__bubble {
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
}

.tooltip--bottom .tooltip__bubble {
  top: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
}

.tooltip--left .tooltip__bubble {
  right: calc(100% + 6px);
  top: 50%;
  transform: translateY(-50%);
}

.tooltip--right .tooltip__bubble {
  left: calc(100% + 6px);
  top: 50%;
  transform: translateY(-50%);
}

@media (prefers-reduced-motion: reduce) {
  .tooltip__bubble {
    transition: opacity 1ms;
  }
}
</style>
