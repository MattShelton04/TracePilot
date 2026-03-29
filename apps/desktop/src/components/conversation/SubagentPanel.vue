<script setup lang="ts">
import { ref, computed, watch, nextTick } from "vue";
import type { TurnToolCall } from "@tracepilot/types";
import type { SubagentFullData } from "@/composables/useCrossTurnSubagents";
import { usePreferencesStore } from "@/stores/preferences";
import {
  formatDuration,
  toolIcon,
  truncateText,
  formatArgsSummary,
  inferAgentTypeFromToolCall,
  getAgentColor,
  getAgentIcon,
  agentStatusFromToolCall,
  MarkdownContent,
  ToolCallItem,
  useToggleSet,
} from "@tracepilot/ui";
import { useToolResultLoader } from "@/composables/useToolResultLoader";
import { useSessionDetailStore } from "@/stores/sessionDetail";

const preferences = usePreferencesStore();
const renderMd = computed(() => preferences.isFeatureEnabled("renderMarkdown"));

const store = useSessionDetailStore();
const expandedToolDetails = useToggleSet<string>();
const { fullResults, loadingResults, failedResults, loadFullResult: handleLoadFullResult, retryFullResult: handleRetryResult } = useToolResultLoader(
  () => store.sessionId
);

const props = defineProps<{
  subagent: SubagentFullData | null;
  isOpen: boolean;
  currentIndex: number;
  totalCount: number;
  hasPrev: boolean;
  hasNext: boolean;
  topOffset: number;
}>();

const emit = defineEmits<{
  close: [];
  prev: [];
  next: [];
}>();

const scrollContainer = ref<HTMLElement | null>(null);
const promptExpanded = ref(true);
const resultExpanded = ref(false);
const expandedReasoning = ref<Set<number>>(new Set());

// ── Derived agent metadata ───────────────────────────────────────

const agentType = computed(() =>
  props.subagent ? inferAgentTypeFromToolCall(props.subagent.toolCall) : "task",
);

const agentColor = computed(() => getAgentColor(agentType.value));
const agentIcon = computed(() => getAgentIcon(agentType.value));

const agentLabel = computed(() => {
  if (!props.subagent) return "Subagent";
  return (
    props.subagent.toolCall.agentDisplayName ||
    props.subagent.toolCall.toolName ||
    "Subagent"
  );
});

const status = computed(() =>
  props.subagent ? agentStatusFromToolCall(props.subagent.toolCall) : "completed",
);

const statusText = computed(() => {
  if (status.value === "completed") return "Completed";
  if (status.value === "failed") return "Failed";
  return "Running";
});

const model = computed(() => {
  if (!props.subagent) return "";
  const args = props.subagent.toolCall.arguments as Record<string, unknown> | undefined;
  return (args?.model as string) || props.subagent.toolCall.model || "";
});

const description = computed(() => {
  if (!props.subagent) return "";
  const tc = props.subagent.toolCall;
  const args = tc.arguments as Record<string, unknown> | undefined;
  return (
    tc.intentionSummary ||
    (args?.description as string) ||
    (args?.name as string) ||
    ""
  );
});

const prompt = computed(() => {
  if (!props.subagent) return "";
  const args = props.subagent.toolCall.arguments as Record<string, unknown> | undefined;
  return (args?.prompt as string) || "";
});

const isPromptLong = computed(() => prompt.value.length > 300);

const resultContent = computed(() => {
  if (!props.subagent) return "";
  return props.subagent.toolCall.resultContent || "";
});

const isResultLong = computed(() => resultContent.value.length > 400);

// ── Activity stream ──────────────────────────────────────────────

type ActivityItem =
  | { kind: "reasoning"; index: number; sortKey: number; content: string; agentName?: string }
  | { kind: "tool"; index: number; sortKey: number; toolCall: TurnToolCall }
  | { kind: "pill"; index: number; sortKey: number; type: "intent" | "memory" | "read_agent"; label: string; toolCall: TurnToolCall }
  | { kind: "message"; index: number; sortKey: number; content: string; agentName?: string }
  | { kind: "nested-subagent"; index: number; sortKey: number; toolCall: TurnToolCall };

