<script setup lang="ts">
/**
 * SdkSteeringPanel — Command Bar style steering for active SDK sessions.
 *
 * Floating bar at the bottom of ChatViewMode when the SDK bridge is
 * connected and the current session is linked. Sends messages, switches
 * mode/model, and aborts. Model is inferred from existing chat turns
 * when SDK session data doesn't provide one.
 */
import type { BridgeSessionMode } from "@tracepilot/types";
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useSdkStore } from "@/stores/sdk";
import { useSessionDetailStore } from "@/stores/sessionDetail";
import { usePreferencesStore } from "@/stores/preferences";
import { logInfo, logWarn } from "@/utils/logger";

const sdk = useSdkStore();
const prefs = usePreferencesStore();
const detail = useSessionDetailStore();

const props = defineProps<{
  sessionId: string | null;
}>();

const emit = defineEmits<{
  messageSent: [prompt: string];
}>();

// ─── Local state ────────────────────────────────────────────────
const prompt = ref("");
const inputEl = ref<HTMLTextAreaElement | null>(null);
const modelDropdownOpen = ref(false);
const modelDropdownEl = ref<HTMLElement | null>(null);
const modelDropdownStyle = ref<Record<string, string>>({});

// ─── Sent messages log ──────────────────────────────────────────
interface SentMessage {
  id: number;
  text: string;
  timestamp: number;
  status: "sending" | "sent" | "error";
  turnId?: string;
  error?: string;
}
const sentMessages = ref<SentMessage[]>([]);
const MAX_SENT_LOG = 5;
let sentIdCounter = 0;

/** Reactively update a sent message's status (Vue tracks by array replacement). */
function updateSentMessage(id: number, update: Partial<SentMessage>) {
  sentMessages.value = sentMessages.value.map((m) =>
    m.id === id ? { ...m, ...update } : m,
  );
}

/** Schedule auto-removal of a sent message. */
function autoRemoveSent(id: number, delayMs: number) {
  setTimeout(() => {
    sentMessages.value = sentMessages.value.filter((m) => m.id !== id);
  }, delayMs);
}

// Position the teleported dropdown above the model button
function updateDropdownPosition() {
  const btn = document.querySelector(".cb-model-btn") as HTMLElement | null;
  if (!btn) return;
  const rect = btn.getBoundingClientRect();
  modelDropdownStyle.value = {
    position: "fixed",
    left: `${rect.left}px`,
    bottom: `${window.innerHeight - rect.top + 6}px`,
    minWidth: "200px",
    maxHeight: "240px",
    zIndex: "9999",
  };
}

// ─── Computed ───────────────────────────────────────────────────
const isEnabled = computed(() => prefs.isFeatureEnabled("copilotSdk"));

const linkedSession = computed(() => {
  if (!props.sessionId) return null;
  return sdk.sessions.find((s) => s.sessionId === props.sessionId) ?? null;
});

/** Panel is visible whenever SDK is connected and feature is on (even if session isn't linked yet). */
const isVisible = computed(
  () => isEnabled.value && sdk.isConnected && !!props.sessionId,
);

/** Whether the session is actively linked (resumed) and ready for steering. */
const isLinked = computed(
  () => linkedSession.value?.isActive === true,
);

const modes: { value: BridgeSessionMode; label: string; icon: string }[] = [
  { value: "interactive", label: "Ask", icon: "💬" },
  { value: "plan", label: "Plan", icon: "📋" },
  { value: "autopilot", label: "Auto", icon: "🚀" },
];

const currentMode = computed(
  () => linkedSession.value?.mode ?? "interactive",
);

/** Model inferred from existing chat turns when SDK session doesn't provide one. */
const inferredModel = computed(() => {
  const turns = detail.turns;
  if (!turns?.length) return null;
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].model) return turns[i].model;
  }
  return null;
});

const currentModel = computed(
  () => linkedSession.value?.model ?? inferredModel.value ?? null,
);

const shortModel = computed(() => {
  const m = currentModel.value;
  if (!m) return null;
  // Shorten common prefixes for display
  return m
    .replace(/^gpt-/, "")
    .replace(/^claude-/, "")
    .replace(/^o[0-9]+-/, (p) => p);
});

