<script setup lang="ts">
import type { TurnToolCall } from "@tracepilot/types";
import { formatDuration, formatTime } from "@tracepilot/types";
import { computed } from "vue";
import { useToolDisplayResult } from "../composables/useToolDisplayResult";
import ToolArgsRenderer from "./renderers/ToolArgsRenderer.vue";
import ToolErrorDisplay from "./renderers/ToolErrorDisplay.vue";
import ToolResultRenderer from "./renderers/ToolResultRenderer.vue";

const props = defineProps<{
  tc: TurnToolCall;
  showMetadata?: boolean;
  fullResult?: string;
  loadingFullResult?: boolean;
  failedFullResult?: boolean;
  richEnabled?: boolean;
}>();
const emit = defineEmits<{
  "load-full-result": [toolCallId: string];
  "retry-full-result": [toolCallId: string];
}>();
const { displayResult, showResult, isTruncated, isStreaming } = useToolDisplayResult(props);
const isRichEnabled = computed(() => props.richEnabled !== false);
</script>

<template>
  <div class="tool-call-detail">
    <ToolErrorDisplay v-if="tc.error" :error="tc.error" />
    <dl v-if="showMetadata !== false" class="tool-call-metadata">
      <div v-if="tc.toolCallId"><dt>Call ID</dt><dd :title="tc.toolCallId">{{ tc.toolCallId }}</dd></div>
      <div v-if="tc.startedAt"><dt>Started</dt><dd>{{ formatTime(tc.startedAt) }}</dd></div>
      <div v-if="tc.completedAt"><dt>Completed</dt><dd>{{ formatTime(tc.completedAt) }}</dd></div>
      <div v-if="tc.durationMs != null"><dt>Duration</dt><dd>{{ formatDuration(tc.durationMs) }}</dd></div>
      <div v-if="tc.isComplete === false"><dt>Status</dt><dd>In progress</dd></div>
    </dl>
    <ToolArgsRenderer :key="tc.toolCallId ?? tc.toolName" :tc="tc" :rich-enabled="isRichEnabled" />
    <div v-if="showResult" class="tool-result-section" :class="{ 'tool-result-section--live': isStreaming }">
      <ToolResultRenderer
        :tc="tc"
        :content="displayResult"
        :rich-enabled="isRichEnabled"
        :is-truncated="isTruncated"
        :streaming="isStreaming"
        :loading="loadingFullResult"
        :failed="failedFullResult"
        @load-full="emit('load-full-result', $event)"
        @retry-full="emit('retry-full-result', $event)"
      />
    </div>
  </div>
</template>

<style scoped>
.tool-call-detail {
  min-width: 0; padding: 12px; display: flex; flex-direction: column; gap: 8px;
  border-top: 1px solid var(--border-subtle); background: var(--canvas-inset);
}
.tool-call-metadata { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 24px; margin: 0; font-size: 12px; }
.tool-call-metadata > div { min-width: 0; display: flex; gap: 8px; }
.tool-call-metadata dt { flex-shrink: 0; color: var(--text-tertiary); }
.tool-call-metadata dd { margin: 0; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; }
.tool-result-section { min-width: 0; }
@media (max-width: 700px) { .tool-call-metadata { grid-template-columns: minmax(0, 1fr); } }
</style>
