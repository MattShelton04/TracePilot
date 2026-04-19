<script setup lang="ts">
/**
 * SdkStreamingOverlay — live streaming content injected into ChatViewMode.
 *
 * Renders a "ghost turn" showing streaming assistant messages and reasoning
 * as they arrive from the SDK event stream. Disappears once session.idle
 * fires and the FS store picks up the committed turn.
 *
 * When the agent calls `ask_user`, the generic tool row is replaced with a
 * prominent question card + inline response input. Sending the answer calls
 * `sdk.sendMessage` with the answer text. In stdio mode a warning is shown
 * since the response mechanism may behave differently.
 *
 * Injected from ChatViewMode via SdkLiveSessionKey.
 * Only visible when isAgentRunning is true or streaming messages exist.
 */
import { MarkdownContent, ReasoningBlock, useToggleSet } from "@tracepilot/ui";
import { computed, onUnmounted, ref, watch } from "vue";
import { useSdkLiveSessionContext } from "@/composables/useLiveSdkSession";
import { useSdkStore } from "@/stores/sdk";

const live = useSdkLiveSessionContext();
const sdk = useSdkStore();

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
    // Gate on activeTurnId (non-null means turn is in-flight).
    // isAgentRunning stays true between turn_end and session.idle, but
    // activeTurnId is cleared at turn_end — prevents "Copilot is thinking…"
    // reappearing in that brief window.
    (live.isAgentRunning.value && live.activeTurnId.value != null)
  );
});

const streamingMessages = computed(() => (live ? [...live.streamingMessages.entries()] : []));
const streamingReasoning = computed(() => (live ? [...live.streamingReasoning.entries()] : []));
/** All active tools, excluding ask_user (rendered separately as a question card). */
const activeTools = computed(() =>
  live ? [...live.activeTools.values()].filter((t) => t.toolName !== "ask_user") : [],
);
const activeAskUser = computed(() => (live ? live.activeAskUser.value : null));

/** True when connected to a --ui-server (TCP mode). ask_user responses must
 *  be typed in the terminal in this mode — the SDK UserInputHandler is not
 *  invoked by the CLI's TUI handler. */
const isTcpMode = computed(() => sdk.connectionMode === "tcp");

// ── ask_user response state ──────────────────────────────────────────────────

const answerText = ref("");
const submitting = ref(false);

// Clear stale answer whenever a new ask_user call starts.
watch(
  () => activeAskUser.value?.toolCallId,
  () => { answerText.value = ""; },
);

async function handleSubmitAnswer() {
  const sid = live?.sessionId.value;
  if (!sid || !answerText.value.trim() || submitting.value) return;
  submitting.value = true;
  try {
    await sdk.answerUserInput(sid, answerText.value.trim());
    answerText.value = "";
  } finally {
    submitting.value = false;
  }
}

function handleAnswerKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    handleSubmitAnswer();
  }
}