const hasText = computed(() => prompt.value.trim().length > 0);

const shortSessionId = computed(() => {
  const id = props.sessionId;
  if (!id) return null;
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
});

// ─── Session linking ────────────────────────────────────────────
const sessionError = ref<string | null>(null);
const resuming = ref(false);
/** The actual session ID used by the SDK (may differ from props.sessionId after resume). */
const resolvedSessionId = ref<string | null>(null);

/** The effective session ID for SDK operations — uses resolved ID if available. */
const effectiveSessionId = computed(() => resolvedSessionId.value ?? props.sessionId);

/**
 * Explicitly link this session for steering.
 * This calls session.resume on the SDK — which makes the SDK subprocess (or shared
 * server) load and own the session. In stdio mode this is a SEPARATE process from
 * the user's terminal CLI, so it should only be done intentionally.
 */
async function linkSession(): Promise<boolean> {
  const sid = props.sessionId;
  if (!sid || !sdk.isConnected) return false;
  // Already linked — no-op
  const existing = sdk.sessions.find((s) => s.sessionId === sid);
  if (existing?.isActive) {
    resolvedSessionId.value = sid;
    return true;
  }
  if (resolvedSessionId.value) {
    const resolved = sdk.sessions.find((s) => s.sessionId === resolvedSessionId.value);
    if (resolved?.isActive) return true;
  }

  resuming.value = true;
  sessionError.value = null;
  try {
    const result = await sdk.resumeSession(sid);
    if (!result) {
      sessionError.value = friendlyError(sdk.lastError ?? "Could not link session");
    } else {
      resolvedSessionId.value = result.sessionId;
      logInfo("[sdk] Session linked for steering:", result.sessionId);
    }
    return result !== null;
  } catch (e) {
    logWarn("[sdk] session link failed", e);
    const raw = e instanceof Error ? e.message : String(e);
    sessionError.value = friendlyError(raw);
    return false;
  } finally {
    resuming.value = false;
  }
}

// NO auto-resume — linking is an explicit user action to avoid interfering
// with sessions that are actively running in a terminal CLI.

// Reset resolved ID when session changes
watch(
  () => props.sessionId,
  () => {
    resolvedSessionId.value = null;
    sessionError.value = null;
    sentMessages.value = [];
  },
);

function clearError() {
  sessionError.value = null;
  sdk.lastError = null;
}

/** The error to show inline (session-specific first, then global). */
const inlineError = computed(() => sessionError.value ?? null);

// ─── Actions ────────────────────────────────────────────────────

/** Force-refresh the conversation turns after a short delay. */
function scheduleRefresh(delayMs = 500) {
  setTimeout(async () => {
    try {
      await detail.refreshAll();
    } catch {
      // Silently ignore — the regular poll will catch up
    }
  }, delayMs);
}

/** Parse SDK/session errors into user-friendly messages with actionable guidance. */
function friendlyError(raw: string): string {
  if (raw.includes("Session file is corrupted") || raw.includes("corrupted")) {
    const lineMatch = raw.match(/line (\d+)/);
    const modeHint = sdk.isTcpMode
      ? "Even in --ui-server mode, the server validates session data with its own CLI version."
      : "The SDK's subprocess CLI version differs from the one that wrote this session.";
    return `Session schema mismatch${lineMatch ? ` at line ${lineMatch[1]}` : ""} — ${modeHint} TracePilot can still observe this session normally, but cannot steer it. Try updating your Copilot CLI, or start a new session.`;
  }
  if (raw.includes("Session not found") || raw.includes("not found")) {
    const idMatch = raw.match(/([a-f0-9-]{8,})/);
    const shortId = idMatch ? `${idMatch[1].slice(0, 8)}…` : "this session";
    return `${shortId} is not available for steering. It may have ended or its files were removed.`;
  }
  if (raw.includes("not connected") || raw.includes("No client")) {
    return "SDK is not connected. Check Settings → Copilot SDK Bridge.";
  }
  return raw;
}

