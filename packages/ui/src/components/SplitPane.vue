<!--
  @slots
    first  — first pane (left/top)
    second — second pane (right/bottom)
    handle — optional custom handle content
  Keyboard-resizable, persisted split layout. See 02-primitives.md §SplitPane.
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { usePersistedRef } from "../composables/usePersistedRef";

export interface SplitPaneProps {
  /** Persistence + ARIA namespace (required). */
  paneId: string;
  /** horizontal = left|right (default), vertical = top|bottom. */
  orientation?: "horizontal" | "vertical";
  /** Initial size of the first pane in px. Default 320. */
  initialSize?: number;
  /** Min size in px. Default 160. */
  min?: number;
  /** Max size in px. Default 800. */
  max?: number;
  /** Persist to localStorage. Default true. */
  persist?: boolean;
}

const props = withDefaults(defineProps<SplitPaneProps>(), {
  orientation: "horizontal",
  initialSize: 320,
  min: 160,
  max: 800,
  persist: true,
});

const STORAGE_KEY = computed(() => `tracepilot:splitpane:${props.paneId}`);

const persisted = usePersistedRef<number>(
  props.persist ? STORAGE_KEY.value : "__tp_splitpane_inert__",
  props.initialSize,
);

const size = ref<number>(props.persist ? persisted.value : props.initialSize);

watch(size, (v) => {
  if (props.persist) persisted.value = v;
});

const rootEl = ref<HTMLElement | null>(null);
const handleEl = ref<HTMLElement | null>(null);
const dragging = ref(false);

function clamp(v: number): number {
  return Math.max(props.min, Math.min(props.max, Math.round(v)));
}

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0 && e.pointerType === "mouse") return;
  dragging.value = true;
  handleEl.value?.setPointerCapture(e.pointerId);
  e.preventDefault();
}

function onPointerMove(e: PointerEvent) {
  if (!dragging.value || !rootEl.value) return;
  const rect = rootEl.value.getBoundingClientRect();
  const next = props.orientation === "horizontal" ? e.clientX - rect.left : e.clientY - rect.top;
  size.value = clamp(next);
}

function onPointerUp(e: PointerEvent) {
  if (!dragging.value) return;
  dragging.value = false;
  handleEl.value?.releasePointerCapture(e.pointerId);
}

function step(delta: number) {
  size.value = clamp(size.value + delta);
}

function onKeydown(e: KeyboardEvent) {
  const horiz = props.orientation === "horizontal";
  const decrKey = horiz ? "ArrowLeft" : "ArrowUp";
  const incrKey = horiz ? "ArrowRight" : "ArrowDown";
  if (e.altKey && (e.key === decrKey || e.key === incrKey)) {
    e.preventDefault();
    const dir = e.key === decrKey ? -1 : 1;
    const amount = e.shiftKey ? 64 : 16;
    step(dir * amount);
    return;
  }
  if (e.altKey && e.key === "Home") {
    e.preventDefault();
    size.value = clamp(props.initialSize);
  }
}

onMounted(() => {
  size.value = clamp(size.value);
});

onBeforeUnmount(() => {
  dragging.value = false;
});

const firstPaneStyle = computed(() =>
  props.orientation === "horizontal"
    ? { width: `${size.value}px`, flex: `0 0 ${size.value}px` }
    : { height: `${size.value}px`, flex: `0 0 ${size.value}px` },
);

const ariaValueNow = computed(() => size.value);
const firstPaneId = computed(() => `tp-split-${props.paneId}-first`);
</script>

<template>
  <div
    ref="rootEl"
    data-tp-component="SplitPane"
    class="split"
    :class="[`split--${orientation}`, { 'split--dragging': dragging }]"
  >
    <div :id="firstPaneId" class="split__pane split__pane--first" :style="firstPaneStyle">
      <slot name="first" />
    </div>
    <div
      ref="handleEl"
      class="split__handle"
      role="separator"
      :aria-orientation="orientation === 'horizontal' ? 'vertical' : 'horizontal'"
      :aria-valuenow="ariaValueNow"
      :aria-valuemin="min"
      :aria-valuemax="max"
      :aria-controls="firstPaneId"
      :aria-label="`Resize ${paneId} pane`"
      tabindex="0"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @keydown="onKeydown"
    >
      <slot name="handle" />
    </div>
    <div class="split__pane split__pane--second">
      <slot name="second" />
    </div>
  </div>
</template>

<style scoped>
.split {
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 0;
  min-width: 0;
}
.split--vertical { flex-direction: column; }

.split__pane {
  overflow: auto;
  min-width: 0;
  min-height: 0;
}
.split__pane--second { flex: 1 1 0; }

.split__handle {
  background: transparent;
  flex-shrink: 0;
  position: relative;
  width: 4px;
  cursor: col-resize;
  touch-action: none;
}
.split--vertical .split__handle {
  cursor: row-resize;
  height: 4px;
  width: auto;
}

.split__handle::after {
  content: "";
  position: absolute;
  inset: 0;
  background: var(--border-subtle);
  transition: background-color 120ms cubic-bezier(0.2, 0.6, 0.2, 1);
}

.split__handle:hover::after,
.split__handle:focus-visible::after,
.split--dragging .split__handle::after {
  background: var(--accent-emphasis);
}

.split__handle:focus-visible { outline: none; }

@media (prefers-reduced-motion: reduce) {
  .split__handle::after { transition: none; }
}
</style>
