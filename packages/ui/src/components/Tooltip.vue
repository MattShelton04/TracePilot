<!--
  @slots default — single trigger element (the wrapper sets aria-describedby on it).
  The bubble is teleported to the document body and positioned against the viewport,
  so it is not clipped by cards, panels, or scroll containers.
  See design-system/pages/02-primitives.md §Tooltip.
-->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

export interface TooltipProps {
  text: string;
  position?: "top" | "bottom" | "left" | "right";
  /** When true, never render the tooltip (e.g. when text is redundant). */
  disabled?: boolean;
}

type Placement = NonNullable<TooltipProps["position"]>;

const props = withDefaults(defineProps<TooltipProps>(), {
  position: "top",
  disabled: false,
});

const VIEWPORT_MARGIN = 8;
const TRIGGER_GAP = 6;
const tipId = `tp-tt-${Math.random().toString(36).slice(2, 9)}`;
const triggerElement = ref<HTMLElement | null>(null);
const bubbleElement = ref<HTMLElement | null>(null);
const visible = ref(false);
const actualPosition = ref<Placement>(props.position);
const bubbleStyle = ref({ left: "0px", top: "0px" });
const positionClass = computed(() => `tooltip--${props.position}`);

function opposite(position: Placement): Placement {
  return { top: "bottom", bottom: "top", left: "right", right: "left" }[position] as Placement;
}

function coordinates(
  position: Placement,
  trigger: DOMRect,
  bubble: DOMRect,
): { left: number; top: number } {
  switch (position) {
    case "bottom":
      return {
        left: trigger.left + (trigger.width - bubble.width) / 2,
        top: trigger.bottom + TRIGGER_GAP,
      };
    case "left":
      return {
        left: trigger.left - bubble.width - TRIGGER_GAP,
        top: trigger.top + (trigger.height - bubble.height) / 2,
      };
    case "right":
      return {
        left: trigger.right + TRIGGER_GAP,
        top: trigger.top + (trigger.height - bubble.height) / 2,
      };
    default:
      return {
        left: trigger.left + (trigger.width - bubble.width) / 2,
        top: trigger.top - bubble.height - TRIGGER_GAP,
      };
  }
}

function fitsViewport(left: number, top: number, bubble: DOMRect): boolean {
  return (
    left >= VIEWPORT_MARGIN &&
    top >= VIEWPORT_MARGIN &&
    left + bubble.width <= window.innerWidth - VIEWPORT_MARGIN &&
    top + bubble.height <= window.innerHeight - VIEWPORT_MARGIN
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function updatePosition() {
  if (!visible.value || !triggerElement.value || !bubbleElement.value) return;

  const trigger = triggerElement.value.getBoundingClientRect();
  const bubble = bubbleElement.value.getBoundingClientRect();
  const preferred = coordinates(props.position, trigger, bubble);
  const fallbackPosition = opposite(props.position);
  const fallback = coordinates(fallbackPosition, trigger, bubble);
  const placement = fitsViewport(preferred.left, preferred.top, bubble)
    ? props.position
    : fitsViewport(fallback.left, fallback.top, bubble)
      ? fallbackPosition
      : props.position;
  const target = placement === props.position ? preferred : fallback;

  actualPosition.value = placement;
  bubbleStyle.value = {
    left: `${clamp(target.left, VIEWPORT_MARGIN, window.innerWidth - bubble.width - VIEWPORT_MARGIN)}px`,
    top: `${clamp(target.top, VIEWPORT_MARGIN, window.innerHeight - bubble.height - VIEWPORT_MARGIN)}px`,
  };
}

function show() {
  if (props.disabled) return;
  visible.value = true;
  void nextTick(updatePosition);
}

function hide() {
  visible.value = false;
}

function onFocusOut(event: FocusEvent) {
  const nextTarget = event.relatedTarget;
  if (!(nextTarget instanceof Node) || !triggerElement.value?.contains(nextTarget)) hide();
}

watch(
  () => [props.text, props.position],
  () => void nextTick(updatePosition),
);
watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) hide();
  },
);

onMounted(() => {
  window.addEventListener("resize", updatePosition);
  window.addEventListener("scroll", updatePosition, true);
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", updatePosition);
  window.removeEventListener("scroll", updatePosition, true);
});
</script>

<template>
  <span
    ref="triggerElement"
    data-tp-component="Tooltip"
    class="tooltip"
    :class="[positionClass, { 'tooltip--disabled': disabled }]"
    :aria-describedby="disabled ? undefined : tipId"
    @mouseenter="show"
    @mouseleave="hide"
    @focusin="show"
    @focusout="onFocusOut"
  >
    <slot />
  </span>
  <Teleport to="body">
    <span
      v-if="!disabled"
      :id="tipId"
      ref="bubbleElement"
      role="tooltip"
      class="tooltip__bubble"
      :class="[`tooltip__bubble--${actualPosition}`, { 'tooltip__bubble--visible': visible }]"
      :style="bubbleStyle"
    >{{ text }}</span>
  </Teleport>
</template>

<style scoped>
.tooltip {
  display: inline-flex;
  align-items: center;
}

.tooltip__bubble {
  position: fixed;
  z-index: var(--z-tooltip);
  max-width: min(28rem, calc(100vw - 16px));
  padding: 4px 8px;
  background: var(--canvas-overlay);
  color: var(--text-primary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-md);
  font-size: 12px;
  line-height: 16px;
  white-space: normal;
  overflow-wrap: anywhere;
  pointer-events: none;
  opacity: 0;
  visibility: hidden;
  transition: opacity 120ms cubic-bezier(0.2, 0.6, 0.2, 1);
}

.tooltip__bubble--visible {
  opacity: 1;
  visibility: visible;
}

@media (prefers-reduced-motion: reduce) {
  .tooltip__bubble {
    transition: opacity 1ms;
  }
}
</style>
