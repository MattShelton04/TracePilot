<script setup lang="ts">
import { formatBytes, type SessionImagePreview } from "@tracepilot/types";
import { computed, ref, watch } from "vue";

const props = defineProps<{
  preview: SessionImagePreview;
  filePath?: string;
}>();

const fit = ref(true);
const zoom = ref(100);
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
  zoom.value = Math.max(25, Math.min(400, next));
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
      <span class="image-viewer__meta">
        {{ preview.originalFormat.toUpperCase() }} ·
        {{ preview.originalWidth }}×{{ preview.originalHeight }} ·
        {{ formatBytes(preview.originalSizeBytes) }}
        <template v-if="preview.wasDownscaled"> · preview {{ preview.width }}×{{ preview.height }}</template>
        <template v-if="preview.animationOmitted"> · first frame</template>
      </span>
    </div>
    <div class="image-viewer__canvas">
      <img
        :src="imageUrl"
        :alt="filePath ? `Preview of ${filePath}` : 'Session image preview'"
        :class="{ 'image-viewer__image--fit': fit }"
        :style="imageStyle"
        draggable="false"
      />
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

.image-viewer__canvas {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background-color: var(--canvas-inset);
  background-image:
    linear-gradient(45deg, var(--canvas-subtle) 25%, transparent 25%),
    linear-gradient(-45deg, var(--canvas-subtle) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, var(--canvas-subtle) 75%),
    linear-gradient(-45deg, transparent 75%, var(--canvas-subtle) 75%);
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
  background-size: 16px 16px;
}

.image-viewer__canvas img {
  flex: none;
  max-width: none;
  max-height: none;
  object-fit: contain;
  box-shadow: 0 2px 12px var(--shadow-color, rgba(0, 0, 0, 0.18));
}

.image-viewer__canvas .image-viewer__image--fit {
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
}
</style>
