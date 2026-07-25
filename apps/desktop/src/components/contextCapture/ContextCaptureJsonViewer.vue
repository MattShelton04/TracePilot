<script setup lang="ts">
import { JsonFileViewer } from "@tracepilot/ui";
import { computed, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{
    value: unknown;
    fileName: string;
    size?: "compact" | "default" | "large";
  }>(),
  { size: "default" },
);

const mode = ref<"tree" | "raw">("tree");
const content = computed(() => JSON.stringify(props.value, null, 2));

watch(
  () => props.value,
  () => {
    mode.value = "tree";
  },
);
</script>

<template>
  <div class="capture-json-viewer" :class="`capture-json-viewer--${size}`">
    <JsonFileViewer
      :content="content"
      :file-path="fileName"
      :mode="mode"
      :expand-all="true"
      :show-copy="true"
      @update:mode="mode = $event"
    />
  </div>
</template>

<style scoped>
.capture-json-viewer {
  display: flex;
  min-width: 0;
  height: 360px;
  overflow: hidden;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-md);
  background: var(--canvas-default);
}

.capture-json-viewer--compact {
  height: 280px;
}

.capture-json-viewer--large {
  height: min(60vh, 620px);
  min-height: 420px;
}
</style>