const PILL_TOOLS = new Set(["report_intent", "store_memory", "read_agent"]);

const activities = computed<ActivityItem[]>(() => {
  if (!props.subagent) return [];
  const items: ActivityItem[] = [];
  let idx = 0;

  // Reasoning items use a sortKey based on insertion order (no eventIndex available)
  // but placed before tools to approximate chronological order
  for (const r of props.subagent.childReasoning) {
    items.push({
      kind: "reasoning",
      index: idx++,
      sortKey: -1000 + idx, // reasoning comes first within a turn
      content: r.content,
      agentName: r.agentDisplayName,
    });
  }

  for (const tc of props.subagent.childTools) {
    const sortKey = tc.eventIndex ?? idx;
    if (tc.isSubagent) {
      items.push({ kind: "nested-subagent", index: idx++, sortKey, toolCall: tc });
    } else if (PILL_TOOLS.has(tc.toolName)) {
      const pillType = tc.toolName === "report_intent"
        ? "intent" as const
        : tc.toolName === "store_memory"
          ? "memory" as const
          : "read_agent" as const;
      const label = tc.toolName === "report_intent"
        ? formatArgsSummary(tc.arguments, tc.toolName) || "Intent update"
        : tc.toolName === "store_memory"
          ? formatArgsSummary(tc.arguments, tc.toolName) || "Stored memory"
          : formatArgsSummary(tc.arguments, tc.toolName) || "Read agent";
      items.push({ kind: "pill", index: idx++, sortKey, type: pillType, label, toolCall: tc });
    } else {
      items.push({ kind: "tool", index: idx++, sortKey, toolCall: tc });
    }
  }

  for (const m of props.subagent.childMessages) {
    items.push({
      kind: "message",
      index: idx++,
      sortKey: Infinity, // messages come after tools (final responses)
      content: m.content,
      agentName: m.agentDisplayName,
    });
  }

  // Sort by eventIndex-based key for chronological ordering
  items.sort((a, b) => a.sortKey - b.sortKey);

  return items;
});

// ── State reset on subagent change ───────────────────────────────

watch(
  () => props.subagent?.agentId,
  () => {
    promptExpanded.value = true;
    resultExpanded.value = false;
    expandedReasoning.value = new Set();
    expandedToolDetails.clear();
    nextTick(() => {
      scrollContainer.value?.scrollTo({ top: 0 });
    });
  },
);

// ── Helpers ──────────────────────────────────────────────────────

function toggleReasoning(index: number) {
  const next = new Set(expandedReasoning.value);
  if (next.has(index)) next.delete(index);
  else next.add(index);
  expandedReasoning.value = next;
}

function reasoningPreview(content: string): string {
  const first = content.split("\n")[0] ?? "";
  return first.length > 80 ? first.slice(0, 80) + "…" : first;
}

function toggleToolDetail(tc: TurnToolCall, index: number) {
  expandedToolDetails.toggle(`panel-${props.subagent?.agentId}-${index}`);
}

function isToolExpanded(tc: TurnToolCall, index: number): boolean {
  return expandedToolDetails.has(`panel-${props.subagent?.agentId}-${index}`);
}

function pillIcon(type: "intent" | "memory" | "read_agent"): string {
  if (type === "intent") return "📋";
  if (type === "memory") return "💾";
  return "⏳";
}
</script>

