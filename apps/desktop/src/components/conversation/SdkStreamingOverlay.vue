<script setup lang="ts">
/**
 * SdkStreamingOverlay — live streaming content injected into ChatViewMode.
 *
 * Renders a "ghost turn" showing streaming assistant messages and reasoning
 * as they arrive from the SDK event stream. Disappears once session.idle
 * fires and the FS store picks up the committed turn.
 *
 * Injected from ChatViewMode via SdkLiveSessionKey.
 * Only visible when isAgentRunning is true or streaming messages exist.
 */
import { MarkdownContent, ReasoningBlock, useToggleSet } from "@tracepilot/ui";
import { computed, onUnmounted, ref, watch } from "vue";
import { useSdkLiveSessionContext } from "@/composables/useLiveSdkSession";

const live = useSdkLiveSessionContext();

const expandedReasoning = useToggleSet<string>();

const hasContent = computed(() => {
  if (!live) return false;
  // Only show when actually linked to the SDK — prevents "thinking" ghost
  // persisting after disconnect or unlink.
  if (!live.isLinkedToSdk.value) return false;
  return (
    live.streamingMessages.size > 0 ||
    live.streamingReasoning.size > 0 ||
    live.activeTools.size > 0 ||
    live.isAgentRunning.value
  );
});

const streamingMessages = computed(() => (live ? [...live.streamingMessages.entries()] : []));
const streamingReasoning = computed(() => (live ? [...live.streamingReasoning.entries()] : []));
const activeTools = computed(() => (live ? [...live.activeTools.values()] : []));

// ── Reactive clock for elapsed time ─────────────────────────────────────────
// Ticks every second while any tool is active, so elapsed times stay live.

const now = ref(Date.now());
let ticker: ReturnType<typeof setInterval> | null = null;

if (live) {
  watch(
    () => live.activeTools.size,
    (size) => {
      if (size > 0 && !ticker) {
        ticker = setInterval(() => { now.value = Date.now(); }, 1000);
      } else if (size === 0 && ticker) {
        clearInterval(ticker);
        ticker = null;
      }
    },
  );
}

onUnmounted(() => {
  if (ticker) clearInterval(ticker);
});

function elapsedMs(startedAt: number): string {
  const ms = now.value - startedAt;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}
</script>

<template>
  <div v-if="live && hasContent" class="sdk-stream-overlay">
    <!-- Streaming reasoning blocks (if any) -->
    <ReasoningBlock
      v-for="[id, r] in streamingReasoning"
      :key="id"
      :reasoning="[r.content]"
      :expanded="expandedReasoning.has(id)"
      @toggle="expandedReasoning.toggle(id)"
    />

    <!-- Streaming assistant message bubbles -->
    <div
      v-for="[id, msg] in streamingMessages"
      :key="id"
      class="sdk-stream-bubble"
    >
      <div class="sdk-stream-bubble-header">
        <span class="sdk-stream-avatar" aria-hidden="true">🤖</span>
        <span class="sdk-stream-name">Copilot</span>
        <span class="sdk-stream-badge">
          <span class="sdk-stream-cursor" aria-hidden="true" />
          streaming
        </span>
      </div>
      <MarkdownContent :content="msg.content" :render="false" />
    </div>

    <!-- Active tool indicators -->
    <div v-if="activeTools.length > 0" class="sdk-stream-tools">
      <div
        v-for="tool in activeTools"
        :key="tool.toolCallId"
        class="sdk-stream-tool"
      >
        <span class="sdk-stream-tool-icon" aria-hidden="true">🔧</span>
        <span class="sdk-stream-tool-name">{{ tool.mcpToolName ?? tool.toolName }}</span>
        <span v-if="tool.progressMessage" class="sdk-stream-tool-progress">
          {{ tool.progressMessage }}
        </span>
        <span class="sdk-stream-tool-elapsed">{{ elapsedMs(tool.startedAt) }}</span>
      </div>
    </div>

    <!-- Idle indicator: agent running but no content yet -->
    <div
      v-if="live.isLinkedToSdk.value && live.isAgentRunning.value && streamingMessages.length === 0 && streamingReasoning.length === 0 && activeTools.length === 0"
      class="sdk-stream-thinking"
    >
      <span class="sdk-stream-cursor" aria-hidden="true" />
      <span class="sdk-stream-thinking-text">Copilot is thinking…</span>
    </div>
  </div>
</template>

<style scoped>
.sdk-stream-overlay {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px 0 4px;
  opacity: 0.92;
}

/* ── Streaming bubble ─────────────────────────────────────────── */

.sdk-stream-bubble {
  border-left: 3px solid var(--accent-emphasis);
  background: var(--canvas-subtle);
  border-radius: 0 var(--radius-md) var(--radius-md) 0;
  padding: 12px 16px;
  animation: sdk-stream-fadein 0.15s ease-out;
}

@keyframes sdk-stream-fadein {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}

.sdk-stream-bubble-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.sdk-stream-avatar {
  font-size: 0.875rem;
}

.sdk-stream-name {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-primary);
}

.sdk-stream-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 0.625rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--accent-fg);
  background: var(--accent-muted);
  padding: 1px 7px;
  border-radius: 99px;
}

/* ── Streaming cursor ─────────────────────────────────────────── */

.sdk-stream-cursor {
  display: inline-block;
  width: 7px;
  height: 12px;
  background: currentColor;
  border-radius: 1px;
  animation: sdk-blink 0.9s step-end infinite;
  vertical-align: text-bottom;
}

@keyframes sdk-blink {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0; }
}

/* ── Active tool list ─────────────────────────────────────────── */

.sdk-stream-tools {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sdk-stream-tool {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  background: var(--canvas-overlay);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  font-size: 0.6875rem;
  animation: sdk-stream-fadein 0.12s ease-out;
}

.sdk-stream-tool-icon {
  font-size: 0.75rem;
  flex-shrink: 0;
}

.sdk-stream-tool-name {
  font-weight: 600;
  color: var(--text-secondary);
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 0.625rem;
}

.sdk-stream-tool-progress {
  color: var(--text-tertiary);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sdk-stream-tool-elapsed {
  margin-left: auto;
  color: var(--text-placeholder);
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 0.5625rem;
  flex-shrink: 0;
}

/* ── Thinking placeholder ─────────────────────────────────────── */

.sdk-stream-thinking {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 0;
  color: var(--text-tertiary);
  font-size: 0.75rem;
}

.sdk-stream-thinking-text {
  font-style: italic;
  animation: sdk-stream-pulse 1.6s ease-in-out infinite;
}

@keyframes sdk-stream-pulse {
  0%, 100% { opacity: 0.7; }
  50%       { opacity: 0.4; }
}
</style>
