<script setup lang="ts">
import type { NormalizedSection } from "@tracepilot/types";
import { Badge, EmptyState, formatBytes } from "@tracepilot/ui";
import ContextCaptureJsonViewer from "./ContextCaptureJsonViewer.vue";

defineProps<{ blocks: NormalizedSection[] }>();
</script>

<template>
  <div class="capture-system">
    <div class="capture-system__header">
      <strong>System instructions</strong>
      <p>
        Protocol-specific system and instruction fields, shown in their captured order.
      </p>
    </div>

    <EmptyState
      v-if="blocks.length === 0"
      title="No recognized system blocks"
      description="The exact field remains available in Raw JSON if this protocol uses an unfamiliar shape."
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
        </header>
        <div class="capture-system__content">
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

.capture-system__content {
  min-width: 0;
  padding: 14px;
}
</style>
