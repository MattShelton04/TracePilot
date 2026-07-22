<script setup lang="ts">
import type { NormalizedToolDefinition } from "@tracepilot/types";
import { formatBytes } from "@tracepilot/ui";

defineProps<{ tools: NormalizedToolDefinition[] }>();
</script>

<template>
  <div class="capture-tools">
    <p v-if="tools.length === 0">No tool definitions in this request.</p>
    <details v-for="tool in tools" :key="tool.index">
      <summary><strong>{{ tool.name ?? `Tool ${tool.index + 1}` }}</strong><span>{{ formatBytes(tool.bytes) }} · {{ tool.characters }} chars</span></summary>
      <p v-if="tool.description">{{ tool.description }}</p>
      <pre>{{ JSON.stringify(tool.schema ?? tool.raw, null, 2) }}</pre>
    </details>
  </div>
</template>

<style scoped>
.capture-tools { display: grid; gap: 10px; }
.capture-tools > p { color: var(--text-tertiary); }
summary { display: flex; justify-content: space-between; cursor: pointer; }
summary span { color: var(--text-tertiary); font-size: 12px; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 460px; overflow: auto; padding: 12px; background: var(--canvas-inset); border-radius: var(--radius-sm); }
</style>
