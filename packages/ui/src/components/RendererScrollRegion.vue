<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";

const props = withDefaults(
  defineProps<{ label?: string; maxHeight?: number; resetKey?: string | number }>(),
  {
    label: "output",
    maxHeight: 320,
  },
);
const id = useId();
const viewport = ref<HTMLElement>();
const content = ref<HTMLElement>();
const expanded = ref(false);
const overflows = ref(false);
// Replacing a page should start at its first row without collapsing an expanded region.
watch(
  () => props.resetKey,
  async () => {
    await nextTick();
    if (viewport.value) viewport.value.scrollTop = 0;
  },
);
let observer: ResizeObserver | undefined;
let measurementFrame: number | undefined;
let disposed = false;
function measure() {
  if (!expanded.value && viewport.value) {
    overflows.value = viewport.value.scrollHeight > viewport.value.clientHeight + 1;
  }
}
function scheduleMeasurement() {
  if (disposed || measurementFrame !== undefined) return;
  // Updating the disclosure can resize its parent. Leave ResizeObserver delivery
  // before changing reactive layout state, and combine simultaneous notifications.
  measurementFrame = requestAnimationFrame(() => {
    measurementFrame = undefined;
    measure();
  });
}
async function toggle() {
  expanded.value = !expanded.value;
  await nextTick();
  scheduleMeasurement();
}
onMounted(() => {
  if (typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(scheduleMeasurement);
    if (viewport.value) observer.observe(viewport.value);
    if (content.value) observer.observe(content.value);
  }
  scheduleMeasurement();
});
onBeforeUnmount(() => {
  disposed = true;
  observer?.disconnect();
  if (measurementFrame !== undefined) cancelAnimationFrame(measurementFrame);
});
</script>

<template>
  <div class="renderer-scroll-region">
    <div
      :id="id"
      ref="viewport"
      class="renderer-scroll-region__viewport"
      :style="{ maxHeight: expanded ? 'none' : `${maxHeight}px` }"
      role="region"
      :aria-label="label"
      tabindex="0"
    ><div ref="content"><slot /></div></div>
    <button
      v-if="overflows || expanded"
      type="button"
      class="renderer-scroll-region__toggle"
      :aria-controls="id"
      :aria-expanded="expanded"
      @click="toggle"
    >{{ expanded ? 'Show less' : 'Show all' }} {{ label }}</button>
  </div>
</template>

<style scoped>
.renderer-scroll-region { min-width: 0; }
.renderer-scroll-region__viewport { overflow: auto; min-width: 0; scrollbar-gutter: stable; }
.renderer-scroll-region__toggle {
  display: block; width: 100%; padding: 8px 12px; text-align: left;
  border: 0; border-top: 1px solid var(--border-subtle);
  background: var(--canvas-inset); color: var(--accent-fg);
  font-size: 12px; cursor: pointer;
}
.renderer-scroll-region__toggle:hover { background: var(--accent-subtle); }
.renderer-scroll-region__toggle:focus-visible,
.renderer-scroll-region__viewport:focus-visible { outline: 2px solid var(--accent-emphasis); outline-offset: -2px; }
</style>
