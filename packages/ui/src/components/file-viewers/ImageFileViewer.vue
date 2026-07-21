<script setup lang="ts">
import { formatBytes, type SessionImagePreview } from "@tracepilot/types";
import { computed, nextTick, ref, watch } from "vue";

const props = defineProps<{
  preview: SessionImagePreview;
  filePath?: string;
}>();

const fit = ref(true);
const zoom = ref(100);
const canvas = ref<HTMLElement | null>(null);
const image = ref<HTMLImageElement | null>(null);
const dragging = ref(false);
let dragStart = { x: 0, y: 0, left: 0, top: 0 };
const imageUrl = computed(() => `data:image/png;base64,${props.preview.base64Data}`);
const imageStyle = computed(() =>
  fit.value
    ? undefined
    : {
        width: `${Math.max(1, Math.round(props.preview.width * (zoom.value / 100)))}px`,
        height: "auto",
      },
);

watch(
  () => props.filePath,
  () => {
    fit.value = true;
    zoom.value = 100;
  },
);

function setZoom(next: number) {
  fit.value = false;
  zoom.value = Math.round(Math.max(25, Math.min(400, next)));
}

async function zoomAtPointer(event: WheelEvent) {
  event.preventDefault();
  const element = canvas.value;
  if (!element) return;
  const rect = element.getBoundingClientRect();
  const pointerX = event.clientX - rect.left;
  const pointerY = event.clientY - rect.top;
  const oldWidth = element.scrollWidth;
  const oldHeight = element.scrollHeight;
  const oldLeft = element.scrollLeft;
  const oldTop = element.scrollTop;
  const displayedZoom =
    fit.value && image.value
      ? (image.value.clientWidth / Math.max(1, props.preview.width)) * 100
      : zoom.value;
  setZoom(displayedZoom + (event.deltaY < 0 ? 15 : -15));
  await nextTick();
  element.scrollLeft =
    ((oldLeft + pointerX) * element.scrollWidth) / Math.max(1, oldWidth) - pointerX;
  element.scrollTop =
    ((oldTop + pointerY) * element.scrollHeight) / Math.max(1, oldHeight) - pointerY;
}

function startPan(event: PointerEvent) {
  if (event.button !== 0 || !canvas.value) return;
  dragging.value = true;
  dragStart = {
    x: event.clientX,
    y: event.clientY,
    left: canvas.value.scrollLeft,
    top: canvas.value.scrollTop,
  };
  canvas.value.setPointerCapture?.(event.pointerId);
}

function movePan(event: PointerEvent) {
  if (!dragging.value || !canvas.value) return;
  canvas.value.scrollLeft = dragStart.left - (event.clientX - dragStart.x);
  canvas.value.scrollTop = dragStart.top - (event.clientY - dragStart.y);
}

function stopPan(event: PointerEvent) {
  dragging.value = false;
  if (canvas.value?.hasPointerCapture?.(event.pointerId)) {
    canvas.value.releasePointerCapture(event.pointerId);
  }
}
</script>

<template>
  <div class="image-viewer">
    <div class="image-viewer__toolbar">
      <button type="button" :class="{ active: fit }" @click="fit = true">Fit</button>
      <button type="button" :class="{ active: !fit && zoom === 100 }" @click="setZoom(100)">100%</button>
      <button type="button" aria-label="Zoom out" @click="setZoom(zoom - 25)">−</button>
      <span class="image-viewer__zoom">{{ fit ? "Fit" : `${zoom}%` }}</span>
      <button type="button" aria-label="Zoom in" @click="setZoom(zoom + 25)">+</button>
      <span class="image-viewer__hint">Wheel to zoom · drag to pan</span>
      <span class="image-viewer__meta">
        {{ preview.originalFormat.toUpperCase() }} ·
        {{ preview.originalWidth }}×{{ preview.originalHeight }} ·
        {{ formatBytes(preview.originalSizeBytes) }}
        <template v-if="preview.wasDownscaled"> · preview {{ preview.width }}×{{ preview.height }}</template>
        <template v-if="preview.animationOmitted"> · first frame</template>
      </span>
    </div>
    <div
      ref="canvas"
      class="image-viewer__canvas"
      :class="{ 'image-viewer__canvas--dragging': dragging }"
      @wheel="zoomAtPointer"
      @pointerdown="startPan"
      @pointermove="movePan"
      @pointerup="stopPan"
      @pointercancel="stopPan"
    >
      <div class="image-viewer__stage" :class="{ 'image-viewer__stage--fit': fit }">
        <img
          ref="image"
          :src="imageUrl"
          :alt="filePath ? `Preview of ${filePath}` : 'Session image preview'"
          :class="{ 'image-viewer__image--fit': fit }"
          :style="imageStyle"
          draggable="false"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.image-viewer {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.image-viewer__toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 34px;
  padding: 4px 10px;
  border-bottom: 1px solid var(--border-muted);
}

.image-viewer__toolbar button {
  min-width: 28px;
  padding: 4px 7px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 0.6875rem;
}

.image-viewer__toolbar button:hover,
.image-viewer__toolbar button.active {
  border-color: var(--border-default);
  background: var(--canvas-subtle);
  color: var(--text-primary);
}

.image-viewer__zoom {
  min-width: 36px;
  color: var(--text-tertiary);
  font-size: 0.6875rem;
  text-align: center;
}

.image-viewer__meta {
  margin-left: auto;
  color: var(--text-tertiary);
  font-size: 0.6875rem;
}

.image-viewer__hint {
  margin-left: 6px;
  color: var(--text-tertiary);
  font-size: 0.625rem;
}

.image-viewer__canvas {
  flex: 1;
  min-height: 0;
  overflow: auto;
  background-color: var(--canvas-inset);
  background-image:
    linear-gradient(45deg, var(--canvas-subtle) 25%, transparent 25%),
    linear-gradient(-45deg, var(--canvas-subtle) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, var(--canvas-subtle) 75%),
    linear-gradient(-45deg, transparent 75%, var(--canvas-subtle) 75%);
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
  background-size: 16px 16px;
  cursor: grab;
  touch-action: none;
}

.image-viewer__stage {
  display: grid;
  width: max-content;
  min-width: 100%;
  height: max-content;
  min-height: 100%;
  box-sizing: border-box;
  padding: 16px;
  place-items: center;
}

.image-viewer__stage--fit {
  width: 100%;
  height: 100%;
}

.image-viewer__canvas--dragging {
  cursor: grabbing;
  user-select: none;
}

.image-viewer__stage img {
  flex: none;
  max-width: none;
  max-height: none;
  object-fit: contain;
  box-shadow: 0 2px 12px var(--shadow-color, rgba(0, 0, 0, 0.18));
}

.image-viewer__stage .image-viewer__image--fit {
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
}
</style>
