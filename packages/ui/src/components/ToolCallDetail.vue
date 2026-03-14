<script setup lang="ts">
import type { TurnToolCall } from "@tracepilot/types";
import { formatDuration, formatTime } from "../utils/formatters";

defineProps<{
  tc: TurnToolCall;
  showMetadata?: boolean;
}>();
</script>

<template>
  <div class="border-t border-[var(--color-border-muted)] bg-[var(--color-canvas-inset)] px-4 py-3 space-y-2">
    <!-- Error display -->
    <div v-if="tc.error" class="rounded-md bg-[var(--color-danger-muted)] border border-[var(--color-danger-fg)]/20 px-3 py-2">
      <div class="text-[11px] font-semibold text-[var(--color-danger-fg)] mb-1">Error</div>
      <pre class="text-xs text-[var(--color-text-primary)] whitespace-pre-wrap overflow-x-auto break-words font-mono leading-relaxed">{{ tc.error }}</pre>
    </div>

    <!-- Metadata grid -->
    <div v-if="showMetadata !== false" class="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
      <div v-if="tc.toolCallId" class="flex gap-2">
        <span class="text-[var(--color-text-tertiary)]">Call ID:</span>
        <span class="font-mono text-[var(--color-text-secondary)] truncate">{{ tc.toolCallId }}</span>
      </div>
      <div v-if="tc.startedAt" class="flex gap-2">
        <span class="text-[var(--color-text-tertiary)]">Started:</span>
        <span class="text-[var(--color-text-secondary)]">{{ formatTime(tc.startedAt) }}</span>
      </div>
      <div v-if="tc.completedAt" class="flex gap-2">
        <span class="text-[var(--color-text-tertiary)]">Completed:</span>
        <span class="text-[var(--color-text-secondary)]">{{ formatTime(tc.completedAt) }}</span>
      </div>
      <div v-if="tc.durationMs != null" class="flex gap-2">
        <span class="text-[var(--color-text-tertiary)]">Duration:</span>
        <span class="text-[var(--color-text-secondary)]">{{ formatDuration(tc.durationMs) }}</span>
      </div>
      <div v-if="tc.isComplete === false" class="flex gap-2">
        <span class="text-[var(--color-warning-fg)] font-medium">⚠ Incomplete</span>
      </div>
    </div>

    <!-- Arguments JSON -->
    <div v-if="tc.arguments && Object.keys(tc.arguments as object).length > 0">
      <div class="text-[11px] font-semibold text-[var(--color-text-tertiary)] mb-1">Arguments</div>
      <pre class="text-xs text-[var(--color-text-secondary)] whitespace-pre-wrap overflow-x-auto break-words font-mono bg-[var(--color-canvas-default)] rounded-md border border-[var(--color-border-muted)] px-3 py-2 max-h-40 overflow-y-auto leading-relaxed">{{ JSON.stringify(tc.arguments, null, 2) }}</pre>
    </div>
  </div>
</template>
