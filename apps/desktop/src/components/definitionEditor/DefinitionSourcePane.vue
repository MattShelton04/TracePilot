<script setup lang="ts">
import { useResizeHandle } from "@tracepilot/ui";
import { reactive, useId } from "vue";

withDefaults(defineProps<{ resizable?: boolean; label?: string }>(), {
  resizable: true,
  label: "Resize definition and prompt",
});

const definitionId = useId();
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
</script>

<template>
  <div
    :ref="(el) => (split.containerRef = el as HTMLElement | null)"
    class="panel-scroll"
    :class="{ 'definition-source': resizable }"
    :style="{ '--definition-split': `${split.leftWidth}%` }"
  >
    <template v-if="resizable">
      <div :id="definitionId" class="definition-source__metadata"><slot name="definition" /></div>
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
        @mousedown="split.onMouseDown"
        @keydown="split.onKeyDown"
      />
    </template>
    <slot />
  </div>
</template>
