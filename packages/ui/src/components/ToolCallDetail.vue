<script setup lang="ts">
import type { TurnToolCall } from "@tracepilot/types";
import { computed } from "vue";
import { formatDuration, formatTime } from "../utils/formatters";
import ToolArgsRenderer from "./renderers/ToolArgsRenderer.vue";
import ToolErrorDisplay from "./renderers/ToolErrorDisplay.vue";
import ToolResultRenderer from "./renderers/ToolResultRenderer.vue";

const props = defineProps<{
  tc: TurnToolCall;
  showMetadata?: boolean;
  /** Full (un-truncated) tool result, loaded on demand. */
  fullResult?: string;
  /** Whether the full result is currently being loaded. */
  loadingFullResult?: boolean;
  /** Whether the full result load has failed. */
  failedFullResult?: boolean;
  /** Whether rich rendering is enabled for this tool (default: true). */
  richEnabled?: boolean;
}>();

const emit = defineEmits<{
  "load-full-result": [toolCallId: string];
  "retry-full-result": [toolCallId: string];
}>();

const displayResult = computed(() => {
  if (props.fullResult != null) return props.fullResult;
  return props.tc.resultContent ?? null;
});

const isTruncated = computed(
  () =>
    !props.fullResult &&
    !!props.tc.toolCallId &&
    (props.tc.resultContent?.includes("…[truncated]") ?? false),
);

const isRichEnabled = computed(() => props.richEnabled !== false);
</script>

<template>
  <div class="px-4 py-3 space-y-2" style="border-top: 1px solid var(--border-muted); background: var(--canvas-inset);">
    <!-- Error display -->
    <ToolErrorDisplay v-if="tc.error" :error="tc.error" />

    <!-- Metadata grid -->
    <div v-if="showMetadata !== false" class="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
      <div v-if="tc.toolCallId" class="flex gap-2">
        <span style="color: var(--text-tertiary);">Call ID:</span>
        <span class="font-mono truncate" style="color: var(--text-secondary);">{{ tc.toolCallId }}</span>
      </div>
      <div v-if="tc.startedAt" class="flex gap-2">
        <span style="color: var(--text-tertiary);">Started:</span>
        <span style="color: var(--text-secondary);">{{ formatTime(tc.startedAt) }}</span>
      </div>
      <div v-if="tc.completedAt" class="flex gap-2">
        <span style="color: var(--text-tertiary);">Completed:</span>
        <span style="color: var(--text-secondary);">{{ formatTime(tc.completedAt) }}</span>
      </div>
      <div v-if="tc.durationMs != null" class="flex gap-2">
        <span style="color: var(--text-tertiary);">Duration:</span>
        <span style="color: var(--text-secondary);">{{ formatDuration(tc.durationMs) }}</span>
      </div>
      <div v-if="tc.isComplete === false" class="flex gap-2">
        <span class="font-medium" style="color: var(--warning-fg);">⚠ Incomplete</span>
      </div>
    </div>

    <!-- Arguments -->
    <ToolArgsRenderer :tc="tc" :rich-enabled="isRichEnabled" />

    <!-- Result -->
    <div v-if="displayResult" class="tool-result-section">
      <ToolResultRenderer
        :tc="tc"
        :content="displayResult"
        :rich-enabled="isRichEnabled"
        :is-truncated="isTruncated"
        :loading="loadingFullResult"
        @load-full="emit('load-full-result', $event)"
      />
      <div v-if="isTruncated" class="tool-result-actions">
        <button
          v-if="!failedFullResult"
          class="tool-result-btn"
          :disabled="loadingFullResult"
          @click="emit('load-full-result', tc.toolCallId ?? '')"
        >
          {{ loadingFullResult ? 'Loading…' : 'Show Full Output' }}
        </button>
        <button
          v-else
          class="tool-result-btn tool-result-btn--retry"
          @click="emit('retry-full-result', tc.toolCallId ?? '')"
        >
          ⚠ Load failed — Retry
        </button>
      </div>
    </div>
  </div>
</template>