<template>
  <!-- Slide-out panel -->
  <Transition name="cv-panel">
    <div
      v-if="isOpen && subagent"
      class="cv-panel"
      :style="{ top: `${topOffset}px` }"
      role="dialog"
      aria-label="Subagent detail panel"
      @keydown.esc="emit('close')"
    >
      <!-- Header -->
      <div class="cv-panel-header" :style="{ '--agent-color': agentColor }">
        <button
          class="cv-panel-close"
          aria-label="Close panel"
          title="Close (Esc)"
          @click="emit('close')"
        >
          ✕
        </button>
        <div class="cv-panel-info">
          <div class="cv-panel-name" :style="{ color: agentColor }">
            <span class="cv-panel-name-icon">{{ agentIcon }}</span>
            <span>{{ agentLabel }}</span>
          </div>
          <div class="cv-panel-meta">
            <span v-if="model" class="cv-panel-model">{{ model }}</span>
            <span v-if="model" class="sep">·</span>
            <span>{{ formatDuration(subagent.toolCall.durationMs ?? 0) }}</span>
            <span class="sep">·</span>
            <span>Turn {{ subagent.turnIndex }}</span>
          </div>
        </div>
        <span :class="['cv-panel-status', status]">{{ statusText }}</span>
      </div>

      <!-- Scrollable body -->
      <div ref="scrollContainer" class="cv-panel-scroll">
        <!-- Description -->
        <div v-if="description" class="cv-panel-section">
          <div class="cv-panel-section-label">Description</div>
          <p class="cv-panel-description">{{ description }}</p>
        </div>

        <!-- Prompt (expanded by default, collapsible when long) -->
        <div v-if="prompt" class="cv-panel-section">
          <div class="cv-panel-section-header">
            <div class="cv-panel-section-label">Prompt</div>
            <button
              v-if="isPromptLong"
              class="cv-panel-toggle"
              :aria-expanded="promptExpanded"
              aria-label="Toggle prompt visibility"
              @click="promptExpanded = !promptExpanded"
            >
              {{ promptExpanded ? "Collapse" : "Expand" }}
              <span :class="['cv-panel-chevron', { open: promptExpanded }]">▸</span>
            </button>
          </div>
          <div :class="['cv-panel-prompt', { collapsed: isPromptLong && !promptExpanded }]">
            <MarkdownContent
              :content="isPromptLong && !promptExpanded ? truncateText(prompt, 300) : prompt"
              :render="renderMd"
            />
          </div>
        </div>

        <!-- Result / Output (shown before activity stream) -->
        <div v-if="resultContent" class="cv-panel-section">
          <div class="cv-panel-section-header">
            <div class="cv-panel-section-label">Output</div>
            <button
              v-if="isResultLong"
              class="cv-panel-toggle"
              :aria-expanded="resultExpanded"
              aria-label="Toggle result visibility"
              @click="resultExpanded = !resultExpanded"
            >
              {{ resultExpanded ? "Collapse" : "Expand" }}
              <span :class="['cv-panel-chevron', { open: resultExpanded }]">▸</span>
            </button>
          </div>
          <div :class="['cv-panel-result', { collapsed: isResultLong && !resultExpanded }]">
            <MarkdownContent
              :content="isResultLong && !resultExpanded ? truncateText(resultContent, 400) : resultContent"
              :render="renderMd"
            />
          </div>
        </div>

        <!-- Activity stream -->
        <div v-if="activities.length > 0" class="cv-panel-section">
          <div class="cv-panel-divider">
            <span class="cv-panel-divider-label">Activity ({{ activities.length }})</span>
          </div>

          <div class="cv-panel-activities">
            <template v-for="item in activities" :key="item.index">
              <!-- Reasoning block -->
              <div v-if="item.kind === 'reasoning'" class="cv-panel-reasoning">
                <button
                  class="cv-panel-reasoning-toggle"
                  :aria-expanded="expandedReasoning.has(item.index)"
                  aria-label="Toggle reasoning block"
                  @click="toggleReasoning(item.index)"
                >
                  <span :class="['cv-panel-chevron', { open: expandedReasoning.has(item.index) }]">▸</span>
                  <span class="cv-panel-reasoning-icon">💭</span>
                  <span class="cv-panel-reasoning-label">Thinking…</span>
                  <span
                    v-if="!expandedReasoning.has(item.index)"
                    class="cv-panel-reasoning-preview"
                  >{{ reasoningPreview(item.content) }}</span>
                </button>
                <div
                  v-if="expandedReasoning.has(item.index)"
                  class="cv-panel-reasoning-content"
                >{{ item.content }}</div>
              </div>

              <!-- Special tool pills -->
              <div
                v-else-if="item.kind === 'pill'"
                :class="['cv-panel-pill', `cv-panel-pill--${item.type}`]"
              >
                <span class="cv-panel-pill-icon">{{ pillIcon(item.type) }}</span>
                <span class="cv-panel-pill-label">{{ item.label }}</span>
                <span
                  v-if="item.toolCall.isComplete"
                  class="cv-panel-pill-check"
                >✓</span>
              </div>

              <!-- Regular tool call -->
              <ToolCallItem
                v-else-if="item.kind === 'tool'"
                :tc="item.toolCall"
                variant="compact"
                :expanded="isToolExpanded(item.toolCall, item.index)"
                :full-result="item.toolCall.toolCallId ? fullResults.get(item.toolCall.toolCallId) : undefined"
                :loading-full-result="item.toolCall.toolCallId ? loadingResults.has(item.toolCall.toolCallId) : false"
                :failed-full-result="item.toolCall.toolCallId ? failedResults.has(item.toolCall.toolCallId) : false"
                :rich-enabled="preferences.isRichRenderingEnabled(item.toolCall.toolName)"
                @toggle="toggleToolDetail(item.toolCall, item.index)"
                @load-full-result="handleLoadFullResult"
                @retry-full-result="handleRetryResult"
              />

              <!-- Nested subagent -->
              <div
                v-else-if="item.kind === 'nested-subagent'"
                class="cv-panel-nested-subagent"
              >
                <div class="cv-panel-nested-header" :style="{ borderLeftColor: getAgentColor(inferAgentTypeFromToolCall(item.toolCall)) }">
                  <span class="cv-panel-nested-icon">{{ getAgentIcon(inferAgentTypeFromToolCall(item.toolCall)) }}</span>
                  <span class="cv-panel-nested-name">{{ item.toolCall.agentDisplayName || item.toolCall.toolName }}</span>
                  <span v-if="item.toolCall.durationMs" class="cv-panel-nested-meta">{{ formatDuration(item.toolCall.durationMs) }}</span>
                  <span :class="['cv-panel-nested-status', item.toolCall.success === false ? 'failed' : item.toolCall.isComplete ? 'completed' : 'running']">
                    {{ item.toolCall.success === false ? '✗' : item.toolCall.isComplete ? '✓' : '…' }}
                  </span>
                </div>
                <div v-if="item.toolCall.intentionSummary || (item.toolCall.arguments as any)?.description" class="cv-panel-nested-desc">
                  {{ item.toolCall.intentionSummary || (item.toolCall.arguments as any)?.description }}
                </div>
              </div>

              <!-- Agent message (rendered markdown) -->
              <div v-else-if="item.kind === 'message'" class="cv-panel-message">
                <MarkdownContent :content="item.content" :render="renderMd" />
              </div>
            </template>
          </div>
        </div>
      </div>

      <!-- Navigation footer -->
      <div class="cv-panel-nav">
        <button
          class="cv-panel-nav-btn"
          :disabled="!hasPrev"
          aria-label="Previous subagent"
          @click="emit('prev')"
        >
          ◀ Prev
        </button>
        <span class="cv-panel-nav-pos">{{ currentIndex + 1 }} / {{ totalCount }}</span>
        <button
          class="cv-panel-nav-btn"
          :disabled="!hasNext"
          aria-label="Next subagent"
          @click="emit('next')"
        >
          Next ▶
        </button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* ── Panel slide transition ───────────────────────────────────── */

