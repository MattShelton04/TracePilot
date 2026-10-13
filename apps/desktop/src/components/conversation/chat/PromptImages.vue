<script setup lang="ts">
/**
 * PromptImages — the pictures attached to a prompt, as thumbnails that open
 * in the session explorer's image viewer. Each one is read from the session
 * on demand (`get_prompt_image`), since transcripts are parsed without them.
 */
import { getPromptImage } from "@tracepilot/client";
import { type SessionImagePreview, toErrorMessage } from "@tracepilot/types";
import { ImageFileViewer, ModalDialog } from "@tracepilot/ui";
import { ImageOff } from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import { type PromptImageRef, promptImageRefs } from "@/utils/promptImages";

const props = defineProps<{
  sessionId: string;
  eventIndex: number;
  attachments: unknown[];
}>();

type Loaded = { preview: SessionImagePreview } | { error: string };

// Previews already read, shared by every prompt so re-renders don't re-read.
const MAX_CACHED = 24;
const cache = new Map<string, Promise<Loaded>>();

function load(sessionId: string, eventIndex: number, index: number): Promise<Loaded> {
  const key = `${sessionId}:${eventIndex}:${index}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = getPromptImage(sessionId, eventIndex, index).then(
      (preview) => ({ preview }),
      (error) => ({ error: toErrorMessage(error) }),
    );
    cache.set(key, pending);
    if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value as string);
  }
  return pending;
}

const images = computed(() => promptImageRefs(props.attachments));
const loaded = ref<Record<number, Loaded>>({});
const open = ref<{ ref: PromptImageRef; preview: SessionImagePreview } | null>(null);

watch(
  [() => props.sessionId, () => props.eventIndex, images],
  ([sessionId, eventIndex, refs]) => {
    loaded.value = {};
    for (const image of refs) {
      void load(sessionId, eventIndex, image.index).then((result) => {
        if (sessionId === props.sessionId && eventIndex === props.eventIndex) {
          loaded.value = { ...loaded.value, [image.index]: result };
        }
      });
    }
  },
  { immediate: true },
);

/** Each image with what has been read for it so far. */
const shown = computed(() =>
  images.value.map((image) => {
    const result = loaded.value[image.index];
    return {
      image,
      preview: result && "preview" in result ? result.preview : null,
      error: result && "error" in result ? result.error : null,
    };
  }),
);

function src(preview: SessionImagePreview) {
  return `data:image/png;base64,${preview.base64Data}`;
}

function close(visible: boolean) {
  if (!visible) open.value = null;
}
</script>

<template>
  <div v-if="images.length" class="cv-prompt-images">
    <template v-for="{ image, preview, error } in shown" :key="image.index">
      <button
        v-if="preview"
        type="button"
        class="cv-prompt-image"
        :title="`${image.label} — open`"
        @click="open = { ref: image, preview }"
      >
        <img :src="src(preview)" :alt="image.label" draggable="false" />
      </button>
      <span v-else-if="error" class="cv-prompt-image cv-prompt-image--missing" :title="error">
        <ImageOff :size="14" aria-hidden="true" />
        {{ image.label }} unavailable
      </span>
      <span v-else class="cv-prompt-image cv-prompt-image--loading" :aria-label="`Loading ${image.label}`" />
    </template>
    <ModalDialog
      :visible="open != null"
      :title="open?.ref.label"
      width="min(1200px, 92vw)"
      @update:visible="close"
    >
      <div v-if="open" class="cv-prompt-image-viewer">
        <ImageFileViewer :preview="open.preview" :file-path="open.ref.label" />
      </div>
    </ModalDialog>
  </div>
</template>

<style scoped>
.cv-prompt-images {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.cv-prompt-image {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  max-width: 100%;
  padding: 0;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm, 6px);
  background: var(--canvas-default);
  overflow: hidden;
}

button.cv-prompt-image {
  cursor: zoom-in;
}

button.cv-prompt-image:hover,
button.cv-prompt-image:focus-visible {
  border-color: var(--accent-emphasis);
}

.cv-prompt-image img {
  display: block;
  max-width: min(320px, 100%);
  max-height: 180px;
  object-fit: contain;
}

.cv-prompt-image--loading {
  width: 120px;
  height: 80px;
  background: var(--canvas-inset, var(--canvas-subtle));
}

.cv-prompt-image--missing {
  padding: 6px 10px;
  font-size: 12px;
  color: var(--text-secondary);
}

.cv-prompt-image-viewer {
  display: flex;
  height: 70vh;
  min-height: 320px;
}
</style>
