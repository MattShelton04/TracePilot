<script setup lang="ts">
import { JsonFileViewer } from "@tracepilot/ui";
import { computed, ref } from "vue";

/** An event's `data` payload as pretty-printed JSON, with a tree view and copy. */
const props = defineProps<{ data: unknown }>();

const mode = ref<"tree" | "raw">("raw");
const content = computed(() => JSON.stringify(props.data ?? null, null, 2));
</script>

<template>
  <div class="event-payload">
    <JsonFileViewer
      :content="content"
      :mode="mode"
      :expand-all="true"
      :show-copy="true"
      @update:mode="mode = $event"
    />
  </div>
</template>

<style scoped>
.event-payload {
  display: flex;
  /* Take the cell's width without widening the table to fit long lines. */
  width: 0;
  min-width: 100%;
  max-height: 360px;
  overflow: hidden;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-md);
  background: var(--canvas-inset);
}
/* Long lines scroll inside the viewer instead of widening it past the copy button. */
.event-payload > * {
  min-width: 0;
}
</style>
