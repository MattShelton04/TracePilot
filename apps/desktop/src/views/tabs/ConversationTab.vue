<script setup lang="ts">
import { computed, ref } from "vue";
import { useSessionDetailStore } from "@/stores/sessionDetail";
import {
  StatCard, Badge, BtnGroup, EmptyState,
  ExpandChevron, ToolCallItem, ToolCallDetail,
  formatDuration, formatTime, truncateText,
  toolIcon, toolCategory, categoryColor, formatArgsSummary,
  useSessionTabLoader, useToggleSet,
} from "@tracepilot/ui";

const store = useSessionDetailStore();
const expandedTools = useToggleSet<number>();
const expandedToolDetails = useToggleSet<string>();
const activeView = ref("chat");

const viewModes = [
  { value: "chat", label: "Chat" },
  { value: "compact", label: "Compact" },
  { value: "timeline", label: "Timeline" },
];

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
const totalDurationMs = computed(() =>
  store.turns.reduce((sum, t) => sum + (t.durationMs ?? 0), 0)
);
</script>

<template>
  <div>
    <!-- Mini stat row -->
    <div class="grid-3 mb-4" style="max-width: 480px;">
      <StatCard :value="store.turns.length" label="Turns" color="accent" mini />
      <StatCard :value="totalToolCalls" label="Tool Calls" color="accent" mini />
      <StatCard :value="formatDuration(totalDurationMs)" label="Total Time" color="done" mini />
    </div>

    <!-- View mode toggle -->
    <div class="flex items-center justify-between mb-4">
      <BtnGroup v-model="activeView" :options="viewModes" />
    </div>

    <EmptyState v-if="store.turns.length === 0" message="No conversation turns found." />

    <!-- ═══════════════ CHAT VIEW ═══════════════ -->
    <div v-else-if="activeView === 'chat'" class="space-y-4">
      <div v-for="turn in store.turns" :key="turn.turnIndex" class="space-y-4">
        <!-- User message bubble -->
        <div v-if="turn.userMessage" class="flex gap-3 items-start">
          <div style="width: 28px; height: 28px; border-radius: 4px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 14px;" class="bg-[var(--accent-muted)]">👤</div>
          <div class="flex-1 min-w-0 space-y-1">
            <div class="flex items-center gap-2">
              <span class="font-semibold text-[var(--text-primary)]" style="font-size: 0.8125rem;">You</span>
              <span class="text-xs text-[var(--text-placeholder)]">Turn {{ turn.turnIndex }}</span>
              <span v-if="turn.timestamp" class="text-xs text-[var(--text-placeholder)]">{{ formatTime(turn.timestamp) }}</span>
            </div>
            <div class="whitespace-pre-wrap rounded-lg border-l-[3px] border-l-[var(--accent-emphasis)] bg-[var(--accent-subtle)] border border-[var(--accent-muted)] text-[var(--text-primary)]" style="padding: 10px 14px; padding-left: 12px; font-size: 0.8125rem; line-height: 1.6;">
              {{ truncateText(turn.userMessage) }}
            </div>
          </div>
        </div>

        <!-- Assistant message bubble -->
        <div v-for="(msg, idx) in turn.assistantMessages" :key="idx" class="flex gap-3 items-start">
          <div style="width: 28px; height: 28px; border-radius: 4px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 14px;" class="bg-[var(--done-muted)]">🤖</div>
          <div class="flex-1 min-w-0 space-y-1">
            <div class="flex items-center gap-2">
              <span class="font-semibold text-[var(--text-primary)]" style="font-size: 0.8125rem;">Assistant</span>
              <Badge v-if="turn.model" variant="done" style="font-size: 0.625rem; padding: 1px 6px;">{{ turn.model }}</Badge>
              <span v-if="turn.durationMs" class="text-xs text-[var(--text-placeholder)]">{{ formatDuration(turn.durationMs) }}</span>
              <Badge v-if="!turn.isComplete" variant="warning">Incomplete</Badge>
            </div>
            <div class="whitespace-pre-wrap rounded-lg bg-[var(--canvas-raised)] border border-[var(--border-default)] text-[var(--text-primary)]" style="padding: 10px 14px; font-size: 0.8125rem; line-height: 1.6;">
              {{ truncateText(msg) }}
            </div>
          </div>
        </div>

        <!-- Tool calls section (chat view) -->
        <div v-if="turn.toolCalls.length > 0" class="ml-11" style="border: 1px solid var(--border-default); border-radius: 8px; overflow: hidden;">
          <button
            class="flex items-center gap-2 text-xs text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] py-1.5 px-2 w-full hover:bg-[var(--neutral-subtle)]"
            :aria-expanded="expandedTools.has(turn.turnIndex)"
            @click="expandedTools.toggle(turn.turnIndex)"
          >
            <ExpandChevron :expanded="expandedTools.has(turn.turnIndex)" />
            <span class="font-medium">{{ turn.toolCalls.length }} tool call{{ turn.toolCalls.length !== 1 ? "s" : "" }}</span>
            <span class="ml-auto flex items-center gap-1.5">
              <span class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.6875rem] font-medium bg-[var(--success-muted)] text-[var(--success-fg)]">
                {{ turn.toolCalls.filter((tc) => tc.success === true).length }} passed
              </span>
              <span
                v-if="turn.toolCalls.some((tc) => tc.success === false)"
                class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.6875rem] font-medium bg-[var(--danger-muted)] text-[var(--danger-fg)]"
              >
                {{ turn.toolCalls.filter((tc) => tc.success === false).length }} failed
              </span>
            </span>
          </button>

          <div v-if="expandedTools.has(turn.turnIndex)" class="mt-0 space-y-0">
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
        class="rounded-lg border border-[var(--border-default)] bg-[var(--canvas-subtle)] overflow-hidden"
      >
        <div class="flex items-center gap-3 px-5 py-3 border-b border-[var(--border-muted)] bg-[var(--canvas-default)]">
          <span class="text-xs font-bold text-[var(--accent-fg)]">Turn {{ turn.turnIndex }}</span>
          <Badge v-if="turn.model" variant="done">{{ turn.model }}</Badge>
          <span v-if="turn.durationMs" class="text-xs text-[var(--text-tertiary)]">{{ formatDuration(turn.durationMs) }}</span>
          <span v-if="turn.toolCalls.length" class="ml-auto text-xs text-[var(--text-secondary)]">
            {{ turn.toolCalls.length }} tool{{ turn.toolCalls.length !== 1 ? "s" : "" }}
          </span>
          <Badge v-if="!turn.isComplete" variant="warning">Incomplete</Badge>
        </div>

        <div class="p-5 space-y-3">
          <div v-if="turn.userMessage" class="text-sm text-[var(--text-primary)]">
            <span class="font-semibold text-[var(--text-secondary)] mr-2">User:</span>
            {{ truncateText(turn.userMessage, 300) }}
          </div>
          <div v-for="(msg, idx) in turn.assistantMessages" :key="idx" class="text-sm text-[var(--text-primary)]">
            <span class="font-semibold text-[var(--done-fg)] mr-2">Copilot:</span>
            {{ truncateText(msg, 300) }}
          </div>

          <!-- Tool pills -->
          <div v-if="turn.toolCalls.length > 0" class="flex flex-wrap gap-1.5">
            <button
              v-for="(tc, tcIdx) in turn.toolCalls"
              :key="tcIdx"
              class="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-mono cursor-pointer transition-colors hover:ring-1 hover:ring-[var(--border-default)]"
              :class="tc.success === false
                ? 'bg-[var(--danger-muted)] text-[var(--danger-fg)]'
                : tc.success === true
                  ? 'bg-[var(--canvas-default)] border border-[var(--border-muted)] text-[var(--text-secondary)]'
                  : 'bg-[var(--neutral-muted)] text-[var(--text-tertiary)]'"
              :aria-expanded="expandedToolDetails.has(`compact-${turn.turnIndex}-${tcIdx}`)"
              @click="expandedToolDetails.toggle(`compact-${turn.turnIndex}-${tcIdx}`)"
            >
              {{ toolIcon(tc.toolName) }} {{ tc.toolName }}
              <span v-if="tc.durationMs" class="text-[var(--text-tertiary)]">{{ formatDuration(tc.durationMs) }}</span>
            </button>
          </div>

          <!-- Expanded tool detail (compact view) -->
          <template v-for="(tc, tcIdx) in turn.toolCalls" :key="`detail-${tcIdx}`">
            <div v-if="expandedToolDetails.has(`compact-${turn.turnIndex}-${tcIdx}`)" class="rounded-md border border-[var(--border-muted)] overflow-hidden mt-2">
              <div class="flex items-center gap-2 text-xs px-4 py-2 bg-[var(--canvas-subtle)]">
                <span>{{ toolIcon(tc.toolName) }}</span>
                <span class="font-semibold" :class="categoryColor(toolCategory(tc.toolName))">{{ tc.toolName }}</span>
                <span v-if="getArgsSummary(turn.turnIndex, tcIdx)" class="text-[var(--text-tertiary)] font-mono truncate">{{ getArgsSummary(turn.turnIndex, tcIdx) }}</span>
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
          class="absolute left-[-16.5px] top-7 bottom-0 w-px bg-[var(--border-default)]"
        />
        <div class="absolute -left-8 top-1 h-7 w-7 rounded-full border-2 border-[var(--border-default)] bg-[var(--canvas-default)] flex items-center justify-center text-xs font-bold text-[var(--accent-fg)]">
          {{ turn.turnIndex }}
        </div>

        <div class="space-y-3">
          <div class="flex items-center gap-2 flex-wrap">
            <Badge v-if="turn.model" variant="done">{{ turn.model }}</Badge>
            <span v-if="turn.durationMs" class="text-xs text-[var(--text-tertiary)]">{{ formatDuration(turn.durationMs) }}</span>
            <span v-if="turn.timestamp" class="text-xs text-[var(--text-tertiary)]">{{ formatTime(turn.timestamp) }}</span>
            <span v-if="turn.toolCalls.length" class="text-xs text-[var(--text-secondary)]">· {{ turn.toolCalls.length }} tools</span>
            <Badge v-if="!turn.isComplete" variant="warning">Incomplete</Badge>
          </div>

          <div v-if="turn.userMessage" class="rounded-lg border border-[var(--accent-muted)] bg-[var(--accent-subtle)] px-4 py-3">
            <div class="text-xs font-semibold text-[var(--accent-fg)] mb-1">User</div>
            <div class="text-sm text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed">{{ truncateText(turn.userMessage, 500) }}</div>
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

          <div v-for="(msg, idx) in turn.assistantMessages" :key="idx" class="rounded-lg border border-[var(--border-muted)] bg-[var(--canvas-subtle)] px-4 py-3">
            <div class="text-xs font-semibold text-[var(--done-fg)] mb-1">Copilot</div>
            <div class="text-sm text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed">{{ truncateText(msg, 500) }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