.cv-panel-enter-active,
.cv-panel-leave-active {
  transition: transform 320ms cubic-bezier(0.4, 0, 0.2, 1);
}
.cv-panel-enter-from,
.cv-panel-leave-to {
  transform: translateX(100%);
}

/* ── Panel container ──────────────────────────────────────────── */

.cv-panel {
  position: fixed;
  /* top is set dynamically via :style binding */
  right: 0;
  bottom: 0;
  width: 38%;
  min-width: 380px;
  max-width: 650px;
  z-index: 50;
  display: flex;
  flex-direction: column;
  background: var(--canvas-subtle);
  border-left: 1px solid var(--border-default);
  box-shadow: -4px 0 24px rgba(0, 0, 0, 0.15);
  outline: none;
}

@media (max-width: 959px) {
  .cv-panel {
    width: 100%;
    min-width: 0;
    max-width: none;
  }
}

/* ── Header ───────────────────────────────────────────────────── */

.cv-panel-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-default);
  background: var(--canvas-inset);
  flex-shrink: 0;
}

.cv-panel-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: 14px;
  cursor: pointer;
  flex-shrink: 0;
  transition: background var(--transition-fast), color var(--transition-fast);
}

.cv-panel-close:hover {
  background: var(--neutral-subtle);
  color: var(--text-primary);
}