async function handleSend() {
  const text = prompt.value.trim();
  if (!text || !props.sessionId || !isLinked.value) return;

  sessionError.value = null;

  // Add optimistic entry to sent log
  const id = ++sentIdCounter;
  const msg: SentMessage = { id, text, timestamp: Date.now(), status: "sending" };
  sentMessages.value = [msg, ...sentMessages.value].slice(0, MAX_SENT_LOG);

  const turnId = await sdk.sendMessage(effectiveSessionId.value!, { prompt: text });
  if (turnId !== null) {
    updateSentMessage(id, { status: "sent", turnId });
    prompt.value = "";
    emit("messageSent", text);
    logInfo("[sdk] Message sent", { turnId, sessionId: effectiveSessionId.value });
    await nextTick();
    autoResize();
    inputEl.value?.focus();

    // Auto-dismiss after 4 seconds
    autoRemoveSent(id, 4000);
    // Force-refresh conversation to pick up new events
    scheduleRefresh(800);
    scheduleRefresh(3000);
  } else if (sdk.lastError) {
    updateSentMessage(id, { status: "error", error: friendlyError(sdk.lastError) });
    sessionError.value = friendlyError(sdk.lastError);
    autoRemoveSent(id, 8000);
  }
}

async function handleModeChange(mode: BridgeSessionMode) {
  if (!props.sessionId || !isLinked.value) return;
  sessionError.value = null;
  await sdk.setSessionMode(effectiveSessionId.value!, mode);
  scheduleRefresh(500);
}

async function handleModelSelect(modelId: string) {
  if (!props.sessionId || !isLinked.value) return;
  modelDropdownOpen.value = false;
  sessionError.value = null;
  await sdk.setSessionModel(effectiveSessionId.value!, modelId);
}

async function handleAbort() {
  if (!props.sessionId || !isLinked.value) return;
  sessionError.value = null;
  await sdk.abortSession(effectiveSessionId.value!);
  scheduleRefresh(500);
}

/** Stop (destroy) the SDK session — unlinks it from the bridge. */
async function handleStopSession() {
  const sid = effectiveSessionId.value;
  if (!sid) return;
  sessionError.value = null;
  await sdk.destroySession(sid);
  resolvedSessionId.value = null;
  logInfo("[sdk] Session stopped/unlinked:", sid);
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    handleSend();
  }
}

