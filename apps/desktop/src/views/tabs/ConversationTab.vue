<script setup lang="ts">
import { ref, watch } from "vue";
import { useSessionDetailStore } from "@/stores/sessionDetail";

const store = useSessionDetailStore();
const expandedTools = ref<Set<number>>(new Set());

watch(
  () => store.sessionId,
  (id) => {
    expandedTools.value.clear();
    if (!id) {
      return;
    }

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
  if (!ms) {
    return "";
  }

  if (ms < 1000) {
    return `${ms}ms`;
  }

  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }

  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function truncateMessage(msg: string, maxLen = 500): string {
  if (msg.length <= maxLen) {
    return msg;
  }

  return `${msg.slice(0, maxLen)}…`;
}
</script>

<template>
  <div class="space-y-4">
    <div v-if="store.turns.length === 0" class="py-8 text-center text-sm text-[var(--text-muted)]">
      No conversation turns found.
    </div>

    <div
      v-for="turn in store.turns"
      :key="turn.turnIndex"
      class="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]"
    >
      <div class="flex items-center gap-3 border-b border-[var(--border)] bg-[var(--bg)] px-4 py-2">
        <span class="text-xs font-bold text-[var(--accent)]">Turn {{ turn.turnIndex }}</span>
        <span v-if="turn.model" class="text-xs text-purple-400">{{ turn.model }}</span>
        <span v-if="turn.durationMs" class="text-xs text-[var(--text-muted)]">{{ formatDuration(turn.durationMs) }}</span>
        <span v-if="turn.toolCalls.length" class="ml-auto text-xs text-[var(--text-muted)]">
          {{ turn.toolCalls.length }} tool call{{ turn.toolCalls.length !== 1 ? "s" : "" }}
        </span>
        <span
          v-if="!turn.isComplete"
          class="inline-flex items-center rounded-full bg-yellow-500/10 px-2 py-0.5 text-xs font-medium text-[var(--warning)]"
        >
          Incomplete
        </span>
      </div>

      <div class="space-y-3 p-4">
        <div v-if="turn.userMessage" class="space-y-1">
          <div class="text-xs font-semibold uppercase text-[var(--text-muted)]">User</div>
          <div class="whitespace-pre-wrap rounded-md border border-[var(--border)] bg-[var(--bg)] p-3 text-sm">
            {{ truncateMessage(turn.userMessage) }}
          </div>
        </div>

        <div v-for="(msg, idx) in turn.assistantMessages" :key="idx" class="space-y-1">
          <div class="text-xs font-semibold uppercase text-[var(--accent)]">Assistant</div>
          <div class="whitespace-pre-wrap rounded-md border border-[var(--border)] bg-[var(--bg)] p-3 text-sm">
            {{ truncateMessage(msg) }}
          </div>
        </div>

        <div v-if="turn.toolCalls.length > 0">
          <button
            class="flex items-center gap-2 text-xs text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
            @click="toggleToolCalls(turn.turnIndex)"
          >
            <span class="transition-transform" :class="expandedTools.has(turn.turnIndex) ? 'rotate-90' : ''">▸</span>
            {{ turn.toolCalls.length }} tool call{{ turn.toolCalls.length !== 1 ? "s" : "" }}
          </button>

          <div v-if="expandedTools.has(turn.turnIndex)" class="ml-4 mt-2 space-y-2">
            <div
              v-for="(tc, tcIdx) in turn.toolCalls"
              :key="tcIdx"
              class="rounded-md border p-3 text-xs"
              :class="tc.success === false
                ? 'border-red-500/30 bg-red-500/5'
                : tc.success === true
                  ? 'border-green-500/30 bg-green-500/5'
                  : 'border-[var(--border)] bg-[var(--bg)]'"
            >
              <div class="mb-1 flex items-center gap-2">
                <span class="font-semibold">{{ tc.toolName }}</span>
                <span v-if="tc.mcpServerName" class="text-[var(--text-muted)]">
                  ({{ tc.mcpServerName }}{{ tc.mcpToolName ? ` → ${tc.mcpToolName}` : "" }})
                </span>
                <span v-if="tc.durationMs" class="ml-auto text-[var(--text-muted)]">
                  {{ formatDuration(tc.durationMs) }}
                </span>
                <span v-if="tc.success === true" class="text-[var(--success)]">✓</span>
                <span v-else-if="tc.success === false" class="text-[var(--error)]">✗</span>
              </div>
              <div v-if="tc.error" class="mt-1 text-[var(--error)]">Error: {{ tc.error }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
