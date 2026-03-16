<script setup lang="ts">
import { computed, ref } from "vue";
import { useSessionDetailStore } from "@/stores/sessionDetail";
import { useToolResultLoader } from "@/composables/useToolResultLoader";
import {
  StatCard, Badge, BtnGroup, EmptyState,
  ExpandChevron, ToolCallItem, ToolCallDetail,
  formatDuration, formatTime, formatNumber, truncateText,
  toolIcon, toolCategory, categoryColor, formatArgsSummary,
  useSessionTabLoader, useToggleSet,
} from "@tracepilot/ui";

const store = useSessionDetailStore();
const expandedTools = useToggleSet<number>();
const expandedToolDetails = useToggleSet<string>();
const expandedReasoning = useToggleSet<number>();
const activeView = ref("chat");

const { fullResults, loadingResults, failedResults, loadFullResult: handleLoadFullResult, retryFullResult: handleRetryResult } = useToolResultLoader(
  () => store.sessionId
);

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
      expandedReasoning.clear();
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
    <div v-else-if="activeView === 'chat'" class="turn-group">
      <div v-for="turn in store.turns" :key="turn.turnIndex" class="conversation-turn">
        <!-- User message -->
        <div v-if="turn.userMessage" class="turn-item">
          <div class="turn-avatar user">👤</div>
          <div class="turn-body">
            <div class="turn-header">
              <span class="turn-author">You</span>
              <span class="turn-meta">Turn {{ turn.turnIndex }}</span>
              <span v-if="turn.timestamp" class="turn-meta">{{ formatTime(turn.timestamp) }}</span>
            </div>
            <div class="turn-bubble user">{{ truncateText(turn.userMessage) }}</div>
          </div>
        </div>

        <!-- Reasoning (thinking) — after user message, before assistant response -->
        <div v-if="turn.reasoningTexts && turn.reasoningTexts.length > 0" class="turn-reasoning">
          <button
            class="reasoning-toggle"
            :aria-expanded="expandedReasoning.has(turn.turnIndex)"
            @click="expandedReasoning.toggle(turn.turnIndex)"
          >
            <ExpandChevron :expanded="expandedReasoning.has(turn.turnIndex)" />
            💭 {{ turn.reasoningTexts.length }} reasoning block{{ turn.reasoningTexts.length !== 1 ? 's' : '' }}
          </button>
          <div v-if="expandedReasoning.has(turn.turnIndex)" class="reasoning-content" tabindex="0">
            <template v-for="(text, rIdx) in turn.reasoningTexts" :key="rIdx">
              <hr v-if="rIdx > 0" class="reasoning-divider" />
              {{ text }}
            </template>
          </div>
        </div>

        <!-- Assistant messages -->
        <div v-for="(msg, idx) in turn.assistantMessages.filter(m => m.trim())" :key="idx" class="turn-item">
          <div class="turn-avatar assistant">🤖</div>
          <div class="turn-body">
            <div class="turn-header">
              <span class="turn-author">Assistant</span>
              <Badge v-if="turn.model" variant="done" style="font-size: 0.625rem; padding: 1px 6px;">{{ turn.model }}</Badge>
              <span v-if="turn.durationMs" class="turn-meta">{{ formatDuration(turn.durationMs) }}</span>
              <Badge v-if="!turn.isComplete" variant="warning">Incomplete</Badge>
            </div>
            <div class="turn-bubble assistant">{{ truncateText(msg) }}</div>
          </div>
        </div>

        <!-- Token badge (once per turn, outside assistant messages loop) -->
        <div v-if="turn.outputTokens" class="turn-reasoning">
          <span class="token-badge">🪙 {{ formatNumber(turn.outputTokens) }} tokens</span>
        </div>

        <!-- Tool calls section -->
        <div v-if="turn.toolCalls.length > 0" class="turn-tool-calls">
          <div class="tool-calls-container">
            <button
              class="tool-call-header w-full"
              :aria-expanded="expandedTools.has(turn.turnIndex)"
              @click="expandedTools.toggle(turn.turnIndex)"
            >
              <ExpandChevron :expanded="expandedTools.has(turn.turnIndex)" />
              <span>{{ turn.toolCalls.length }} tool call{{ turn.toolCalls.length !== 1 ? "s" : "" }}</span>
              <span style="margin-left: auto; display: flex; gap: 6px;">
                <span class="tool-summary-badge tool-summary-pass">
                  {{ turn.toolCalls.filter((tc) => tc.success === true).length }} passed
                </span>
                <span
                  v-if="turn.toolCalls.some((tc) => tc.success === false)"
                  class="tool-summary-badge tool-summary-fail"
                >
                  {{ turn.toolCalls.filter((tc) => tc.success === false).length }} failed
                </span>
              </span>
            </button>

            <div v-if="expandedTools.has(turn.turnIndex)">
              <ToolCallItem
                v-for="(tc, tcIdx) in turn.toolCalls"
                :key="tcIdx"
                :tc="tc"
                :args-summary="getArgsSummary(turn.turnIndex, tcIdx)"
                :expanded="expandedToolDetails.has(`${turn.turnIndex}-${tcIdx}`)"
                :full-result="tc.toolCallId ? fullResults.get(tc.toolCallId) : undefined"
                :loading-full-result="tc.toolCallId ? loadingResults.has(tc.toolCallId) : false"
                :failed-full-result="tc.toolCallId ? failedResults.has(tc.toolCallId) : false"
                @toggle="expandedToolDetails.toggle(`${turn.turnIndex}-${tcIdx}`)"
                @load-full-result="handleLoadFullResult"
                @retry-full-result="handleRetryResult"
              />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══════════════ COMPACT VIEW ═══════════════ -->
    <div v-else-if="activeView === 'compact'" class="turn-group">
      <div v-for="turn in store.turns" :key="turn.turnIndex" class="compact-turn">
        <div class="compact-turn-header">
          <span class="turn-meta" style="font-weight: 700; color: var(--accent-fg);">Turn {{ turn.turnIndex }}</span>
          <Badge v-if="turn.model" variant="done">{{ turn.model }}</Badge>
          <span v-if="turn.durationMs" class="turn-meta">{{ formatDuration(turn.durationMs) }}</span>
          <span v-if="turn.outputTokens" class="token-badge">🪙 {{ formatNumber(turn.outputTokens) }}</span>
          <span v-if="turn.toolCalls.length" style="margin-left: auto;" class="turn-meta">
            {{ turn.toolCalls.length }} tool{{ turn.toolCalls.length !== 1 ? "s" : "" }}
          </span>
          <Badge v-if="!turn.isComplete" variant="warning">Incomplete</Badge>
        </div>

        <div class="compact-turn-body">
          <div v-if="turn.userMessage" class="compact-turn-label">
            <span class="compact-turn-label-prefix user">User:</span>
            {{ truncateText(turn.userMessage, 300) }}
          </div>
          <div v-for="(msg, idx) in turn.assistantMessages.filter(m => m.trim())" :key="idx" class="compact-turn-label">
            <span class="compact-turn-label-prefix assistant">Copilot:</span>
            {{ truncateText(msg, 300) }}
          </div>

          <!-- Tool pills -->
          <div v-if="turn.toolCalls.length > 0" class="compact-tool-pills">
            <button
              v-for="(tc, tcIdx) in turn.toolCalls"
              :key="tcIdx"
              class="compact-tool-pill"
              :class="{
                failed: tc.success === false,
                unknown: tc.success == null,
              }"
              :aria-expanded="expandedToolDetails.has(`compact-${turn.turnIndex}-${tcIdx}`)"
              @click="expandedToolDetails.toggle(`compact-${turn.turnIndex}-${tcIdx}`)"
            >
              {{ toolIcon(tc.toolName) }} {{ tc.toolName }}
              <span v-if="tc.durationMs" class="turn-meta">{{ formatDuration(tc.durationMs) }}</span>
            </button>
          </div>

          <!-- Expanded tool detail (compact view) -->
          <template v-for="(tc, tcIdx) in turn.toolCalls" :key="`detail-${tcIdx}`">
            <div v-if="expandedToolDetails.has(`compact-${turn.turnIndex}-${tcIdx}`)" class="tool-calls-container" style="margin-top: 4px;">
              <div class="tool-call-header">
                <span>{{ toolIcon(tc.toolName) }}</span>
                <span class="tool-call-name" :class="categoryColor(toolCategory(tc.toolName))">{{ tc.toolName }}</span>
                <span v-if="getArgsSummary(turn.turnIndex, tcIdx)" class="tool-call-args" style="font-family: var(--font-mono, monospace);">{{ getArgsSummary(turn.turnIndex, tcIdx) }}</span>
              </div>
              <ToolCallDetail
                :tc="tc"
                :show-metadata="false"
                :full-result="tc.toolCallId ? fullResults.get(tc.toolCallId) : undefined"
                :loading-full-result="tc.toolCallId ? loadingResults.has(tc.toolCallId) : false"
                @load-full-result="handleLoadFullResult"
              />
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- ═══════════════ TIMELINE VIEW ═══════════════ -->
    <div v-else-if="activeView === 'timeline'" class="timeline-view">
      <div v-for="(turn, turnIdx) in store.turns" :key="turn.turnIndex" class="timeline-turn">
        <div v-if="turnIdx < store.turns.length - 1" class="timeline-connector" />
        <div class="timeline-marker">{{ turn.turnIndex }}</div>

        <div class="timeline-turn-body">
          <div class="timeline-meta">
            <Badge v-if="turn.model" variant="done">{{ turn.model }}</Badge>
            <span v-if="turn.durationMs" class="turn-meta">{{ formatDuration(turn.durationMs) }}</span>
            <span v-if="turn.outputTokens" class="token-badge">🪙 {{ formatNumber(turn.outputTokens) }}</span>
            <span v-if="turn.timestamp" class="turn-meta">{{ formatTime(turn.timestamp) }}</span>
            <span v-if="turn.toolCalls.length" class="turn-meta">· {{ turn.toolCalls.length }} tools</span>
            <Badge v-if="!turn.isComplete" variant="warning">Incomplete</Badge>
          </div>

          <div v-if="turn.userMessage" class="timeline-block user">
            <div class="timeline-block-label user">User</div>
            <div class="timeline-block-text">{{ truncateText(turn.userMessage, 500) }}</div>
          </div>

          <!-- Reasoning (timeline) -->
          <div v-if="turn.reasoningTexts && turn.reasoningTexts.length > 0">
            <button
              class="reasoning-toggle"
              :aria-expanded="expandedReasoning.has(turn.turnIndex)"
              @click="expandedReasoning.toggle(turn.turnIndex)"
            >
              <ExpandChevron :expanded="expandedReasoning.has(turn.turnIndex)" />
              💭 {{ turn.reasoningTexts.length }} reasoning block{{ turn.reasoningTexts.length !== 1 ? 's' : '' }}
            </button>
            <div v-if="expandedReasoning.has(turn.turnIndex)" class="reasoning-content" tabindex="0">
              <template v-for="(text, rIdx) in turn.reasoningTexts" :key="rIdx">
                <hr v-if="rIdx > 0" class="reasoning-divider" />
                {{ text }}
              </template>
            </div>
          </div>

          <!-- Tool calls (timeline) -->
          <div v-if="turn.toolCalls.length > 0" style="display: flex; flex-direction: column; gap: 6px;">
            <ToolCallItem
              v-for="(tc, tcIdx) in turn.toolCalls"
              :key="tcIdx"
              :tc="tc"
              variant="compact"
              :args-summary="getArgsSummary(turn.turnIndex, tcIdx)"
              :expanded="expandedToolDetails.has(`tl-${turn.turnIndex}-${tcIdx}`)"
              :full-result="tc.toolCallId ? fullResults.get(tc.toolCallId) : undefined"
              :loading-full-result="tc.toolCallId ? loadingResults.has(tc.toolCallId) : false"
              :failed-full-result="tc.toolCallId ? failedResults.has(tc.toolCallId) : false"
              @toggle="expandedToolDetails.toggle(`tl-${turn.turnIndex}-${tcIdx}`)"
              @load-full-result="handleLoadFullResult"
              @retry-full-result="handleRetryResult"
            />
          </div>

          <div v-for="(msg, idx) in turn.assistantMessages.filter(m => m.trim())" :key="idx" class="timeline-block assistant">
            <div class="timeline-block-label assistant">Copilot</div>
            <div class="timeline-block-text">{{ truncateText(msg, 500) }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
