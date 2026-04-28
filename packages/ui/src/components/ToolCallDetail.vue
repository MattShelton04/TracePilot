<script setup lang="ts">
import type { TurnToolCall } from "@tracepilot/types";
import { computed, inject } from "vue";
import { LIVE_TOOL_PARTIAL_OUTPUT_KEY } from "../composables/liveToolPartialOutput";
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

const livePartialOutputs = inject(LIVE_TOOL_PARTIAL_OUTPUT_KEY, null);

// Live streaming stdout from the SDK live-state reducer, only visible
// while the final result hasn't been persisted/loaded yet. Once the
// persisted `resultContent` (or fetched `fullResult`) arrives, the
// real result block takes over.
const livePartial = computed<string | null>(() => {
  const id = props.tc.toolCallId;
  if (!id) return null;
  const map = livePartialOutputs?.value;
  if (!map) return null;
  const value = map.get(id);
  return typeof value === "string" && value.length > 0 ? value : null;
});

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

// Show the live streaming preview only while no persisted result exists.
const showLivePartial = computed(() => !displayResult.value && !!livePartial.value);
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

    <!-- Live streaming stdout (visible only while no persisted result) -->
    <div v-if="showLivePartial" class="tool-result-section tool-result-section--live">
      <div class="tool-live-header">
        <span class="tool-live-dot" aria-hidden="true" />
        <span class="tool-live-label">Streaming output…</span>
      </div>
      <pre class="tool-live-output">{{ livePartial }}</pre>
    </div>

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

<style scoped>
.tool-result-section--live {
  border: 1px solid var(--border-muted);
  border-radius: 6px;
  padding: 8px 10px;
  background: var(--canvas-default, transparent);
}

.tool-live-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  font-size: 11px;
  color: var(--text-tertiary);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.tool-live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent-fg, #1f883d);
  box-shadow: 0 0 0 0 currentColor;
  animation: tool-live-dot-pulse 1.6s ease-out infinite;
}

@keyframes tool-live-dot-pulse {
  0%   { box-shadow: 0 0 0 0 rgba(31, 136, 61, 0.45); }
  70%  { box-shadow: 0 0 0 6px rgba(31, 136, 61, 0); }
  100% { box-shadow: 0 0 0 0 rgba(31, 136, 61, 0); }
}

.tool-live-output {
  margin: 0;
  padding: 6px 8px;
  max-height: 400px;
  overflow: auto;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 12px;
  line-height: 1.45;
  color: var(--text-primary);
  background: var(--canvas-inset);
  border-radius: 4px;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
