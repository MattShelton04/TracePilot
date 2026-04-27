import type { BridgeSessionMode, SessionLiveState } from "@tracepilot/types";
import type { ComponentPublicInstance, CSSProperties, InjectionKey, Ref } from "vue";
import { computed, inject, nextTick, onBeforeUnmount, reactive, ref, watch } from "vue";
import { useSessionDetailContext } from "@/composables/useSessionDetailContext";
import { usePreferencesStore } from "@/stores/preferences";
import { useSdkStore } from "@/stores/sdk";
import { logInfo, logWarn } from "@/utils/logger";

/**
 * useSdkSteering — state machine + IPC orchestration for `SdkSteeringPanel`.
 *
 * Extracted from `components/conversation/SdkSteeringPanel.vue` in Wave 38.
 * Behaviour is preserved byte-for-byte; the shell provides a single instance
 * of this composable which the children consume via `provide`/`inject`
 * (`SdkSteeringKey` + `useSdkSteeringContext`).
 *
 * ── User-triggered IPC calls (inventory) ───────────────────────────
 *   1. `linkSession()`        → `sdk.resumeSession(sid, cwd, model)`
 *        ▸ Triggered by the "Link Session" button in the link prompt.
 *        ▸ NEVER called automatically — session.resume spawns a second
 *          CLI subprocess that writes to the same events.jsonl and
 *          corrupts the session if auto-triggered. This must stay a
 *          purely explicit user action.
 *   2. `handleSend()`         → `sdk.sendMessage(effective, { prompt })`
 *        ▸ Triggered by Send button or Ctrl/Cmd+Enter in the textarea.
 *   3. `handleModeChange(m)`  → `sdk.setSessionMode(effective, m)`
 *        ▸ Triggered by the mode pill buttons (Ask / Plan / Auto).
 *   4. `handleAbort()`        → `sdk.abortSession(effective)`
 *        ▸ Triggered by the abort button (visible while sending).
 *   5. `handleShutdownSession()` → `sdk.destroySession(sid)`
 *        ▸ Triggered by the "Shutdown" button in the session label row.
 *   6. `handleConnect()`      → `sdk.connect({})`
 *        ▸ Triggered by the "Connect" button on the disconnected card.
 *
 * Non-IPC user actions: `handleUnlinkSession` (state reset only —
 * leaves the bridge session alive), `clearError`, pending-model picker.
 *
 * Post-action side-effects: `scheduleRefresh` after send/mode/abort
 * triggers `detail.refreshAll()` — same cadence as the original.
 *
 * ── Watcher ordering (MUST NOT be reordered) ───────────────────────
 *   w1: `watch(sessionIdRef, …)` resets userLinked / resolvedSessionId /
 *       sessionError / sentMessages / pendingModel / showModelPicker.
 *   w2: `watch(prompt, () => nextTick(autoResize))` keeps the textarea
 *       height in sync with the typed content.
 */

export interface UseSdkSteeringOptions {
  sessionIdRef: Ref<string | null>;
  sessionCwdRef: Ref<string | undefined>;
  onMessageSent?: (prompt: string) => void;
}

interface SentMessage {
  id: number;
  text: string;
  timestamp: number;
  status: "sending" | "sent" | "error";
  turnId?: string;
  error?: string;
}

const MAX_SENT_LOG = 5;
const MAX_INPUT_HEIGHT = 4 * 20 + 10; // ~4 lines, matches original

