<script setup lang="ts">
import { ref, watch, computed } from "vue";
import { useSessionDetailStore } from "@/stores/sessionDetail";
import { Badge } from "@tracepilot/ui";

const store = useSessionDetailStore();
const expandedTools = ref<Set<number>>(new Set());
const expandedToolDetails = ref<Set<string>>(new Set());
const viewMode = ref<'chat' | 'compact' | 'timeline'>('chat');

watch(
  () => store.sessionId,
  (id) => {
    expandedTools.value.clear();
    expandedToolDetails.value.clear();
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

function toggleToolDetail(key: string) {
  if (expandedToolDetails.value.has(key)) {
    expandedToolDetails.value.delete(key);
  } else {
    expandedToolDetails.value.add(key);
  }
}

function formatDuration(ms?: number): string {
  if (ms == null) return "";
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function formatTime(ts?: string): string {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function truncateMessage(msg: string, maxLen = 1000): string {
  if (msg.length <= maxLen) return msg;
  return `${msg.slice(0, maxLen)}…`;
}

function toolIcon(toolName: string): string {
  const icons: Record<string, string> = {
    view: '👁', edit: '✏️', create: '📄', grep: '🔍', glob: '📁',
    powershell: '💻', task: '🤖', report_intent: '🎯', ask_user: '💬',
    web_search: '🌐', web_fetch: '🌐', sql: '🗄️', skill: '⚡',
  };
  return icons[toolName] || '🔧';
}

function toolCategory(toolName: string): string {
  if (['view', 'edit', 'create', 'grep', 'glob'].includes(toolName)) return 'file';
  if (['powershell', 'read_powershell', 'write_powershell', 'stop_powershell'].includes(toolName)) return 'shell';
  if (['task', 'read_agent', 'write_agent', 'list_agents'].includes(toolName)) return 'agent';
  if (toolName.startsWith('github-mcp-server')) return 'github';
  if (['web_search', 'web_fetch'].includes(toolName)) return 'web';
  if (toolName === 'sql') return 'data';
  return 'other';
}

function categoryColor(category: string): string {
  const colors: Record<string, string> = {
    file: 'text-[var(--color-accent-fg)]',
    shell: 'text-[var(--color-warning-fg)]',
    agent: 'text-[var(--color-done-fg)]',
    github: 'text-[var(--color-text-secondary)]',
    web: 'text-[var(--color-success-fg)]',
    data: 'text-[var(--color-accent-fg)]',
    other: 'text-[var(--color-text-secondary)]',
  };
  return colors[category] || colors.other;
}

function formatArgsSummary(args: unknown, toolName: string): string {
  if (!args || typeof args !== 'object') return '';
  const a = args as Record<string, unknown>;

  if (toolName === 'view' && a.path) return String(a.path);
  if (toolName === 'edit' && a.path) return String(a.path);
  if (toolName === 'create' && a.path) return String(a.path);
  if (toolName === 'grep' && a.pattern) return `/${a.pattern}/${a.path ? ` in ${a.path}` : ''}`;
  if (toolName === 'glob' && a.pattern) return String(a.pattern);
  if (toolName === 'powershell' && a.command) {
    const cmd = String(a.command);
    return cmd.length > 150 ? cmd.slice(0, 150) + '…' : cmd;
  }
  if (toolName === 'task' && a.description) return String(a.description);
  if (toolName === 'report_intent' && a.intent) return String(a.intent);
  if (toolName === 'sql' && a.description) return String(a.description);
  if (toolName === 'web_search' && a.query) return String(a.query);
  if (toolName === 'web_fetch' && a.url) return String(a.url);
  if (toolName.startsWith('github-mcp-server') && a.method) return String(a.method);
  return '';
}

// Cache formatArgsSummary results per tool call to avoid repeated computation in templates
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
  return argsSummaryCache.value.get(`${turnIndex}-${tcIdx}`) || '';
}

const totalToolCalls = computed(() => store.turns.reduce((sum, t) => sum + t.toolCalls.length, 0));
const failedToolCalls = computed(() => store.turns.reduce((sum, t) => sum + t.toolCalls.filter(tc => tc.success === false).length, 0));
</script>

<template>
  <div class="space-y-5">
    <!-- Controls bar -->
    <div class="flex items-center justify-between gap-4">
      <div class="flex items-center gap-4 text-xs text-[var(--color-text-secondary)]">
        <span>{{ store.turns.length }} turn{{ store.turns.length !== 1 ? 's' : '' }}</span>
        <span>{{ totalToolCalls }} tool call{{ totalToolCalls !== 1 ? 's' : '' }}</span>
        <span v-if="failedToolCalls > 0" class="text-[var(--color-danger-fg)]">{{ failedToolCalls }} failed</span>
      </div>
      <div role="group" aria-label="View mode" class="flex items-center rounded-md border border-[var(--color-border-default)] overflow-hidden">
        <button
          v-for="mode in (['chat', 'compact', 'timeline'] as const)"
          :key="mode"
          class="px-3 py-1.5 text-xs font-medium transition-colors capitalize"
          :class="viewMode === mode
            ? 'bg-[var(--color-accent-muted)] text-[var(--color-accent-fg)]'
            : 'bg-[var(--color-canvas-default)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-sidebar-hover)]'"
          :aria-pressed="viewMode === mode"
          @click="viewMode = mode"
        >
          {{ mode }}
        </button>
      </div>
    </div>

    <div v-if="store.turns.length === 0" class="py-16 text-center text-sm text-[var(--color-text-secondary)]">
      No conversation turns found.
    </div>

    <!-- ═══════════════ CHAT VIEW ═══════════════ -->
    <div v-else-if="viewMode === 'chat'" class="space-y-6">
      <div v-for="turn in store.turns" :key="turn.turnIndex" class="space-y-4">
        <!-- User message bubble -->
        <div v-if="turn.userMessage" class="flex gap-3 items-start">
          <div class="flex-shrink-0 h-8 w-8 rounded-full bg-[var(--color-accent-muted)] flex items-center justify-center">
            <svg class="h-4 w-4 text-[var(--color-accent-fg)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
              {{ truncateMessage(turn.userMessage) }}
            </div>
          </div>
        </div>

        <!-- Assistant message bubble -->
        <div v-for="(msg, idx) in turn.assistantMessages" :key="idx" class="flex gap-3 items-start">
          <div class="flex-shrink-0 h-8 w-8 rounded-full bg-[var(--color-done-muted)] flex items-center justify-center">
            <svg class="h-4 w-4 text-[var(--color-done-fg)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
              {{ truncateMessage(msg) }}
            </div>
          </div>
        </div>

        <!-- Tool calls section (chat view) -->
        <div v-if="turn.toolCalls.length > 0" class="ml-11">
          <button
            class="flex items-center gap-2 text-xs text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)] py-1.5 px-2 rounded-md hover:bg-[var(--color-sidebar-hover)]"
            :aria-expanded="expandedTools.has(turn.turnIndex)"
            :aria-controls="`tools-${turn.turnIndex}`"
            @click="toggleToolCalls(turn.turnIndex)"
          >
            <svg
              class="h-3 w-3 transition-transform duration-150"
              :class="expandedTools.has(turn.turnIndex) ? 'rotate-90' : ''"
              fill="currentColor" viewBox="0 0 16 16"
            >
              <path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z" />
            </svg>
            <span class="font-medium">{{ turn.toolCalls.length }} tool call{{ turn.toolCalls.length !== 1 ? 's' : '' }}</span>
            <span class="text-[var(--color-text-tertiary)]">
              ({{ turn.toolCalls.filter(tc => tc.success === true).length }} passed
              <template v-if="turn.toolCalls.some(tc => tc.success === false)">
                · {{ turn.toolCalls.filter(tc => tc.success === false).length }} failed
              </template>)
            </span>
          </button>

          <div v-if="expandedTools.has(turn.turnIndex)" :id="`tools-${turn.turnIndex}`" class="mt-2 space-y-2">
            <div
              v-for="(tc, tcIdx) in turn.toolCalls"
              :key="tcIdx"
              class="rounded-lg border overflow-hidden"
              :class="tc.success === false
                ? 'border-[var(--color-danger-fg)]/20'
                : tc.success === true
                  ? 'border-[var(--color-border-muted)]'
                  : 'border-[var(--color-border-muted)]'"
            >
              <!-- Tool call header (always visible, clickable for details) -->
              <button
                class="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--color-sidebar-hover)]"
                :class="tc.success === false ? 'bg-[var(--color-danger-muted)]' : 'bg-[var(--color-canvas-subtle)]'"
                :aria-expanded="expandedToolDetails.has(`${turn.turnIndex}-${tcIdx}`)"
                :aria-controls="`tool-detail-${turn.turnIndex}-${tcIdx}`"
                @click="toggleToolDetail(`${turn.turnIndex}-${tcIdx}`)"
              >
                <span class="text-sm flex-shrink-0">{{ toolIcon(tc.toolName) }}</span>

                <span class="font-semibold text-sm" :class="categoryColor(toolCategory(tc.toolName))">
                  {{ tc.toolName }}
                </span>

                <!-- Arguments summary -->
                <span
                  v-if="getArgsSummary(turn.turnIndex, tcIdx)"
                  class="text-xs text-[var(--color-text-tertiary)] truncate max-w-[300px] font-mono"
                  :title="getArgsSummary(turn.turnIndex, tcIdx)"
                >
                  {{ getArgsSummary(turn.turnIndex, tcIdx) }}
                </span>

                <span v-if="tc.mcpServerName" class="text-xs text-[var(--color-text-tertiary)]">
                  via {{ tc.mcpServerName }}{{ tc.mcpToolName ? ` → ${tc.mcpToolName}` : "" }}
                </span>

                <span class="ml-auto flex items-center gap-2 flex-shrink-0">
                  <span v-if="tc.durationMs" class="text-xs text-[var(--color-text-tertiary)] tabular-nums">
                    {{ formatDuration(tc.durationMs) }}
                  </span>
                  <span v-if="tc.success === true" class="h-4 w-4 rounded-full bg-[var(--color-success-muted)] flex items-center justify-center">
                    <svg class="h-2.5 w-2.5 text-[var(--color-success-fg)]" fill="currentColor" viewBox="0 0 16 16"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/></svg>
                  </span>
                  <span v-else-if="tc.success === false" class="h-4 w-4 rounded-full bg-[var(--color-danger-muted)] flex items-center justify-center">
                    <svg class="h-2.5 w-2.5 text-[var(--color-danger-fg)]" fill="currentColor" viewBox="0 0 16 16"><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/></svg>
                  </span>
                  <span v-else class="h-4 w-4 rounded-full bg-[var(--color-neutral-muted)] flex items-center justify-center">
                    <span class="text-[10px] text-[var(--color-text-tertiary)]">○</span>
                  </span>
                  <svg
                    class="h-3 w-3 text-[var(--color-text-tertiary)] transition-transform duration-150"
                    :class="expandedToolDetails.has(`${turn.turnIndex}-${tcIdx}`) ? 'rotate-90' : ''"
                    fill="currentColor" viewBox="0 0 16 16"
                  >
                    <path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z" />
                  </svg>
                </span>
              </button>

              <!-- Tool call details (expandable) -->
              <div
                v-if="expandedToolDetails.has(`${turn.turnIndex}-${tcIdx}`)"
                :id="`tool-detail-${turn.turnIndex}-${tcIdx}`"
                class="border-t border-[var(--color-border-muted)] bg-[var(--color-canvas-inset)] px-4 py-3 space-y-2"
              >
                <div v-if="tc.error" class="rounded-md bg-[var(--color-danger-muted)] border border-[var(--color-danger-fg)]/20 px-3 py-2">
                  <div class="text-[11px] font-semibold text-[var(--color-danger-fg)] mb-1">Error</div>
                  <pre class="text-xs text-[var(--color-text-primary)] whitespace-pre-wrap overflow-x-auto break-words font-mono leading-relaxed">{{ tc.error }}</pre>
                </div>
                <div class="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
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
                <div v-if="tc.arguments && Object.keys(tc.arguments as object).length > 0">
                  <div class="text-[11px] font-semibold text-[var(--color-text-tertiary)] mb-1">Arguments</div>
                  <pre class="text-xs text-[var(--color-text-secondary)] whitespace-pre-wrap overflow-x-auto break-words font-mono bg-[var(--color-canvas-default)] rounded-md border border-[var(--color-border-muted)] px-3 py-2 max-h-40 overflow-y-auto leading-relaxed">{{ JSON.stringify(tc.arguments, null, 2) }}</pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══════════════ COMPACT VIEW ═══════════════ -->
    <div v-else-if="viewMode === 'compact'" class="space-y-3">
      <div
        v-for="turn in store.turns"
        :key="turn.turnIndex"
        class="rounded-lg border border-[var(--color-border-default)] bg-[var(--color-canvas-subtle)] overflow-hidden"
      >
        <!-- Turn header -->
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
          <!-- User message (condensed) -->
          <div v-if="turn.userMessage" class="text-sm text-[var(--color-text-primary)]">
            <span class="font-semibold text-[var(--color-text-secondary)] mr-2">User:</span>
            {{ truncateMessage(turn.userMessage, 300) }}
          </div>

          <!-- Assistant messages (condensed) -->
          <div v-for="(msg, idx) in turn.assistantMessages" :key="idx" class="text-sm text-[var(--color-text-primary)]">
            <span class="font-semibold text-[var(--color-done-fg)] mr-2">Copilot:</span>
            {{ truncateMessage(msg, 300) }}
          </div>

          <!-- Tool calls (interactive pills) -->
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
              @click="toggleToolDetail(`compact-${turn.turnIndex}-${tcIdx}`)"
            >
              {{ toolIcon(tc.toolName) }} {{ tc.toolName }}
              <span v-if="tc.durationMs" class="text-[var(--color-text-tertiary)]">{{ formatDuration(tc.durationMs) }}</span>
            </button>
          </div>

          <!-- Expanded tool detail in compact view -->
          <div
            v-for="(tc, tcIdx) in turn.toolCalls"
            :key="`detail-${tcIdx}`"
          >
            <div
              v-if="expandedToolDetails.has(`compact-${turn.turnIndex}-${tcIdx}`)"
              class="rounded-md border border-[var(--color-border-muted)] bg-[var(--color-canvas-inset)] px-4 py-3 space-y-2 mt-2"
            >
              <div class="flex items-center gap-2 text-xs">
                <span>{{ toolIcon(tc.toolName) }}</span>
                <span class="font-semibold" :class="categoryColor(toolCategory(tc.toolName))">{{ tc.toolName }}</span>
                <span v-if="getArgsSummary(turn.turnIndex, tcIdx)" class="text-[var(--color-text-tertiary)] font-mono truncate">{{ getArgsSummary(turn.turnIndex, tcIdx) }}</span>
              </div>
              <div v-if="tc.error" class="rounded-md bg-[var(--color-danger-muted)] border border-[var(--color-danger-fg)]/20 px-3 py-2">
                <div class="text-[11px] font-semibold text-[var(--color-danger-fg)] mb-1">Error</div>
                <pre class="text-xs text-[var(--color-text-primary)] whitespace-pre-wrap overflow-x-auto break-words font-mono leading-relaxed">{{ tc.error }}</pre>
              </div>
              <div v-if="tc.arguments && Object.keys(tc.arguments as object).length > 0">
                <div class="text-[11px] font-semibold text-[var(--color-text-tertiary)] mb-1">Arguments</div>
                <pre class="text-xs text-[var(--color-text-secondary)] whitespace-pre-wrap overflow-x-auto break-words font-mono bg-[var(--color-canvas-default)] rounded-md border border-[var(--color-border-muted)] px-3 py-2 max-h-32 overflow-y-auto leading-relaxed">{{ JSON.stringify(tc.arguments, null, 2) }}</pre>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══════════════ TIMELINE VIEW ═══════════════ -->
    <div v-else-if="viewMode === 'timeline'" class="relative pl-8">
      <div v-for="(turn, turnIdx) in store.turns" :key="turn.turnIndex" class="relative pb-8 last:pb-0">
        <!-- Timeline line (stops before last item) -->
        <div
          v-if="turnIdx < store.turns.length - 1"
          class="absolute left-[-16.5px] top-7 bottom-0 w-px bg-[var(--color-border-default)]"
        />

        <!-- Timeline dot -->
        <div class="absolute -left-8 top-1 h-7 w-7 rounded-full border-2 border-[var(--color-border-default)] bg-[var(--color-canvas-default)] flex items-center justify-center text-xs font-bold text-[var(--color-accent-fg)]">
          {{ turn.turnIndex }}
        </div>

        <div class="space-y-3">
          <!-- Turn metadata -->
          <div class="flex items-center gap-2 flex-wrap">
            <Badge v-if="turn.model" variant="done">{{ turn.model }}</Badge>
            <span v-if="turn.durationMs" class="text-xs text-[var(--color-text-tertiary)]">{{ formatDuration(turn.durationMs) }}</span>
            <span v-if="turn.timestamp" class="text-xs text-[var(--color-text-tertiary)]">{{ formatTime(turn.timestamp) }}</span>
            <span v-if="turn.toolCalls.length" class="text-xs text-[var(--color-text-secondary)]">· {{ turn.toolCalls.length }} tools</span>
            <Badge v-if="!turn.isComplete" variant="warning">Incomplete</Badge>
          </div>

          <!-- User message -->
          <div v-if="turn.userMessage" class="rounded-lg border border-[var(--color-accent-muted)] bg-[var(--color-accent-subtle)] px-4 py-3">
            <div class="text-xs font-semibold text-[var(--color-accent-fg)] mb-1">User</div>
            <div class="text-sm text-[var(--color-text-primary)] whitespace-pre-wrap leading-relaxed">{{ truncateMessage(turn.userMessage, 500) }}</div>
          </div>

          <!-- Tool calls (timeline nodes - clickable) -->
          <div v-if="turn.toolCalls.length > 0" class="space-y-1.5">
            <div
              v-for="(tc, tcIdx) in turn.toolCalls"
              :key="tcIdx"
              class="overflow-hidden rounded-md border border-[var(--color-border-muted)]"
            >
              <button
                class="w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors hover:bg-[var(--color-sidebar-hover)]"
                :class="tc.success === false ? 'bg-[var(--color-danger-muted)]' : 'bg-[var(--color-canvas-subtle)]'"
                :aria-expanded="expandedToolDetails.has(`tl-${turn.turnIndex}-${tcIdx}`)"
                @click="toggleToolDetail(`tl-${turn.turnIndex}-${tcIdx}`)"
              >
                <span>{{ toolIcon(tc.toolName) }}</span>
                <span class="font-semibold" :class="categoryColor(toolCategory(tc.toolName))">{{ tc.toolName }}</span>
                <span v-if="getArgsSummary(turn.turnIndex, tcIdx)" class="text-[var(--color-text-tertiary)] font-mono truncate max-w-[250px]">
                  {{ getArgsSummary(turn.turnIndex, tcIdx) }}
                </span>
                <span class="ml-auto flex items-center gap-2 flex-shrink-0">
                  <span v-if="tc.durationMs" class="text-[var(--color-text-tertiary)]">{{ formatDuration(tc.durationMs) }}</span>
                  <span v-if="tc.success === true" class="text-[var(--color-success-fg)]">✓</span>
                  <span v-else-if="tc.success === false" class="text-[var(--color-danger-fg)]">✗</span>
                  <svg
                    class="h-3 w-3 text-[var(--color-text-tertiary)] transition-transform duration-150"
                    :class="expandedToolDetails.has(`tl-${turn.turnIndex}-${tcIdx}`) ? 'rotate-90' : ''"
                    fill="currentColor" viewBox="0 0 16 16"
                  >
                    <path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z" />
                  </svg>
                </span>
              </button>

              <!-- Expanded detail in timeline -->
              <div
                v-if="expandedToolDetails.has(`tl-${turn.turnIndex}-${tcIdx}`)"
                class="border-t border-[var(--color-border-muted)] bg-[var(--color-canvas-inset)] px-4 py-3 space-y-2"
              >
                <div v-if="tc.error" class="rounded-md bg-[var(--color-danger-muted)] border border-[var(--color-danger-fg)]/20 px-3 py-2">
                  <div class="text-[11px] font-semibold text-[var(--color-danger-fg)] mb-1">Error</div>
                  <pre class="text-xs text-[var(--color-text-primary)] whitespace-pre-wrap overflow-x-auto break-words font-mono leading-relaxed">{{ tc.error }}</pre>
                </div>
                <div class="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                  <div v-if="tc.toolCallId" class="flex gap-2">
                    <span class="text-[var(--color-text-tertiary)]">Call ID:</span>
                    <span class="font-mono text-[var(--color-text-secondary)] truncate">{{ tc.toolCallId }}</span>
                  </div>
                  <div v-if="tc.durationMs != null" class="flex gap-2">
                    <span class="text-[var(--color-text-tertiary)]">Duration:</span>
                    <span class="text-[var(--color-text-secondary)]">{{ formatDuration(tc.durationMs) }}</span>
                  </div>
                </div>
                <div v-if="tc.arguments && Object.keys(tc.arguments as object).length > 0">
                  <div class="text-[11px] font-semibold text-[var(--color-text-tertiary)] mb-1">Arguments</div>
                  <pre class="text-xs text-[var(--color-text-secondary)] whitespace-pre-wrap overflow-x-auto break-words font-mono bg-[var(--color-canvas-default)] rounded-md border border-[var(--color-border-muted)] px-3 py-2 max-h-32 overflow-y-auto leading-relaxed">{{ JSON.stringify(tc.arguments, null, 2) }}</pre>
                </div>
              </div>
            </div>
          </div>

          <!-- Assistant messages -->
          <div v-for="(msg, idx) in turn.assistantMessages" :key="idx" class="rounded-lg border border-[var(--color-border-muted)] bg-[var(--color-canvas-subtle)] px-4 py-3">
            <div class="text-xs font-semibold text-[var(--color-done-fg)] mb-1">Copilot</div>
            <div class="text-sm text-[var(--color-text-primary)] whitespace-pre-wrap leading-relaxed">{{ truncateMessage(msg, 500) }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
