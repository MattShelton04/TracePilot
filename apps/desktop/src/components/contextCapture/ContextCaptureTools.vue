<script setup lang="ts">
import type { NormalizedToolDefinition } from "@tracepilot/types";
import { EmptyState, formatBytes } from "@tracepilot/ui";
import { ref } from "vue";
import ContextCaptureJsonViewer from "./ContextCaptureJsonViewer.vue";

defineProps<{ tools: NormalizedToolDefinition[] }>();
const expanded = ref(new Set<number>());

function toggleTool(index: number, event: Event) {
  const next = new Set(expanded.value);
  if ((event.currentTarget as HTMLDetailsElement).open) next.add(index);
  else next.delete(index);
  expanded.value = next;
}
</script>

<template>
  <div class="capture-tools">
    <div class="capture-tools__header">
      <strong>Tool definitions</strong>
      <p>
        Names, descriptions, and input schemas serialized into the captured request.
      </p>
    </div>

    <EmptyState
      v-if="tools.length === 0"
      title="No tool definitions"
      description="This request did not advertise any tools to the model."
    />

    <div v-else class="capture-tools__list">
      <details
        v-for="tool in tools"
        :key="tool.index"
        @toggle="toggleTool(tool.index, $event)"
      >
        <summary>
          <span class="capture-tool__index">{{ tool.index + 1 }}</span>
          <span class="capture-tool__identity">
            <strong>{{ tool.name ?? `Tool ${tool.index + 1}` }}</strong>
            <small v-if="tool.description">{{ tool.description }}</small>
          </span>
          <span class="capture-tool__size">
            {{ formatBytes(tool.bytes) }} · {{ tool.characters.toLocaleString() }} chars
          </span>
        </summary>
        <div v-if="expanded.has(tool.index)" class="capture-tool__body">
          <ContextCaptureJsonViewer
            :value="tool.raw"
            :file-name="`tool-${tool.index + 1}.json`"
            size="large"
          />
        </div>
      </details>
    </div>
  </div>
</template>

<style scoped>
.capture-tools {
  display: grid;
  gap: 16px;
}

.capture-tools__header p {
  margin: 4px 0 0;
  color: var(--text-tertiary);
}

.capture-tools__list {
  overflow: hidden;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-lg);
}

.capture-tools details {
  border-bottom: 1px solid var(--border-muted);
}

.capture-tools details:last-child {
  border-bottom: 0;
}

.capture-tools summary {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 52px;
  padding: 8px 14px;
  background: var(--canvas-default);
  cursor: pointer;
}

.capture-tools summary:hover {
  background: var(--surface-secondary);
}

.capture-tool__index {
  display: grid;
  width: 28px;
  height: 28px;
  flex: none;
  place-items: center;
  border-radius: var(--radius-md);
  background: var(--surface-secondary);
  color: var(--text-tertiary);
  font-size: 0.6875rem;
}

.capture-tool__identity {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.capture-tool__identity small {
  overflow: hidden;
  color: var(--text-tertiary);
  font-size: 0.75rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.capture-tool__size {
  margin-left: auto;
  color: var(--text-tertiary);
  font-size: 0.75rem;
  white-space: nowrap;
}

.capture-tool__body {
  margin: 0 14px 14px 52px;
}
</style>
