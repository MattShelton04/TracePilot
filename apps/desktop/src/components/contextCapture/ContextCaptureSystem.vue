<script setup lang="ts">
import type { NormalizedSection } from "@tracepilot/types";
import { ActionButton, Badge, EmptyState, formatBytes, useClipboard } from "@tracepilot/ui";
import { Copy } from "lucide-vue-next";
import ContextCaptureJsonViewer from "./ContextCaptureJsonViewer.vue";

defineProps<{ blocks: NormalizedSection[] }>();
const { copy } = useClipboard();
</script>

<template>
  <div class="capture-system">
    <div class="capture-system__header">
      <strong>System instructions</strong>
      <p>Blocks are shown in the order used by the captured API request.</p>
    </div>

    <EmptyState
      v-if="blocks.length === 0"
      title="No recognized system blocks"
      description="Check Raw JSON if this API uses an unfamiliar system-instruction field."
    />

    <div v-else class="capture-system__list">
      <section v-for="block in blocks" :key="`${block.source}-${block.index}`">
        <header>
          <span>
            <strong>{{ block.source }}</strong>
            <small>Block {{ block.index + 1 }}</small>
          </span>
          <Badge v-if="block.containsProbe" variant="warning">Contains probe</Badge>
          <span class="capture-system__size">
            {{ formatBytes(block.bytes) }} · {{ block.characters.toLocaleString() }} chars
          </span>
          <ActionButton
            size="sm"
            variant="ghost"
            @click="copy(typeof block.content === 'string' ? block.content : JSON.stringify(block.content, null, 2))"
          >
            <Copy :size="13" /> Copy
          </ActionButton>
        </header>

        <div v-if="typeof block.content === 'string'" class="capture-system__text">
          <pre>{{ block.content }}</pre>
          <details>
            <summary>JSON representation</summary>
            <ContextCaptureJsonViewer
              :value="block.content"
              :file-name="`system-${block.index + 1}.json`"
              size="compact"
            />
          </details>
        </div>

        <div v-else class="capture-system__content">
          <ContextCaptureJsonViewer
            :value="block.content"
            :file-name="`system-${block.index + 1}.json`"
            size="large"
          />
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.capture-system {
  display: grid;
  gap: 16px;
}

.capture-system__header p {
  margin: 4px 0 0;
  color: var(--text-tertiary);
  font-size: 0.8125rem;
}

.capture-system__list {
  display: grid;
  gap: 16px;
}

.capture-system section {
  overflow: hidden;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-lg);
}

.capture-system header {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 52px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--border-muted);
  background: var(--surface-secondary);
}

.capture-system header > span:first-child {
  display: grid;
  gap: 2px;
}

.capture-system header small,
.capture-system__size {
  color: var(--text-tertiary);
  font-size: 0.75rem;
}

.capture-system__size {
  margin-left: auto;
}

.capture-system__text,
.capture-system__content {
  min-width: 0;
  padding: 14px;
}

.capture-system__text pre {
  max-height: 620px;
  margin: 0;
  overflow: auto;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 0.75rem;
  line-height: 1.6;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.capture-system__text details {
  margin-top: 14px;
  border-top: 1px solid var(--border-muted);
}

.capture-system__text summary {
  padding: 10px 0;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 0.75rem;
}

@media (max-width: 700px) {
  .capture-system header {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .capture-system__size {
    width: 100%;
    margin-left: 0;
  }
}
</style>
