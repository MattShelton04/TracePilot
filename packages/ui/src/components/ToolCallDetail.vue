<script setup lang="ts">
import { computed } from "vue";
import type { TurnToolCall } from "@tracepilot/types";
import { formatDuration, formatTime } from "../utils/formatters";
import ToolResultRenderer from "./renderers/ToolResultRenderer.vue";
import ToolArgsRenderer from "./renderers/ToolArgsRenderer.vue";

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
  'load-full-result': [toolCallId: string];
  'retry-full-result': [toolCallId: string];
}>();

const displayResult = computed(() => {
  if (props.fullResult != null) return props.fullResult;
  return props.tc.resultContent ?? null;
});

const isTruncated = computed(() =>
  !props.fullResult && !!props.tc.toolCallId && (props.tc.resultContent?.includes("…[truncated]") ?? false)
);

const isRichEnabled = computed(() => props.richEnabled !== false);
</script>

<template>
  <div class="px-4 py-3 space-y-2" style="border-top: 1px solid var(--border-muted); background: var(--canvas-inset);">
    <!-- Error display -->
    <div v-if="tc.error" class="rounded-md px-3 py-2" style="background: var(--danger-muted); border: 1px solid var(--danger-muted);">
      <div class="text-[11px] font-semibold mb-1" style="color: var(--danger-fg);">Error</div>
      <pre class="text-xs whitespace-pre-wrap overflow-x-auto break-words font-mono leading-relaxed" style="color: var(--text-primary);">{{ tc.error }}</pre>
    </div>

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
      <div v-if="isTruncated && !isRichEnabled" class="tool-result-actions">
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
