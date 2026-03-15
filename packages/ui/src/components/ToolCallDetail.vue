<script setup lang="ts">
import type { TurnToolCall } from "@tracepilot/types";
import { formatDuration, formatTime } from "../utils/formatters";

defineProps<{
  tc: TurnToolCall;
  showMetadata?: boolean;
}>();
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

    <!-- Arguments JSON -->
    <div v-if="tc.arguments && typeof tc.arguments === 'object' && !Array.isArray(tc.arguments) && Object.keys(tc.arguments).length > 0">
      <div class="text-[11px] font-semibold mb-1" style="color: var(--text-tertiary);">Arguments</div>
      <pre class="text-xs whitespace-pre-wrap overflow-x-auto break-words font-mono rounded-md px-3 py-2 max-h-40 overflow-y-auto leading-relaxed" style="color: var(--text-secondary); background: var(--canvas-default); border: 1px solid var(--border-muted);">{{ JSON.stringify(tc.arguments, null, 2) }}</pre>
    </div>
  </div>
</template>
