<script setup lang="ts">
import type { NormalizedSection } from "@tracepilot/types";
import { Badge, formatBytes } from "@tracepilot/ui";

defineProps<{ blocks: NormalizedSection[] }>();
function json(value: unknown) {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}
</script>

<template>
  <div class="capture-section-list">
    <p v-if="blocks.length === 0" class="empty-copy">No recognized system instruction blocks.</p>
    <details v-for="block in blocks" :key="`${block.source}-${block.index}`">
      <summary>
        {{ block.source }} #{{ block.index + 1 }}
        <Badge v-if="block.containsProbe" variant="warning">contains probe</Badge>
        <span>{{ formatBytes(block.bytes) }} · {{ block.characters }} chars</span>
      </summary>
      <pre>{{ json(block.content) }}</pre>
    </details>
  </div>
</template>

<style scoped>
.capture-section-list { display: grid; gap: 10px; }
summary { display: flex; align-items: center; gap: 8px; cursor: pointer; }
summary > span:last-child { margin-left: auto; color: var(--text-tertiary); font-size: 12px; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 420px; overflow: auto; padding: 12px; background: var(--canvas-inset); border-radius: var(--radius-sm); }
.empty-copy { color: var(--text-tertiary); }
</style>
