<script setup lang="ts">
import { computed } from "vue";
import { useSessionDetailStore } from "@/stores/sessionDetail";
import {
  Badge, EmptyState, ExpandChevron, ToolCallItem, ToolCallDetail,
  formatDuration, formatTime, truncateText,
  toolIcon, toolCategory, categoryColor, formatArgsSummary,
  useSessionTabLoader, useToggleSet,
} from "@tracepilot/ui";

const store = useSessionDetailStore();
const expandedTools = useToggleSet<number>();
const expandedToolDetails = useToggleSet<string>();
import { ref } from "vue";
const activeView = ref<"chat" | "compact" | "timeline">("chat");

useSessionTabLoader(
  () => store.sessionId,
  () => store.loadTurns(),
  {
    onClear() {
      expandedTools.clear();
      expandedToolDetails.clear();
    },
  }
);

// Cache formatArgsSummary per tool call
const argsSummaryCache = computed(() => {
  const cache = new Map<string, string>();
  for (const turn of store.turns) {
    for (let i = 0; i < turn.toolCalls.length; i++) {
      const tc = turn.toolCalls[i];
      cache.set(`${turn.turnIndex}-${i}`, formatArgsSummary(tc.arguments, tc.toolName));
    }
  }
  return cache;
});

function getArgsSummary(turnIndex: number, tcIdx: number): string {
  return argsSummaryCache.value.get(`${turnIndex}-${tcIdx}`) || "";
}

const totalToolCalls = computed(() =>
  store.turns.reduce((sum, t) => sum + t.toolCalls.length, 0)
);
const failedToolCalls = computed(() =>
  store.turns.reduce((sum, t) => sum + t.toolCalls.filter((tc) => tc.success === false).length, 0)
);
</script>

