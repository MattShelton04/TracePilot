<script setup lang="ts">
/**
 * ToolArgsRenderer — dispatcher component for tool call arguments.
 *
 * Selects a dedicated args renderer if one exists and rich rendering is enabled,
 * otherwise falls back to formatted JSON display.
 */
import { computed, type Component } from "vue";
import type { TurnToolCall } from "@tracepilot/types";
import { getRendererEntry } from "./registry";

const props = defineProps<{
  tc: TurnToolCall;
  /** Whether rich rendering is enabled for this tool. */
  richEnabled: boolean;
}>();

const entry = computed(() => getRendererEntry(props.tc.toolName));

const activeComponent = computed<Component | null>(() => {
  if (!props.richEnabled) return null;
  return entry.value?.argsComponent ?? null;
});

const hasArgs = computed(() => {
  const a = props.tc.arguments;
  return a && typeof a === "object" && !Array.isArray(a) && Object.keys(a as object).length > 0;
});

const formattedJson = computed(() => {
  if (!hasArgs.value) return "";
  return JSON.stringify(props.tc.arguments, null, 2);
});
</script>

<template>
  <!-- Rich args renderer -->
  <component
    v-if="activeComponent && hasArgs"
    :is="activeComponent"
    :args="tc.arguments as Record<string, unknown>"
    :tc="tc"
  />
  <!-- Fallback: JSON display -->
  <div v-else-if="hasArgs">
    <div class="text-[11px] font-semibold mb-1" style="color: var(--text-tertiary);">Arguments</div>
    <pre class="tool-args-json">{{ formattedJson }}</pre>
  </div>
</template>

<style scoped>
.tool-args-json {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 0.75rem;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-x: auto;
  padding: 8px 12px;
  max-height: 160px;
  overflow-y: auto;
  border-radius: var(--radius-md, 8px);
  color: var(--text-secondary);
  background: var(--canvas-default);
  border: 1px solid var(--border-muted);
}
</style>
