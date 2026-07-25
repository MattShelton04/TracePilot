<script setup lang="ts">
import { JsonFileViewer } from "@tracepilot/ui";
import { ref, watch } from "vue";

const props = defineProps<{ rawBody: string; sha256: string }>();
const jsonMode = ref<"tree" | "raw">("tree");

watch(
  () => props.sha256,
  () => {
    jsonMode.value = "tree";
  },
);
</script>

<template>
  <div class="capture-raw">
    <div class="capture-raw__toolbar">
      <div>
        <strong>Captured request body</strong>
        <code>SHA-256 {{ sha256 }}</code>
      </div>
      <p>Raw preserves the captured byte and property order. Tree is a parsed view.</p>
    </div>
    <div class="capture-raw__viewer">
      <JsonFileViewer
        :content="rawBody"
        file-path="request.json"
        :mode="jsonMode"
        :expand-all="true"
        :show-copy="true"
        @update:mode="jsonMode = $event"
      />
    </div>
  </div>
</template>

<style scoped>
.capture-raw {
  overflow: hidden;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-lg);
  background: var(--canvas-default);
}

.capture-raw__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 64px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-muted);
}

.capture-raw__toolbar > div {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.capture-raw__toolbar p {
  margin: 0;
  color: var(--text-tertiary);
  font-size: 0.75rem;
  text-align: right;
}

.capture-raw code {
  overflow: hidden;
  color: var(--text-tertiary);
  font-size: 0.6875rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.capture-raw__viewer {
  display: flex;
  height: min(68vh, 760px);
  min-height: 480px;
  overflow: hidden;
}

@media (max-width: 720px) {
  .capture-raw__toolbar {
    align-items: flex-start;
    flex-direction: column;
  }

  .capture-raw__toolbar p {
    text-align: left;
  }
}
</style>
