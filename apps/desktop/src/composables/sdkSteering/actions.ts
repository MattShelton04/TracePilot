import type { BridgeSessionMode } from "@tracepilot/types";
import type { ComponentPublicInstance } from "vue";
import { nextTick, watch } from "vue";
import { logInfo, logWarn } from "@/utils/logger";
import { MAX_INPUT_HEIGHT, MAX_SENT_LOG, type SdkSteeringState, type SentMessage } from "./state";

/**
 * IPC action handlers for `useSdkSteering`.
 *
 * Owns the user-triggered IPC orchestration documented in the shell's
 * top-of-file comment. Pure functions over the state container — no
 * extra refs beyond a private id counter and the w2 textarea watcher.
 *
 * `withLinkedSession` centralises the `effectiveSessionId` null-check and
 * `isLinked` gate. It returns a sentinel (`SKIPPED`) when the session is
 * not linked, so callers can distinguish "no-op, do nothing" from "ran
 * and returned undefined" — the latter is normal for `setSessionMode`,
 * `abortSession`, etc. (Phase-2 of the tech-debt cleanup originally used
 * a plain `undefined` here, which inadvertently bypassed the -32601
 * error branch in `handleModeChange`; restored here.)
 */

const SKIPPED: unique symbol = Symbol("withLinkedSession.skipped");
type Skipped = typeof SKIPPED;

function isErrorEnvelope(value: unknown): value is { code?: number; message?: string } {
  return typeof value === "object" && value !== null && ("code" in value || "message" in value);
}

function looksLikeUnhandledMethod(value: unknown): boolean {
  if (typeof value === "string") {
    return value.includes("-32601") || value.includes("Unhandled method");
  }
  if (isErrorEnvelope(value)) {
    if (value.code === -32601) return true;
    const msg = value.message ?? "";
    return (
      msg.includes("-32601") ||
      msg.includes("Unhandled method") ||
      msg.toLowerCase().includes("method not found")
    );
  }
  return false;
}

export interface SdkSteeringActions {
  linkSession: () => Promise<boolean>;
  handleSend: () => Promise<void>;
  handleModeChange: (mode: BridgeSessionMode) => Promise<void>;
  handleAbort: () => Promise<void>;
  handleUnlinkSession: () => void;
  handleShutdownSession: () => Promise<void>;
  handleKeydown: (event: KeyboardEvent) => void;
  handleConnect: () => Promise<void>;
  clearError: () => void;
  autoResize: () => void;
  setInputEl: (el: Element | ComponentPublicInstance | null) => void;
  selectPendingModel: (id: string | null) => void;
}

export function useSdkSteeringActions(state: SdkSteeringState): SdkSteeringActions {
  const {
    sdk,
    detail,
    sessionIdRef,
    sessionCwdRef,
    onMessageSent,
    prompt,
    inputEl,
    userLinked,
    userUnlinked,
    pendingModel,
    showModelPicker,
    sentMessages,
    sessionError,
    resuming,
    resolvedSessionId,
    effectiveSessionId,
    isLinked,
  } = state;

  let sentIdCounter = 0;

  function updateSentMessage(id: number, update: Partial<SentMessage>) {
    sentMessages.value = sentMessages.value.map((m) => (m.id === id ? { ...m, ...update } : m));
  }

  function autoRemoveSent(id: number, delayMs: number) {
    setTimeout(() => {
      sentMessages.value = sentMessages.value.filter((m) => m.id !== id);
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

  function clearError() {
    sessionError.value = null;
    sdk.lastError = null;
  }

  /**
   * Run `fn` with the current effective session id only when the session
   * is actually linked. Returns `SKIPPED` when no-op so callers can tell
   * "didn't run" apart from "ran and returned undefined".
   */
  async function withLinkedSession<T>(fn: (sid: string) => Promise<T>): Promise<T | Skipped> {
    const sid = effectiveSessionId.value;
    if (!sid || !isLinked.value) return SKIPPED;
    sessionError.value = null;
    return fn(sid);
  }

  function scheduleRefresh(delayMs = 500) {
    setTimeout(async () => {
      try {
        await detail.refreshAll();
      } catch {
        // Silently ignore — the regular poll will catch up
      }
    }, delayMs);
  }

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
      userUnlinked.value = false;
      return true;
    }
    if (resolvedSessionId.value) {
      const resolved = sdk.sessions.find((s) => s.sessionId === resolvedSessionId.value);
      if (resolved?.isActive) {
        userLinked.value = true;
        userUnlinked.value = false;
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
        userUnlinked.value = false;
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

  async function handleSend() {
    const text = prompt.value.trim();
    if (!text || !sessionIdRef.value || !isLinked.value) return;
    // Avoid creating an optimistic "sending" row that would otherwise be
    // orphaned when the messaging slice's idempotency guard drops a duplicate
    // call (e.g. Send double-tap or Ctrl+Enter racing a click).
    if (sdk.isSending(effectiveSessionId.value)) return;

    const id = ++sentIdCounter;
    const msg: SentMessage = { id, text, timestamp: Date.now(), status: "sending" };
    sentMessages.value = [msg, ...sentMessages.value].slice(0, MAX_SENT_LOG);

    const turnId = await withLinkedSession((sid) => sdk.sendMessage(sid, { prompt: text }));
    if (turnId === SKIPPED) {
      // Session was unlinked between guard and dispatch — drop optimistic row.
      sentMessages.value = sentMessages.value.filter((m) => m.id !== id);
      return;
    }
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
    sdk.lastError = null;
    const result = await withLinkedSession((sid) => sdk.setSessionMode(sid, mode));
    if (result === SKIPPED) return;

    // Restore the -32601 / "Unhandled method" branch dropped by phase-2 of the
    // tech-debt cleanup. `setSessionMode` may signal failure two ways:
    //   1. Resolves to an error envelope `{ code: -32601, message }`.
    //   2. Resolves to void/null and writes the raw JSON-RPC error to
    //      `sdk.lastError` (e.g. "JSON-RPC error -32601 Unhandled method").
    if (looksLikeUnhandledMethod(result) || looksLikeUnhandledMethod(sdk.lastError)) {
      sessionError.value = "Mode switching not supported by this CLI version.";
      sdk.lastError = null;
      return;
    }

    const err = sdk.lastError as string | null;
    if (err) {
      sessionError.value = `Mode switch failed: ${err}`;
    } else {
      scheduleRefresh(500);
    }
  }

  async function handleAbort() {
    const result = await withLinkedSession((sid) => sdk.abortSession(sid));
    if (result === SKIPPED) return;
    scheduleRefresh(500);
  }

  /** Unlink — purely Vue state reset. Session stays alive in bridge + subprocess. */
  function handleUnlinkSession() {
    userLinked.value = false;
    userUnlinked.value = true;
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
    userUnlinked.value = false;
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

  // w2: MUST remain registered after w1 — see state.ts ordering note.
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

  return {
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
  };
}