.cv-panel-info {
  flex: 1;
  min-width: 0;
}

.cv-panel-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.875rem;
  font-weight: 600;
  line-height: 1.3;
}

.cv-panel-name-icon {
  font-size: 15px;
  flex-shrink: 0;
}

.cv-panel-meta {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  margin-top: 2px;
}

.cv-panel-meta .sep {
  color: var(--text-placeholder);
  user-select: none;
}

.cv-panel-model {
  font-family: "JetBrains Mono", monospace;
  font-size: 0.625rem;
  padding: 1px 5px;
  background: var(--neutral-subtle);
  border-radius: var(--radius-full);
  color: var(--text-secondary);
}

.cv-panel-status {
  flex-shrink: 0;
  font-size: 0.6875rem;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: var(--radius-full);
}

.cv-panel-status.completed {
  color: var(--success-fg);
  background: var(--success-subtle);
}

.cv-panel-status.failed {
  color: var(--danger-fg);
  background: var(--danger-subtle);
}

.cv-panel-status.in-progress {
  color: var(--warning-fg);
  background: var(--warning-subtle);
}

/* ── Scrollable body ──────────────────────────────────────────── */

.cv-panel-scroll {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 16px;
}

/* ── Sections ─────────────────────────────────────────────────── */

.cv-panel-section {
  margin-bottom: 16px;
}

.cv-panel-section-label {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 6px;
}

.cv-panel-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.cv-panel-description {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  line-height: 1.5;
  margin: 0;
}

/* ── Toggle button (expand/collapse) ──────────────────────────── */

.cv-panel-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: transparent;
  color: var(--accent-fg);
  font-size: 0.6875rem;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  transition: background var(--transition-fast);
}

.cv-panel-toggle:hover {
  background: var(--accent-subtle);
}

/* ── Chevron (shared) ─────────────────────────────────────────── */

.cv-panel-chevron {
  display: inline-block;
  font-size: 10px;
  transition: transform var(--transition-fast);
}

.cv-panel-chevron.open {
  transform: rotate(90deg);
}

/* ── Prompt block ─────────────────────────────────────────────── */

.cv-panel-prompt {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  padding: 10px 12px;
  background: var(--canvas-inset);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-muted);
}

.cv-panel-prompt.collapsed {
  max-height: 120px;
  overflow: hidden;
  mask-image: linear-gradient(to bottom, black 70%, transparent 100%);
  -webkit-mask-image: linear-gradient(to bottom, black 70%, transparent 100%);
}

/* ── Activity divider ─────────────────────────────────────────── */

.cv-panel-divider {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.cv-panel-divider::after {
  content: "";
  flex: 1;
  height: 1px;
  background: var(--border-muted);
}

.cv-panel-divider-label {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  white-space: nowrap;
}

/* ── Activity stream ──────────────────────────────────────────── */

.cv-panel-activities {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* ── Reasoning block ──────────────────────────────────────────── */

.cv-panel-reasoning {
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-muted);
  background: var(--canvas-inset);
  overflow: hidden;
}

.cv-panel-reasoning-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 10px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  font-size: 0.75rem;
  color: var(--text-secondary);
  transition: background var(--transition-fast);
}

.cv-panel-reasoning-toggle:hover {
  background: var(--neutral-subtle);
}