export function useSdkSteering(options: UseSdkSteeringOptions) {
  const { sessionIdRef, sessionCwdRef, onMessageSent } = options;
  const sdk = useSdkStore();
  const prefs = usePreferencesStore();
  const detail = useSessionDetailContext();

  // ─── Local state ──────────────────────────────────────────────
  const prompt = ref("");
  const inputEl = ref<HTMLTextAreaElement | null>(null);
  const userLinked = ref(false);
  /** Model chosen by user before linking — passed to ResumeSessionConfig.model */
  const pendingModel = ref<string | null>(null);
  const showModelPicker = ref(false);

  // ─── Sent messages log ────────────────────────────────────────
  const sentMessages = ref<SentMessage[]>([]);
  let sentIdCounter = 0;

  function updateSentMessage(id: number, update: Partial<SentMessage>) {
    sentMessages.value = sentMessages.value.map((m) => (m.id === id ? { ...m, ...update } : m));
  }

  function autoRemoveSent(id: number, delayMs: number) {
    setTimeout(() => {
      sentMessages.value = sentMessages.value.filter((m) => m.id !== id);
    }, delayMs);
  }

  // ─── Session linking state ───────────────────────────────────
  const sessionError = ref<string | null>(null);
  const resuming = ref(false);
  /** The actual session ID used by the SDK (may differ from props.sessionId after resume). */
  const resolvedSessionId = ref<string | null>(null);

  const effectiveSessionId = computed(() => resolvedSessionId.value ?? sessionIdRef.value);

  // ─── Computed ────────────────────────────────────────────────
  const isEnabled = computed(() => prefs.isFeatureEnabled("copilotSdk"));

  const modelPickerStyle = computed((): CSSProperties => {
    const btn = document.querySelector(".cb-model-pick-btn") as HTMLElement | null;
    if (!btn) return {};
    const rect = btn.getBoundingClientRect();
    const maxH = 240;
    const gap = 6;
    const spaceAbove = rect.top - gap;
    if (spaceAbove >= maxH) {
      return {
        position: "fixed",
        left: `${rect.left}px`,
        bottom: `${window.innerHeight - rect.top + gap}px`,
        minWidth: "220px",
        maxHeight: `${maxH}px`,
        zIndex: 9999,
      };
    }
    return {
      position: "fixed",
      left: `${rect.left}px`,
      top: `${rect.bottom + gap}px`,
      minWidth: "220px",
      maxHeight: `${Math.min(maxH, window.innerHeight - rect.bottom - gap - 8)}px`,
      zIndex: 9999,
    };
  });

  function closeModelPicker(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest(".cb-model-pick-btn") && !target.closest(".cb-model-dropdown-portal")) {
      showModelPicker.value = false;
    }
  }
  if (typeof document !== "undefined") {
    document.addEventListener("click", closeModelPicker);
    onBeforeUnmount(() => {
      document.removeEventListener("click", closeModelPicker);
    });
  }

  const linkedSession = computed(() => {
    const sid = effectiveSessionId.value ?? sessionIdRef.value;
    if (!sid) return null;
    return sdk.sessions.find((s) => s.sessionId === sid) ?? null;
  });

  /** Panel is visible whenever SDK is connected and feature is on (even if session isn't linked yet). */
  const isVisible = computed(() => isEnabled.value && sdk.isConnected && !!sessionIdRef.value);

  /** Whether the session is actively linked AND the user wants to steer it. */
  const isLinked = computed(() => userLinked.value && linkedSession.value?.isActive === true);

  const modes: { value: BridgeSessionMode; label: string; icon: string }[] = [
    { value: "interactive", label: "Ask", icon: "💬" },
    { value: "plan", label: "Plan", icon: "📋" },
    { value: "autopilot", label: "Auto", icon: "🚀" },
  ];

  const currentMode = computed(() => linkedSession.value?.mode ?? "interactive");

  /** Model inferred from existing chat turns when SDK session doesn't provide one. */
  const inferredModel = computed(() => {
    const turns = detail.turns;
    if (!turns?.length) return null;
    for (let i = turns.length - 1; i >= 0; i--) {
      if (turns[i].model) return turns[i].model;
    }
    return null;
  });

  const currentModel = computed(() => linkedSession.value?.model ?? inferredModel.value ?? null);

  const liveState = computed((): SessionLiveState | null => {
    const sid = effectiveSessionId.value;
    return sid ? (sdk.sessionStatesById[sid] ?? null) : null;
  });

  const hasText = computed(() => prompt.value.trim().length > 0);

  const shortSessionId = computed(() => {
    const id = sessionIdRef.value;
    if (!id) return null;
    return id.length > 12 ? `${id.slice(0, 8)}…` : id;
  });

  /**
   * Explicitly link this session for steering.
   * This calls session.resume on the SDK — which makes the SDK subprocess (or shared
   * server) load and own the session. In stdio mode this is a SEPARATE process from
   * the user's terminal CLI, so it should only be done intentionally.
   */
  async function linkSession(): Promise<boolean> {
    const sid = sessionIdRef.value;
    if (!sid || !sdk.isConnected) return false;
    // Already linked — no-op
    const existing = sdk.sessions.find((s) => s.sessionId === sid);
    if (existing?.isActive) {
      resolvedSessionId.value = sid;
      userLinked.value = true;
      return true;
    }
    if (resolvedSessionId.value) {
      const resolved = sdk.sessions.find((s) => s.sessionId === resolvedSessionId.value);
      if (resolved?.isActive) {
        userLinked.value = true;
        return true;
      }
    }

    resuming.value = true;
    sessionError.value = null;
    try {
      const result = await sdk.resumeSession(
        sid,
        sessionCwdRef.value,
        pendingModel.value ?? undefined,
      );
      if (!result) {
        sessionError.value = friendlyError(sdk.lastError ?? "Could not link session");
      } else {
        resolvedSessionId.value = result.sessionId;
        userLinked.value = true;
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

  // w1: Reset resolved ID when session changes (see top-of-file ordering note).
  watch(sessionIdRef, () => {
    userLinked.value = false;
    resolvedSessionId.value = null;
    sessionError.value = null;
    sentMessages.value = [];
    pendingModel.value = null;
    showModelPicker.value = false;
  });

  function clearError() {
    sessionError.value = null;
    sdk.lastError = null;
  }

  const inlineError = computed(() => sessionError.value ?? sdk.lastError ?? null);

  // ─── Actions ────────────────────────────────────────────────

  function scheduleRefresh(delayMs = 500) {
    setTimeout(async () => {
      try {
        await detail.refreshAll();
      } catch {
        // Silently ignore — the regular poll will catch up
      }
    }, delayMs);
  }

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
    if (!text || !sessionIdRef.value || !isLinked.value) return;

    sessionError.value = null;

    const id = ++sentIdCounter;
    const msg: SentMessage = { id, text, timestamp: Date.now(), status: "sending" };
    sentMessages.value = [msg, ...sentMessages.value].slice(0, MAX_SENT_LOG);

    // biome-ignore lint/style/noNonNullAssertion: guarded by isLinked.value check in handleSendMessage above.
    const turnId = await sdk.sendMessage(effectiveSessionId.value!, { prompt: text });
    if (turnId !== null) {
      updateSentMessage(id, { status: "sent", turnId });
      prompt.value = "";
      onMessageSent?.(text);
      logInfo("[sdk] Message sent", { turnId, sessionId: effectiveSessionId.value });
      await nextTick();
      autoResize();
      inputEl.value?.focus();

      autoRemoveSent(id, 4000);
      scheduleRefresh(800);
      scheduleRefresh(3000);
    } else if (sdk.lastError) {
      updateSentMessage(id, { status: "error", error: friendlyError(sdk.lastError) });
      sessionError.value = friendlyError(sdk.lastError);
      autoRemoveSent(id, 8000);
    }
  }

  async function handleModeChange(mode: BridgeSessionMode) {
    if (!sessionIdRef.value || !isLinked.value) return;
    sessionError.value = null;
    sdk.lastError = null;
    // biome-ignore lint/style/noNonNullAssertion: early-return above ensures sessionIdRef/isLinked are set.
    await sdk.setSessionMode(effectiveSessionId.value!, mode);
    const err = sdk.lastError as string | null;
    if (err) {
      if (err.includes("-32601") || err.includes("Unhandled method")) {
        sessionError.value = "Mode switching not supported by this CLI version.";
        sdk.lastError = null;
      } else {
        sessionError.value = `Mode switch failed: ${err}`;
      }
    } else {
      scheduleRefresh(500);
    }
  }

  async function handleAbort() {
    if (!sessionIdRef.value || !isLinked.value) return;
    sessionError.value = null;
    // biome-ignore lint/style/noNonNullAssertion: early-return above ensures sessionIdRef/isLinked are set.
    await sdk.abortSession(effectiveSessionId.value!);
    scheduleRefresh(500);
  }

  /** Unlink — purely Vue state reset. Session stays alive in bridge + subprocess. */
  function handleUnlinkSession() {
    userLinked.value = false;
    resolvedSessionId.value = null;
    sessionError.value = null;
    sentMessages.value = [];
    logInfo("[sdk] Session unlinked (kept alive in bridge):", sessionIdRef.value);
  }

  /** Shutdown the session — writes shutdown event, removes from bridge. */
  async function handleShutdownSession() {
    const sid = effectiveSessionId.value;
    if (!sid) return;
    sessionError.value = null;
    await sdk.destroySession(sid);
    userLinked.value = false;
    resolvedSessionId.value = null;
    sentMessages.value = [];
    logInfo("[sdk] Session shut down:", sid);
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
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_HEIGHT)}px`;
  }

  // w2: MUST remain registered after w1 — see top-of-file ordering note.
  watch(prompt, () => nextTick(autoResize));

  async function handleConnect() {
    await sdk.connect({});
  }

  function setInputEl(el: Element | ComponentPublicInstance | null) {
    inputEl.value = el as HTMLTextAreaElement | null;
  }

  function selectPendingModel(id: string | null) {
    pendingModel.value = id;
    showModelPicker.value = false;
  }

  function toggleModelPicker() {
    showModelPicker.value = !showModelPicker.value;
  }

  return reactive({
    // stores (exposed for templates)
    sdk,
    // local state
    prompt,
    inputEl,
    userLinked,
    pendingModel,
    showModelPicker,
    sentMessages,
    sessionError,
    resuming,
    resolvedSessionId,
    // computed
    isEnabled,
    isVisible,
    isLinked,
    linkedSession,
    effectiveSessionId,
    modelPickerStyle,
    currentMode,
    currentModel,
    inferredModel,
    liveState,
    hasText,
    shortSessionId,
    inlineError,
    modes,
    // actions
    linkSession,
    handleSend,
    handleModeChange,
    handleAbort,
    handleUnlinkSession,
    handleShutdownSession,
    handleKeydown,
    handleConnect,
    clearError,
    autoResize,
    setInputEl,
    selectPendingModel,
    toggleModelPicker,
  });
}

export type SdkSteeringContext = ReturnType<typeof useSdkSteering>;

export const SdkSteeringKey: InjectionKey<SdkSteeringContext> = Symbol("SdkSteeringContext");

export function useSdkSteeringContext(): SdkSteeringContext {
  const ctx = inject(SdkSteeringKey, null);
  if (!ctx) {
    throw new Error(
      "useSdkSteeringContext() must be called inside a component that provides SdkSteeringKey",
    );
  }
  return ctx;
}