<template>
  <div class="space-y-5">
    <!-- Controls bar -->
    <div class="flex items-center justify-between gap-4">
      <div class="flex items-center gap-4 text-xs text-[var(--color-text-secondary)]">
        <span>{{ store.turns.length }} turn{{ store.turns.length !== 1 ? "s" : "" }}</span>
        <span>{{ totalToolCalls }} tool call{{ totalToolCalls !== 1 ? "s" : "" }}</span>
        <span v-if="failedToolCalls > 0" class="text-[var(--color-danger-fg)]">{{ failedToolCalls }} failed</span>
      </div>
      <div role="group" aria-label="View mode" class="flex items-center rounded-md border border-[var(--color-border-default)] overflow-hidden">
        <button
          v-for="mode in (['chat', 'compact', 'timeline'] as const)"
          :key="mode"
          class="px-3 py-1.5 text-xs font-medium transition-colors capitalize"
          :class="activeView === mode
            ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent-fg)]'
            : 'bg-[var(--color-canvas-default)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-sidebar-hover)]'"
          :aria-pressed="activeView === mode"
          @click="activeView = mode"
        >
          {{ mode }}
        </button>
      </div>
    </div>

    <EmptyState v-if="store.turns.length === 0" message="No conversation turns found." />

    <!-- ═══════════════ CHAT VIEW ═══════════════ -->
    <div v-else-if="activeView === 'chat'" class="space-y-6">
      <div v-for="turn in store.turns" :key="turn.turnIndex" class="space-y-4">
        <!-- User message bubble -->
        <div v-if="turn.userMessage" class="flex gap-3 items-start">
          <div class="flex-shrink-0 h-8 w-8 rounded-full bg-[var(--color-accent-muted)] flex items-center justify-center">
            <svg class="h-4 w-4 text-[var(--color-accent-fg)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <div class="flex-1 min-w-0 space-y-1">
            <div class="flex items-center gap-2">
              <span class="text-sm font-semibold text-[var(--color-text-primary)]">You</span>
              <span class="text-xs text-[var(--color-text-tertiary)]">Turn {{ turn.turnIndex }}</span>
              <span v-if="turn.timestamp" class="text-xs text-[var(--color-text-tertiary)]">{{ formatTime(turn.timestamp) }}</span>
            </div>
            <div class="whitespace-pre-wrap rounded-lg rounded-tl-sm bg-[var(--color-accent-subtle)] border border-[var(--color-accent-muted)] px-4 py-3 text-sm text-[var(--color-text-primary)] leading-relaxed">
              {{ truncateText(turn.userMessage) }}
            </div>
          </div>
        </div>

        <!-- Assistant message bubble -->
        <div v-for="(msg, idx) in turn.assistantMessages" :key="idx" class="flex gap-3 items-start">
          <div class="flex-shrink-0 h-8 w-8 rounded-full bg-[var(--color-done-muted)] flex items-center justify-center">
            <svg class="h-4 w-4 text-[var(--color-done-fg)]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <div class="flex-1 min-w-0 space-y-1">
            <div class="flex items-center gap-2">
              <span class="text-sm font-semibold text-[var(--color-done-fg)]">Copilot</span>
              <Badge v-if="turn.model" variant="done">{{ turn.model }}</Badge>
              <span v-if="turn.durationMs" class="text-xs text-[var(--color-text-tertiary)]">{{ formatDuration(turn.durationMs) }}</span>
              <Badge v-if="!turn.isComplete" variant="warning">Incomplete</Badge>
            </div>
            <div class="whitespace-pre-wrap rounded-lg rounded-tl-sm bg-[var(--color-canvas-subtle)] border border-[var(--color-border-muted)] px-4 py-3 text-sm text-[var(--color-text-primary)] leading-relaxed">
              {{ truncateText(msg) }}
            </div>
          </div>
        </div>

        <!-- Tool calls section (chat view) — uses shared ToolCallItem -->
        <div v-if="turn.toolCalls.length > 0" class="ml-11">
          <button
            class="flex items-center gap-2 text-xs text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)] py-1.5 px-2 rounded-md hover:bg-[var(--color-sidebar-hover)]"
            :aria-expanded="expandedTools.has(turn.turnIndex)"
            @click="expandedTools.toggle(turn.turnIndex)"
          >
            <ExpandChevron :expanded="expandedTools.has(turn.turnIndex)" />
            <span class="font-medium">{{ turn.toolCalls.length }} tool call{{ turn.toolCalls.length !== 1 ? "s" : "" }}</span>
            <span class="text-[var(--color-text-tertiary)]">
              ({{ turn.toolCalls.filter((tc) => tc.success === true).length }} passed
              <template v-if="turn.toolCalls.some((tc) => tc.success === false)">
                · {{ turn.toolCalls.filter((tc) => tc.success === false).length }} failed
              </template>)
            </span>
          </button>

          <div v-if="expandedTools.has(turn.turnIndex)" class="mt-2 space-y-2">
            <ToolCallItem
              v-for="(tc, tcIdx) in turn.toolCalls"
              :key="tcIdx"
              :tc="tc"
              :args-summary="getArgsSummary(turn.turnIndex, tcIdx)"
              :expanded="expandedToolDetails.has(`${turn.turnIndex}-${tcIdx}`)"
              @toggle="expandedToolDetails.toggle(`${turn.turnIndex}-${tcIdx}`)"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- ═══════════════ COMPACT VIEW ═══════════════ -->
    <div v-else-if="activeView === 'compact'" class="space-y-3">
      <div
        v-for="turn in store.turns"
        :key="turn.turnIndex"
        class="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-canvas-subtle)] overflow-hidden"
      >
        <div class="flex items-center gap-3 px-5 py-3 border-b border-[var(--color-border-muted)] bg-[var(--color-canvas-default)]">
          <span class="text-xs font-bold text-[var(--color-accent-fg)]">Turn {{ turn.turnIndex }}</span>
          <Badge v-if="turn.model" variant="done">{{ turn.model }}</Badge>
          <span v-if="turn.durationMs" class="text-xs text-[var(--color-text-tertiary)]">{{ formatDuration(turn.durationMs) }}</span>
          <span v-if="turn.toolCalls.length" class="ml-auto text-xs text-[var(--color-text-secondary)]">
            {{ turn.toolCalls.length }} tool{{ turn.toolCalls.length !== 1 ? "s" : "" }}
          </span>
          <Badge v-if="!turn.isComplete" variant="warning">Incomplete</Badge>
        </div>

        <div class="p-5 space-y-3">
          <div v-if="turn.userMessage" class="text-sm text-[var(--color-text-primary)]">
            <span class="font-semibold text-[var(--color-text-secondary)] mr-2">User:</span>
            {{ truncateText(turn.userMessage, 300) }}
          </div>
          <div v-for="(msg, idx) in turn.assistantMessages" :key="idx" class="text-sm text-[var(--color-text-primary)]">
            <span class="font-semibold text-[var(--color-done-fg)] mr-2">Copilot:</span>
            {{ truncateText(msg, 300) }}
          </div>

          <!-- Tool pills -->
          <div v-if="turn.toolCalls.length > 0" class="flex flex-wrap gap-1.5">
            <button
              v-for="(tc, tcIdx) in turn.toolCalls"
              :key="tcIdx"
              class="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-mono cursor-pointer transition-colors hover:ring-1 hover:ring-[var(--color-border-default)]"
              :class="tc.success === false
                ? 'bg-[var(--color-danger-muted)] text-[var(--color-danger-fg)]'
                : tc.success === true
                  ? 'bg-[var(--color-canvas-default)] border border-[var(--color-border-muted)] text-[var(--color-text-secondary)]'
                  : 'bg-[var(--color-neutral-muted)] text-[var(--color-text-tertiary)]'"
              :aria-expanded="expandedToolDetails.has(`compact-${turn.turnIndex}-${tcIdx}`)"
              @click="expandedToolDetails.toggle(`compact-${turn.turnIndex}-${tcIdx}`)"
            >
              {{ toolIcon(tc.toolName) }} {{ tc.toolName }}
              <span v-if="tc.durationMs" class="text-[var(--color-text-tertiary)]">{{ formatDuration(tc.durationMs) }}</span>
            </button>
          </div>

          <!-- Expanded tool detail (compact view) — uses shared ToolCallDetail -->
          <template v-for="(tc, tcIdx) in turn.toolCalls" :key="`detail-${tcIdx}`">
            <div v-if="expandedToolDetails.has(`compact-${turn.turnIndex}-${tcIdx}`)" class="rounded-md border border-[var(--color-border-muted)] overflow-hidden mt-2">
              <div class="flex items-center gap-2 text-xs px-4 py-2 bg-[var(--color-canvas-subtle)]">
                <span>{{ toolIcon(tc.toolName) }}</span>
                <span class="font-semibold" :class="categoryColor(toolCategory(tc.toolName))">{{ tc.toolName }}</span>
                <span v-if="getArgsSummary(turn.turnIndex, tcIdx)" class="text-[var(--color-text-tertiary)] font-mono truncate">{{ getArgsSummary(turn.turnIndex, tcIdx) }}</span>
              </div>
              <ToolCallDetail :tc="tc" :show-metadata="false" />
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- ═══════════════ TIMELINE VIEW ═══════════════ -->
    <div v-else-if="activeView === 'timeline'" class="relative pl-8">
      <div v-for="(turn, turnIdx) in store.turns" :key="turn.turnIndex" class="relative pb-8 last:pb-0">
        <div
          v-if="turnIdx < store.turns.length - 1"
          class="absolute left-[-16.5px] top-7 bottom-0 w-px bg-[var(--color-border-default)]"
        />
        <div class="absolute -left-8 top-1 h-7 w-7 rounded-full border-2 border-[var(--color-border-default)] bg-[var(--color-canvas-default)] flex items-center justify-center text-xs font-bold text-[var(--color-accent-fg)]">
          {{ turn.turnIndex }}
        </div>

        <div class="space-y-3">
          <div class="flex items-center gap-2 flex-wrap">
            <Badge v-if="turn.model" variant="done">{{ turn.model }}</Badge>
            <span v-if="turn.durationMs" class="text-xs text-[var(--color-text-tertiary)]">{{ formatDuration(turn.durationMs) }}</span>
            <span v-if="turn.timestamp" class="text-xs text-[var(--color-text-tertiary)]">{{ formatTime(turn.timestamp) }}</span>
            <span v-if="turn.toolCalls.length" class="text-xs text-[var(--color-text-secondary)]">· {{ turn.toolCalls.length }} tools</span>
            <Badge v-if="!turn.isComplete" variant="warning">Incomplete</Badge>
          </div>

          <div v-if="turn.userMessage" class="rounded-lg border border-[var(--color-accent-muted)] bg-[var(--color-accent-subtle)] px-4 py-3">
            <div class="text-xs font-semibold text-[var(--color-accent-fg)] mb-1">User</div>
            <div class="text-sm text-[var(--color-text-primary)] whitespace-pre-wrap leading-relaxed">{{ truncateText(turn.userMessage, 500) }}</div>
          </div>

          <!-- Tool calls — uses shared ToolCallItem (compact variant) -->
          <div v-if="turn.toolCalls.length > 0" class="space-y-1.5">
            <ToolCallItem
              v-for="(tc, tcIdx) in turn.toolCalls"
              :key="tcIdx"
              :tc="tc"
              variant="compact"
              :args-summary="getArgsSummary(turn.turnIndex, tcIdx)"
              :expanded="expandedToolDetails.has(`tl-${turn.turnIndex}-${tcIdx}`)"
              @toggle="expandedToolDetails.toggle(`tl-${turn.turnIndex}-${tcIdx}`)"
            />
          </div>

          <div v-for="(msg, idx) in turn.assistantMessages" :key="idx" class="rounded-lg border border-[var(--color-border-muted)] bg-[var(--color-canvas-subtle)] px-4 py-3">
            <div class="text-xs font-semibold text-[var(--color-done-fg)] mb-1">Copilot</div>
            <div class="text-sm text-[var(--color-text-primary)] whitespace-pre-wrap leading-relaxed">{{ truncateText(msg, 500) }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
