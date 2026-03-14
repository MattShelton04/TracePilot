<script setup lang="ts">
import { ref, watch } from "vue";
import { useSessionDetailStore } from "@/stores/sessionDetail";
import { Badge } from "@tracepilot/ui";

const store = useSessionDetailStore();
const expandedTools = ref<Set<number>>(new Set());

watch(
  () => store.sessionId,
  (id) => {
    expandedTools.value.clear();
    if (!id) return;
    void store.loadTurns();
  },
  { immediate: true }
);

function toggleToolCalls(turnIndex: number) {
  if (expandedTools.value.has(turnIndex)) {
    expandedTools.value.delete(turnIndex);
  } else {
    expandedTools.value.add(turnIndex);
  }
}

function formatDuration(ms?: number): string {
  if (ms == null) return "";
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function truncateMessage(msg: string, maxLen = 500): string {
  if (msg.length <= maxLen) return msg;
  return `${msg.slice(0, maxLen)}…`;
}
</script>

<template>
  <div class="space-y-4">
    <div v-if="store.turns.length === 0" class="py-12 text-center text-sm text-[var(--color-text-secondary)]">
      No conversation turns found.
    </div>

    <div
      v-for="turn in store.turns"
      :key="turn.turnIndex"
      class="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-canvas-subtle)] overflow-hidden"
    >
      <!-- Turn header -->
      <div class="flex items-center gap-3 px-4 py-2 border-b border-[var(--color-border-muted)] bg-[var(--color-canvas-default)]">
        <span class="text-xs font-bold text-[var(--color-accent-fg)]">Turn {{ turn.turnIndex }}</span>
        <Badge v-if="turn.model" variant="done">{{ turn.model }}</Badge>
        <span v-if="turn.durationMs" class="text-xs text-[var(--color-text-tertiary)]">{{ formatDuration(turn.durationMs) }}</span>
        <span v-if="turn.toolCalls.length" class="ml-auto text-xs text-[var(--color-text-secondary)]">
          {{ turn.toolCalls.length }} tool call{{ turn.toolCalls.length !== 1 ? "s" : "" }}
        </span>
        <Badge v-if="!turn.isComplete" variant="warning">Incomplete</Badge>
      </div>

      <div class="p-4 space-y-3">
        <!-- User message -->
        <div v-if="turn.userMessage" class="space-y-1.5">
          <div class="flex items-center gap-2">
            <svg class="h-4 w-4 text-[var(--color-text-secondary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <span class="text-xs font-semibold text-[var(--color-text-secondary)]">User</span>
          </div>
          <div class="ml-6 whitespace-pre-wrap rounded-md border border-[var(--color-border-muted)] bg-[var(--color-canvas-default)] p-3 text-sm text-[var(--color-text-primary)]">
            {{ truncateMessage(turn.userMessage) }}
          </div>
        </div>

        <!-- Assistant messages -->
        <div v-for="(msg, idx) in turn.assistantMessages" :key="idx" class="space-y-1.5">
          <div class="flex items-center gap-2">
            <svg class="h-4 w-4 text-[var(--color-done-fg)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <span class="text-xs font-semibold text-[var(--color-done-fg)]">Assistant</span>
          </div>
          <div class="ml-6 whitespace-pre-wrap rounded-md border border-[var(--color-border-muted)] bg-[var(--color-canvas-inset)] p-3 text-sm text-[var(--color-text-primary)]">
            {{ truncateMessage(msg) }}
          </div>
        </div>

        <!-- Tool calls -->
        <div v-if="turn.toolCalls.length > 0" class="ml-6">
          <button
            class="flex items-center gap-2 text-xs text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)] py-1"
            @click="toggleToolCalls(turn.turnIndex)"
          >
            <svg
              class="h-3 w-3 transition-transform duration-150"
              :class="expandedTools.has(turn.turnIndex) ? 'rotate-90' : ''"
              fill="currentColor" viewBox="0 0 16 16"
            >
              <path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z" />
            </svg>
            {{ turn.toolCalls.length }} tool call{{ turn.toolCalls.length !== 1 ? "s" : "" }}
            <span class="text-[var(--color-text-tertiary)]">
              ({{ turn.toolCalls.filter(tc => tc.success === true).length }} ✓
              <template v-if="turn.toolCalls.some(tc => tc.success === false)">
                , {{ turn.toolCalls.filter(tc => tc.success === false).length }} ✗
              </template>)
            </span>
          </button>

          <div v-if="expandedTools.has(turn.turnIndex)" class="mt-2 space-y-1.5">
            <div
              v-for="(tc, tcIdx) in turn.toolCalls"
              :key="tcIdx"
              class="flex items-center gap-3 rounded-md border p-2.5 text-xs"
              :class="tc.success === false
                ? 'border-[var(--color-danger-fg)]/20 bg-[var(--color-danger-muted)]'
                : tc.success === true
                  ? 'border-[var(--color-success-fg)]/20 bg-[var(--color-success-muted)]'
                  : 'border-[var(--color-border-muted)] bg-[var(--color-canvas-default)]'"
            >
              <span v-if="tc.success === true" class="text-[var(--color-success-fg)]">✓</span>
              <span v-else-if="tc.success === false" class="text-[var(--color-danger-fg)]">✗</span>
              <span v-else class="text-[var(--color-text-tertiary)]">○</span>

              <span class="font-semibold text-[var(--color-text-primary)]">{{ tc.toolName }}</span>

              <span v-if="tc.mcpServerName" class="text-[var(--color-text-tertiary)]">
                {{ tc.mcpServerName }}{{ tc.mcpToolName ? ` → ${tc.mcpToolName}` : "" }}
              </span>

              <span v-if="tc.durationMs" class="ml-auto text-[var(--color-text-tertiary)]">
                {{ formatDuration(tc.durationMs) }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
