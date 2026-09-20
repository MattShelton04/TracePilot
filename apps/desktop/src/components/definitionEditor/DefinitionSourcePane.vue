<script setup lang="ts">
import { useResizeHandle } from "@tracepilot/ui";
import { reactive, ref, useId, watch } from "vue";

withDefaults(defineProps<{ resizable?: boolean; label?: string }>(), {
  resizable: true,
  label: "Resize definition and prompt",
});

const definitionId = useId();
const content = ref<HTMLElement | null>(null);
let automatic = true;
const split = reactive(
  useResizeHandle({
    axis: "y",
    initial: 45,
    minPct: 20,
    maxPct: 80,
    minPanePx: 120,
    splitterPx: 8,
  }),
);

// Start at the content's natural height, capped at the default split. Observe
// the inner content so the allocated pane height cannot inflate the measurement.
function fitContent() {
  const height = split.containerRef?.getBoundingClientRect().height;
  const contentHeight = content.value?.getBoundingClientRect().height;
  if (!automatic || !height || !contentHeight) return;
  split.leftWidth = Math.min(
    split.maxLeftWidth,
    Math.max(split.minLeftWidth, Math.min(45, (Math.ceil(contentHeight) / height) * 100)),
  );
}

watch(
  [() => split.containerRef, content],
  ([container, element], _previous, onCleanup) => {
    fitContent();
    if (!container || !element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(fitContent);
    observer.observe(container);
    observer.observe(element);
    onCleanup(() => observer.disconnect());
  },
  { flush: "post" },
);

function onMouseDown(event: MouseEvent) {
  split.onMouseDown(event);
  if (split.dragging) automatic = false;
}

function onKeyDown(event: KeyboardEvent) {
  if (event.defaultPrevented) return;
  split.onKeyDown(event);
  if (!event.defaultPrevented) return;
  automatic = event.key === "Enter";
  fitContent();
}
</script>

<template>
  <div
    :ref="(el) => (split.containerRef = el as HTMLElement | null)"
    class="panel-scroll"
    :class="{ 'definition-source': resizable }"
    :style="{ '--definition-split': `${split.leftWidth}%` }"
  >
    <template v-if="resizable">
      <div :id="definitionId" class="definition-source__metadata">
        <div ref="content" class="definition-source__content"><slot name="definition" /></div>
      </div>
      <div
        class="resize-handle definition-source__resize"
        :class="{ active: split.dragging }"
        role="separator"
        tabindex="0"
        :aria-label="label"
        aria-orientation="horizontal"
        :aria-controls="definitionId"
        :aria-valuemin="split.minLeftWidth"
        :aria-valuemax="split.maxLeftWidth"
        :aria-valuenow="split.leftWidth"
        :aria-valuetext="`${Math.round(split.leftWidth)}% definition height`"
        title="Drag to resize. Up/Down arrows adjust height; Shift for larger steps, Home/End for limits, Enter to reset."
        @mousedown="onMouseDown"
        @keydown="onKeyDown"
      />
    </template>
    <slot />
  </div>
</template>