.cv-panel-reasoning-icon {
  font-size: 13px;
  flex-shrink: 0;
}

.cv-panel-reasoning-label {
  font-weight: 500;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.cv-panel-reasoning-preview {
  flex: 1;
  color: var(--text-placeholder);
  font-size: 0.6875rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-style: italic;
}

.cv-panel-reasoning-content {
  padding: 8px 12px;
  font-size: 0.75rem;
  color: var(--text-secondary);
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 300px;
  overflow-y: auto;
  border-top: 1px solid var(--border-muted);
}

/* ── Special pills (intent / memory / read_agent) ─────────────── */

.cv-panel-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: var(--radius-full);
  font-size: 0.6875rem;
  font-weight: 500;
  max-width: 100%;
}

.cv-panel-pill-icon {
  font-size: 12px;
  flex-shrink: 0;
}

.cv-panel-pill-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.cv-panel-pill-check {
  font-size: 10px;
  flex-shrink: 0;
  opacity: 0.7;
}

.cv-panel-pill--intent {
  color: var(--accent-fg);
  background: var(--accent-subtle);
}

.cv-panel-pill--memory {
  color: var(--done-fg);
  background: var(--done-subtle);
}

.cv-panel-pill--read_agent {
  color: var(--success-fg);
  background: var(--success-subtle);
}

/* ── Agent message bubble ─────────────────────────────────────── */

.cv-panel-message {
  padding: 10px 12px;
  background: var(--canvas-inset);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-muted);
  font-size: 0.8125rem;
  color: var(--text-primary);
  line-height: 1.55;
}

.cv-panel-message :deep(.markdown-content) {
  font-size: inherit;
  line-height: inherit;
}

/* ── Result block ─────────────────────────────────────────────── */

.cv-panel-result {
  font-size: 0.75rem;
  font-family: "JetBrains Mono", monospace;
  color: var(--text-secondary);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  padding: 10px 12px;
  background: var(--canvas-inset);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-muted);
}

.cv-panel-result.collapsed {
  max-height: 160px;
  overflow: hidden;
  mask-image: linear-gradient(to bottom, black 70%, transparent 100%);
  -webkit-mask-image: linear-gradient(to bottom, black 70%, transparent 100%);
}

/* ── Navigation footer ────────────────────────────────────────── */

.cv-panel-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  border-top: 1px solid var(--border-default);
  background: var(--canvas-inset);
  flex-shrink: 0;
}

.cv-panel-nav-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.75rem;
  cursor: pointer;
  transition: background var(--transition-fast), color var(--transition-fast),
    border-color var(--transition-fast);
}

.cv-panel-nav-btn:hover:not(:disabled) {
  background: var(--neutral-subtle);
  color: var(--text-primary);
  border-color: var(--border-default);
}

.cv-panel-nav-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.cv-panel-nav-pos {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

/* ── Nested subagent ─────────────────────────────────────────── */

.cv-panel-nested-subagent {
  border-radius: var(--radius-md, 8px);
  background: var(--canvas-inset, #010409);
  overflow: hidden;
  margin: 2px 0;
}

.cv-panel-nested-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-left: 3px solid var(--accent-fg);
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-primary);
}

.cv-panel-nested-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.cv-panel-nested-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cv-panel-nested-meta {
  color: var(--text-tertiary);
  font-weight: 400;
  font-size: 0.6875rem;
  flex-shrink: 0;
}

.cv-panel-nested-status {
  flex-shrink: 0;
  font-weight: 600;
  font-size: 0.6875rem;
}
.cv-panel-nested-status.completed {
  color: var(--success-fg, #3fb950);
}
.cv-panel-nested-status.failed {
  color: var(--danger-fg, #f85149);
}
.cv-panel-nested-status.running {
  color: var(--warning-fg, #d29922);
}

.cv-panel-nested-desc {
  padding: 4px 12px 8px 15px;
  font-size: 0.6875rem;
  color: var(--text-secondary);
  line-height: 1.4;
}
</style>