function autoResize() {
  const el = inputEl.value;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, maxInputHeight)}px`;
}

const maxInputHeight = 4 * 20 + 10; // ~4 lines

watch(prompt, () => nextTick(autoResize));

function toggleModelDropdown() {
  modelDropdownOpen.value = !modelDropdownOpen.value;
  if (modelDropdownOpen.value) {
    nextTick(updateDropdownPosition);
  }
}

function closeModelDropdown(event: MouseEvent) {
  const target = event.target as HTMLElement;
  if (!target.closest(".cb-model-selector")) {
    modelDropdownOpen.value = false;
  }
}

// Close dropdown when clicking outside
if (typeof document !== "undefined") {
  document.addEventListener("click", closeModelDropdown);
  onBeforeUnmount(() => {
    document.removeEventListener("click", closeModelDropdown);
  });
}

async function handleConnect() {
  await sdk.connect({});
}
</script>

<template>
  <!-- Connected + session present: show full command bar -->
  <div v-if="isVisible" class="cb-wrapper">
    <!-- Sent messages log (most recent on top, auto-dismissed) -->
    <TransitionGroup name="cb-sent-fade" tag="div" class="cb-sent-log" v-if="sentMessages.length > 0">
      <div
        v-for="msg in sentMessages"
        :key="msg.id"
        :class="['cb-sent-item', `cb-sent--${msg.status}`]"
      >
        <span class="cb-sent-icon">
          <svg v-if="msg.status === 'sending'" class="cb-spin" viewBox="0 0 16 16" width="12" height="12">
            <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="28" stroke-dashoffset="8" />
          </svg>
          <span v-else-if="msg.status === 'sent'">✓</span>
          <span v-else>✕</span>
        </span>
        <span class="cb-sent-text">{{ msg.text }}</span>
        <span v-if="msg.status === 'sending'" class="cb-sent-status">sending…</span>
        <span v-else-if="msg.status === 'sent'" class="cb-sent-status cb-sent-ok">sent</span>
        <span v-else class="cb-sent-status cb-sent-err">{{ msg.error ?? 'failed' }}</span>
      </div>
    </TransitionGroup>

    <!-- Session label with stop button -->
    <div v-if="shortSessionId" class="cb-session-label">
      <span class="cb-session-icon">{{ isLinked ? '🔗' : '○' }}</span>
      {{ isLinked ? 'Steering' : 'Not linked' }}
      <span v-if="sdk.connectionMode" class="cb-mode-tag">{{ sdk.connectionMode === 'tcp' ? 'TCP' : 'stdio' }}</span>
      <span class="cb-session-id">{{ shortSessionId }}</span>
      <button
        v-if="isLinked"
        class="cb-btn-stop"
        title="Stop steering this session"
        @click="handleStopSession"
      >
        <svg viewBox="0 0 16 16" fill="currentColor" width="10" height="10">
          <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z"/>
        </svg>
        Unlink
      </button>
    </div>

    <!-- Inline error banner -->
    <div v-if="inlineError" class="cb-error-banner" @click="clearError">
      <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
        <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm-.75 3.75a.75.75 0 011.5 0v3.5a.75.75 0 01-1.5 0v-3.5zM8 11a1 1 0 110 2 1 1 0 010-2z"/>
      </svg>
      <span class="cb-error-text">{{ inlineError }}</span>
      <button class="cb-error-dismiss" title="Dismiss">✕</button>
    </div>

    <!-- Not-linked state: show link prompt instead of command bar -->
    <div v-if="!isLinked && !resuming" class="cb-link-prompt">
      <div class="cb-link-info">
        <div class="cb-link-title">Link for Steering</div>
        <div class="cb-link-desc">
          {{ sdk.connectionMode === 'tcp'
            ? 'Attach to this session on the shared server to send messages and change settings.'
            : 'This creates a separate CLI subprocess to steer this session. The session must not be actively running in a terminal.' }}
        </div>
      </div>
      <button class="cb-btn-link" :disabled="resuming" @click="linkSession">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
          <path d="M10 2h4v4" /><path d="M14 2L8 8" /><path d="M12 9v4a1 1 0 01-1 1H3a1 1 0 01-1-1V5a1 1 0 011-1h4" />
        </svg>
        Link Session
      </button>
    </div>

    <!-- Linking in progress -->
    <div v-else-if="resuming" class="cb-link-prompt">
      <div class="cb-link-info">
        <svg class="cb-spin" viewBox="0 0 16 16" width="14" height="14">
          <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="28" stroke-dashoffset="8" />
        </svg>
        <span>Linking session…</span>
      </div>
    </div>

    <!-- Command bar (only when linked) -->
    <div v-else class="cb-bar">
      <!-- Top row: status dot + input + actions -->
      <div class="cb-main">
        <div class="cb-status-dot-wrap" :title="`SDK: ${sdk.connectionState}`">
          <span :class="['cb-status-dot', `cb-dot--${sdk.connectionState}`]" />
        </div>

        <div class="cb-input-wrap">
          <textarea
            ref="inputEl"
            v-model="prompt"
            class="cb-input"
            placeholder="Send a message to steer the session…"
            rows="1"
            :disabled="sdk.sendingMessage"
            @keydown="handleKeydown"
          />
        </div>

        <div class="cb-actions">
          <!-- Abort (only during active sending) -->
          <button
            :class="['cb-btn-abort', { visible: sdk.sendingMessage }]"
            title="Abort session"
            @click="handleAbort"
          >
            <svg viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="1.5" /></svg>
          </button>

          <!-- Send — arrow-up icon -->
          <button
            :class="['cb-btn-send', { 'has-text': hasText }]"
            :disabled="!hasText || sdk.sendingMessage"
            title="Send (Ctrl+Enter)"
            @click="handleSend"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M8 12V4" /><path d="M4 8l4-4 4 4" />
            </svg>
          </button>
        </div>
      </div>

      <!-- Toolbar: mode pills + model selector + kbd hint -->
      <div class="cb-toolbar">
        <div class="cb-mode-pills">
          <button
            v-for="m in modes"
            :key="m.value"
            :class="['cb-mode-pill', { active: currentMode === m.value }]"
            :title="m.label"
            @click="handleModeChange(m.value)"
          >
            <span class="cb-pill-emoji">{{ m.icon }}</span>
            <span>{{ m.label }}</span>
          </button>
        </div>

        <!-- Model selector (dropdown opens upward, positioned outside overflow) -->
        <div class="cb-model-selector">
          <button
            :class="['cb-model-btn', { open: modelDropdownOpen }]"
            @click.stop="toggleModelDropdown"
          >
            <span class="cb-model-name">{{ shortModel ?? "model" }}</span>
            <svg viewBox="0 0 12 12" width="12" height="12">
              <path d="M3 7l3-3 3 3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>

          <Teleport to="body">
            <div
              v-if="modelDropdownOpen"
              ref="modelDropdownEl"
              class="cb-model-dropdown-portal"
              :style="modelDropdownStyle"
            >
              <button
                v-for="model in sdk.models"
                :key="model.id"
                :class="['cb-model-option', { active: currentModel === model.id }]"
                @click="handleModelSelect(model.id)"
              >
                <span>{{ model.name ?? model.id }}</span>
                <span class="cb-check">✓</span>
              </button>
              <div v-if="sdk.models.length === 0" class="cb-model-empty">
                No models available
              </div>
            </div>
          </Teleport>
        </div>

        <span class="cb-kbd-hint">
          <kbd class="cb-kbd">Ctrl</kbd>
          <kbd class="cb-kbd">↵</kbd>
        </span>
      </div>
    </div>
  </div>

  <!-- SDK connected but session not linked -->
  <div
    v-else-if="isEnabled && sdk.isConnected && !props.sessionId"
    class="cb-hint"
  >
    <span class="cb-hint-dot" />
    <span class="cb-hint-text">SDK connected — session not linked for steering</span>
  </div>

  <!-- SDK enabled but not connected -->
  <div
    v-else-if="isEnabled && !sdk.isConnected"
    class="cb-wrapper"
  >
    <div class="cb-disconnected">
      <div class="cb-disconnected-icon">
        <svg viewBox="0 0 16 16" fill="currentColor" width="18" height="18">
          <path d="M9.405 1.05c-.413-1.4-2.397-1.4-2.81 0l-.1.34a1.464 1.464 0 01-2.105.872l-.31-.17c-1.283-.698-2.686.705-1.987 1.987l.169.311c.446.82.023 1.841-.872 2.105l-.34.1c-1.4.413-1.4 2.397 0 2.81l.34.1a1.464 1.464 0 01.872 2.105l-.17.31c-.698 1.283.705 2.686 1.987 1.987l.311-.169a1.464 1.464 0 012.105.872l.1.34c.413 1.4 2.397 1.4 2.81 0l.1-.34a1.464 1.464 0 012.105-.872l.31.17c1.283.698 2.686-.705 1.987-1.987l-.169-.311a1.464 1.464 0 01.872-2.105l.34-.1c1.4-.413 1.4-2.397 0-2.81l-.34-.1a1.464 1.464 0 01-.872-2.105l.17-.31c.698-1.283-.705-2.686-1.987-1.987l-.311.169a1.464 1.464 0 01-2.105-.872l-.1-.34zM8 10.93a2.929 2.929 0 110-5.86 2.929 2.929 0 010 5.858z" />
        </svg>
      </div>
      <div class="cb-disconnected-text">
        <div class="cb-disconnected-title">SDK Bridge</div>
        <div class="cb-disconnected-sub">Connect to steer this session in real-time</div>
      </div>
      <button
        class="cb-btn-connect"
        :disabled="sdk.isConnecting"
        @click="handleConnect"
      >
        {{ sdk.isConnecting ? "Connecting…" : "Connect" }}
        <svg v-if="!sdk.isConnecting" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
          <path d="M6 4l4 4-4 4" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
/* ═══════════════════════════════════════════════
   Command Bar — Linear/Raycast inspired
   ═══════════════════════════════════════════════ */

.cb-wrapper {
  padding: 0 16px 12px;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  max-width: 720px;
  margin: 0 auto;
  width: 100%;
}

/* ─── Sent messages log ───────────────────────── */
.cb-sent-log {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 4px 6px;
  max-height: 120px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--border-default) transparent;
}
.cb-sent-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  border-radius: var(--radius-sm);
  font-size: 0.6875rem;
  line-height: 1.4;
  transition: all 0.2s ease;
}
.cb-sent--sending {
  color: var(--accent-fg);
  background: rgba(99, 102, 241, 0.06);
}
.cb-sent--sent {
  color: var(--text-tertiary);
  background: transparent;
}
.cb-sent--error {
  color: var(--danger-fg);
  background: rgba(251, 113, 133, 0.06);
}
.cb-sent-icon {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.625rem;
  line-height: 1;
}
.cb-spin {
  animation: cb-spinner 0.8s linear infinite;
}
@keyframes cb-spinner {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.cb-sent-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: inherit;
}
.cb-sent-status {
  flex-shrink: 0;
  font-size: 0.5625rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.7;
}
.cb-sent-err {
  color: var(--danger-fg);
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-transform: none;
  letter-spacing: normal;
}
.cb-sent-ok {
  color: var(--success-fg);
}

/* TransitionGroup animations */
.cb-sent-fade-enter-active {
  transition: all 0.25s ease-out;
}
.cb-sent-fade-leave-active {
  transition: all 0.15s ease-in;
}
.cb-sent-fade-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.cb-sent-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* ─── Session label ────────────────────────────── */
.cb-session-label {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 0 6px 5px;
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  font-weight: 500;
  letter-spacing: 0.01em;
}
.cb-session-icon {
  font-size: 0.625rem;
}
.cb-session-id {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 0.625rem;
  color: var(--text-secondary);
}
.cb-mode-tag {
  font-size: 0.5625rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0 4px;
  border-radius: 3px;
  background: var(--neutral-subtle);
  color: var(--text-tertiary);
}

/* Stop session button */
.cb-btn-stop {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 1px 7px 1px 5px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-tertiary);
  font-size: 0.5625rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: all var(--transition-fast);
}
.cb-btn-stop:hover {
  border-color: var(--danger-muted);
  color: var(--danger-fg);
  background: rgba(251, 113, 133, 0.06);
}

/* ─── Link prompt (shown before steering) ─────── */
.cb-link-prompt {
  background: var(--canvas-overlay);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  padding: 14px 18px;
  display: flex;
  align-items: center;
  gap: 12px;
  transition: all var(--transition-normal);
}
.cb-link-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.cb-link-title {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-primary);
}
.cb-link-desc {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  line-height: 1.5;
}
.cb-btn-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 16px;
  background: var(--accent-emphasis);
  color: white;
  border: none;
  border-radius: var(--radius-md);
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 1px 8px rgba(99,102,241,0.3);
  transition: all var(--transition-fast);
  font-family: inherit;
  white-space: nowrap;
}
.cb-btn-link:hover {
  box-shadow: 0 2px 16px rgba(99,102,241,0.5);
  transform: translateY(-1px);
}
.cb-btn-link:active {
  transform: translateY(0);
}
.cb-btn-link:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none;
}

/* ─── Command bar container ────────────────────── */
.cb-bar {
  background: var(--canvas-overlay);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg), 0 0 0 1px rgba(255,255,255,0.03);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  display: flex;
  flex-direction: column;
  transition: all var(--transition-normal);
}
.cb-bar:focus-within {
  border-color: var(--border-accent);
  box-shadow: var(--shadow-glow-accent), var(--shadow-lg);
}

/* ─── Main row: dot + input + actions ──────────── */
.cb-main {
  display: flex;
  align-items: flex-end;
  gap: 0;
  padding: 6px;
  min-height: 44px;
}

/* Status dot */
.cb-status-dot-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  cursor: help;
}
.cb-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  transition: background var(--transition-normal), box-shadow var(--transition-normal);
}
.cb-dot--connected {
  background: var(--success-fg);
  box-shadow: 0 0 6px rgba(52,211,153,0.5);
}
.cb-dot--connecting {
  background: var(--warning-fg);
  box-shadow: 0 0 6px rgba(251,191,36,0.4);
  animation: cb-pulse 1.5s ease-in-out infinite;
}
.cb-dot--error {
  background: var(--danger-fg);
  box-shadow: 0 0 6px rgba(251,113,133,0.3);
}
.cb-dot--disconnected {
  background: var(--text-placeholder);
}

@keyframes cb-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.6; transform: scale(0.85); }
}

/* Input */
.cb-input-wrap {
  flex: 1;
  display: flex;
  align-items: flex-end;
  min-width: 0;
}
.cb-input {
  width: 100%;
  background: transparent;
  border: none;
  outline: none;
  color: var(--text-primary);
  font-family: inherit;
  font-size: 0.8125rem;
  line-height: 1.55;
  resize: none;
  padding: 5px 4px;
  max-height: calc(1.55em * 4 + 10px);
  min-height: calc(1.55em + 10px);
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--border-default) transparent;
}
.cb-input::placeholder {
  color: var(--text-placeholder);
}
.cb-input:disabled {
  opacity: 0.5;
}

/* Actions */
.cb-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  padding-bottom: 1px;
}

/* Abort button */
.cb-btn-abort {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  border: none;
  background: var(--danger-muted);
  color: var(--danger-fg);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition-fast);
  font-family: inherit;
  opacity: 0;
  transform: scale(0.8);
  pointer-events: none;
}
.cb-btn-abort.visible {
  opacity: 1;
  transform: scale(1);
  pointer-events: auto;
}
.cb-btn-abort:hover {
  background: var(--danger-emphasis);
  color: white;
}
.cb-btn-abort svg {
  width: 14px;
  height: 14px;
}

/* Send button */
.cb-btn-send {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  border: none;
  background: var(--accent-muted);
  color: var(--accent-fg);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition-fast);
  font-family: inherit;
  position: relative;
  overflow: hidden;
}
.cb-btn-send:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.cb-btn-send.has-text {
  background: var(--accent-emphasis);
  color: white;
  box-shadow: 0 1px 8px rgba(99,102,241,0.3);
}
.cb-btn-send:not(:disabled):hover {
  box-shadow: 0 2px 12px rgba(99,102,241,0.4);
  transform: scale(1.05);
}
.cb-btn-send:not(:disabled):active {
  transform: scale(0.95);
}
.cb-btn-send svg {
  width: 15px;
  height: 15px;
  position: relative;
  z-index: 1;
  transition: transform var(--transition-fast);
}
.cb-btn-send:not(:disabled):hover svg {
  transform: translateY(-1px);
}

/* ─── Toolbar: modes + model + kbd hint ────────── */
.cb-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px 6px;
  border-top: 1px solid var(--border-subtle);
}

/* Mode pills */
.cb-mode-pills {
  display: flex;
  align-items: center;
  gap: 2px;
  background: rgba(255,255,255,0.03);
  border-radius: var(--radius-md);
  padding: 2px;
}
.cb-mode-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: var(--radius-sm);
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 0.6875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-fast);
  font-family: inherit;
  white-space: nowrap;
}
.cb-mode-pill:hover {
  color: var(--text-secondary);
  background: rgba(255,255,255,0.04);
}
.cb-mode-pill.active {
  color: var(--accent-fg);
  background: var(--accent-muted);
}
.cb-pill-emoji {
  font-size: 0.6875rem;
  line-height: 1;
}

/* Model selector */
.cb-model-selector {
  position: relative;
  margin-left: 4px;
}
.cb-model-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 0.6875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-fast);
  font-family: inherit;
}
.cb-model-btn:hover {
  background: rgba(255,255,255,0.04);
  color: var(--text-secondary);
}
.cb-model-name {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 0.625rem;
}
.cb-model-btn svg {
  width: 12px;
  height: 12px;
  transition: transform var(--transition-fast);
}
.cb-model-btn.open svg {
  transform: rotate(180deg);
}

/* Model dropdown — removed, now uses portal (see global styles below) */

/* Keyboard hint */
.cb-kbd-hint {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 3px;
  user-select: none;
}
.cb-kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(255,255,255,0.06);
  border: 1px solid var(--border-muted);
  font-family: inherit;
  font-size: 0.5625rem;
  color: var(--text-tertiary);
  line-height: 1.4;
}

/* ─── Disconnected card ────────────────────────── */
.cb-disconnected {
  background: var(--canvas-overlay);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  padding: 14px 18px;
  display: flex;
  align-items: center;
  gap: 12px;
  transition: all var(--transition-normal);
}
.cb-disconnected-icon {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-md);
  background: var(--neutral-subtle);
  border: 1px solid var(--border-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.cb-disconnected-text {
  flex: 1;
  min-width: 0;
}
.cb-disconnected-title {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 1px;
}
.cb-disconnected-sub {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}
.cb-btn-connect {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 16px;
  background: var(--accent-emphasis);
  color: white;
  border: none;
  border-radius: var(--radius-md);
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 1px 8px rgba(99,102,241,0.3);
  transition: all var(--transition-fast);
  font-family: inherit;
  white-space: nowrap;
}
.cb-btn-connect:hover {
  box-shadow: 0 2px 16px rgba(99,102,241,0.5);
  transform: translateY(-1px);
}
.cb-btn-connect:active {
  transform: translateY(0);
}
.cb-btn-connect:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none;
}

/* ─── Hint bar (connected but unlinked) ────────── */
.cb-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px;
  color: var(--text-tertiary);
  font-size: 0.6875rem;
}
.cb-hint-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--success-fg);
  box-shadow: 0 0 4px rgba(52,211,153,0.4);
  flex-shrink: 0;
}

/* ─── Error banner ─────────────────────────────── */
.cb-error-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  margin-bottom: 6px;
  background: rgba(251, 113, 133, 0.08);
  border: 1px solid rgba(251, 113, 133, 0.2);
  border-radius: var(--radius-md);
  color: var(--danger-fg);
  font-size: 0.6875rem;
  cursor: pointer;
  transition: all var(--transition-fast);
}
.cb-error-banner:hover {
  background: rgba(251, 113, 133, 0.12);
}
.cb-error-banner svg {
  flex-shrink: 0;
  opacity: 0.7;
}
.cb-error-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cb-error-dismiss {
  background: none;
  border: none;
  color: var(--danger-fg);
  font-size: 0.625rem;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 3px;
  opacity: 0.6;
  transition: opacity var(--transition-fast);
  font-family: inherit;
}
.cb-error-dismiss:hover {
  opacity: 1;
}
</style>

<!-- Teleported dropdown needs global (non-scoped) styles -->
<style>
.cb-model-dropdown-portal {
  overflow-y: auto;
  background: var(--canvas-overlay, #18181b);
  border: 1px solid var(--border-default, #27272a);
  border-radius: var(--radius-md, 8px);
  box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  padding: 4px;
  animation: cb-dropdown-in 0.12s ease-out;
}
@keyframes cb-dropdown-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
.cb-model-dropdown-portal .cb-model-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  border-radius: var(--radius-sm, 6px);
  border: none;
  background: transparent;
  color: var(--text-secondary, #a1a1aa);
  font-size: 0.75rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.1s;
  font-family: inherit;
  width: 100%;
  text-align: left;
}
.cb-model-dropdown-portal .cb-model-option:hover {
  background: rgba(255,255,255,0.05);
  color: var(--text-primary, #fafafa);
}
.cb-model-dropdown-portal .cb-model-option.active {
  color: var(--accent-fg, #818cf8);
}
.cb-model-dropdown-portal .cb-check {
  opacity: 0;
  color: var(--accent-fg, #818cf8);
  font-size: 0.75rem;
}
.cb-model-dropdown-portal .cb-model-option.active .cb-check {
  opacity: 1;
}
.cb-model-dropdown-portal .cb-model-empty {
  padding: 8px 10px;
  font-size: 0.6875rem;
  color: var(--text-placeholder, #52525b);
  text-align: center;
}
</style>