function selectChoice(choice: string) {
  answerText.value = choice;
  // If allowFreeform is explicitly false, submit immediately on choice click
  if (activeAskUser.value?.allowFreeform === false) {
    handleSubmitAnswer();
  }
}


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
    { immediate: true },
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
  <div v-if="live && hasContent" class="sdk-stream-overlay" aria-live="polite" aria-label="Copilot is responding">
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

    <!-- ask_user prompt card (replaces generic tool row for ask_user) -->
    <div v-if="activeAskUser" class="sdk-ask-user-card" role="group" aria-label="Copilot is asking a question">
      <div class="sdk-ask-user-header">
        <span class="sdk-ask-user-icon" aria-hidden="true">💬</span>
        <span class="sdk-ask-user-label">Copilot is asking</span>
      </div>
      <p v-if="activeAskUser.question" class="sdk-ask-user-question">
        {{ activeAskUser.question }}
      </p>

      <!-- TCP mode: handler not invoked by CLI TUI, user must answer in terminal -->
      <p v-if="isTcpMode" class="sdk-ask-user-tcp-note">
        ↳ Answer this prompt in your terminal
      </p>

      <!-- stdio mode: our UserInputHandler intercepts the request -->
      <template v-else>
        <!-- Choice buttons — click to select or submit directly -->
        <div v-if="activeAskUser.choices?.length" class="sdk-ask-user-choices" role="group" aria-label="Available choices">
          <button
            v-for="choice in activeAskUser.choices"
            :key="choice"
            class="sdk-ask-user-choice"
            :class="{ 'sdk-ask-user-choice-active': answerText === choice }"
            :disabled="submitting"
            type="button"
            @click="selectChoice(choice)"
          >
            {{ choice }}
          </button>
        </div>

        <!-- Freeform textarea — shown always when no choices, or when allowFreeform != false -->
        <div
          v-if="!activeAskUser.choices?.length || activeAskUser.allowFreeform !== false"
          class="sdk-ask-user-input-row"
        >
          <textarea
            v-model="answerText"
            class="sdk-ask-user-textarea"
            placeholder="Type your answer… (Ctrl+Enter to send)"
            rows="2"
            :disabled="submitting"
            aria-label="Answer to Copilot's question"
            @keydown="handleAnswerKeydown"
          />
          <button
            class="sdk-ask-user-send"
            :disabled="submitting || !answerText.trim()"
            aria-label="Send answer"
            @click="handleSubmitAnswer"
          >
            <span v-if="submitting" aria-hidden="true">⏳</span>
            <span v-else aria-hidden="true">↵</span>
            {{ submitting ? "Sending…" : "Send" }}
          </button>
        </div>

        <!-- When only choices and no freeform: show send button separately -->
        <div
          v-else-if="activeAskUser.choices?.length && activeAskUser.allowFreeform === false"
          class="sdk-ask-user-choice-send-row"
        >
          <button
            class="sdk-ask-user-send"
            :disabled="submitting || !answerText.trim()"
            aria-label="Send selected answer"
            @click="handleSubmitAnswer"
          >
            <span v-if="submitting" aria-hidden="true">⏳</span>
            <span v-else aria-hidden="true">↵</span>
            {{ submitting ? "Sending…" : "Send" }}
          </button>
        </div>
      </template>
    </div>

    <!-- Active tool indicators (ask_user excluded — shown as card above) -->
    <div v-if="activeTools.length > 0" class="sdk-stream-tools" role="list">
      <div
        v-for="tool in activeTools"
        :key="tool.toolCallId"
        class="sdk-stream-tool"
        role="listitem"
      >
        <span class="sdk-stream-tool-icon" aria-hidden="true">🔧</span>
        <span class="sdk-stream-tool-name">{{ tool.mcpToolName ?? tool.toolName }}</span>
        <span v-if="tool.progressMessage" class="sdk-stream-tool-progress">
          {{ tool.progressMessage }}
        </span>
        <span class="sdk-stream-tool-elapsed" aria-hidden="true">{{ elapsedMs(tool.startedAt) }}</span>
      </div>
    </div>

    <!-- Idle indicator: turn active but no content flowing yet -->
    <div
      v-if="live.isAgentRunning.value && streamingMessages.length === 0 && streamingReasoning.length === 0 && activeTools.length === 0 && !activeAskUser"
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

/* ── ask_user question card ───────────────────────────────────── */

.sdk-ask-user-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  background: var(--canvas-subtle);
  border: 1.5px solid var(--attention-emphasis);
  border-radius: var(--radius-md);
  animation: sdk-stream-fadein 0.15s ease-out;
}

.sdk-ask-user-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sdk-ask-user-icon {
  font-size: 1rem;
  flex-shrink: 0;
}

.sdk-ask-user-label {
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--attention-fg);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  flex: 1;
}

.sdk-ask-user-question {
  margin: 0;
  font-size: 0.875rem;
  color: var(--text-primary);
  line-height: 1.5;
}

.sdk-ask-user-tcp-note {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--text-tertiary);
  font-style: italic;
}

.sdk-ask-user-input-row {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}

.sdk-ask-user-textarea {
  flex: 1;
  resize: none;
  padding: 8px 10px;
  font-size: 0.8125rem;
  font-family: inherit;
  line-height: 1.5;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--canvas-default);
  color: var(--text-primary);
  outline: none;
  transition: border-color 0.15s;
}

.sdk-ask-user-textarea:focus {
  border-color: var(--accent-emphasis);
}

.sdk-ask-user-textarea:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.sdk-ask-user-send {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 7px 14px;
  font-size: 0.75rem;
  font-weight: 600;
  border: none;
  border-radius: var(--radius-sm);
  background: var(--accent-emphasis);
  color: var(--fg-on-emphasis);
  cursor: pointer;
  white-space: nowrap;
  transition: opacity 0.15s;
  flex-shrink: 0;
}

.sdk-ask-user-send:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.sdk-ask-user-send:not(:disabled):hover {
  opacity: 0.85;
}

/* ── ask_user choices ────────────────────────────────────────────── */

.sdk-ask-user-choices {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.sdk-ask-user-choice {
  padding: 5px 12px;
  font-size: 0.8125rem;
  font-family: inherit;
  border: 1.5px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--canvas-default);
  color: var(--text-secondary);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}

.sdk-ask-user-choice:hover:not(:disabled) {
  border-color: var(--accent-emphasis);
  color: var(--text-primary);
}

.sdk-ask-user-choice-active {
  border-color: var(--accent-emphasis);
  background: var(--accent-subtle);
  color: var(--accent-fg);
  font-weight: 600;
}

.sdk-ask-user-choice:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.sdk-ask-user-choice-send-row {
  display: flex;
  justify-content: flex-end;
}

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

/* Delay the thinking indicator so it only appears if content hasn't
   arrived within 200ms — avoids a flash for fast responses. */
.sdk-stream-thinking {
  animation: sdk-stream-fadein 0.1s ease-out 200ms both;
}

@keyframes sdk-stream-pulse {
  0%, 100% { opacity: 0.7; }
  50%       { opacity: 0.4; }
}
</style>
