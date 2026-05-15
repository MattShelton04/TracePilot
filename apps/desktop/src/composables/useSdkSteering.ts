import type { InjectionKey } from "vue";
import { inject, reactive } from "vue";
import { useSdkSteeringActions } from "./sdkSteering/actions";
import { useModelPicker } from "./sdkSteering/modelPicker";
import { type SdkSteeringState, useSdkSteeringState } from "./sdkSteering/state";

export type { SentMessage, UseSdkSteeringOptions } from "./sdkSteering/state";

import type { UseSdkSteeringOptions } from "./sdkSteering/state";

/**
 * useSdkSteering — state machine + IPC orchestration for `SdkSteeringPanel`.
 *
 * Extracted from `components/conversation/SdkSteeringPanel.vue` in Wave 38,
 * then split (tech-debt Phase 6) into three sibling modules:
 *
 *   - `sdkSteering/state.ts`       — refs, computeds, watchers (w1).
 *   - `sdkSteering/actions.ts`     — IPC handlers + `withLinkedSession`
 *                                    helper. Owns w2 (prompt → autoResize).
 *   - `sdkSteering/modelPicker.ts` — ref-based dropdown positioning.
 *
 * Public surface (the `reactive(...)` object below) is unchanged — the
 * children under `./sdkSteering/` and `SdkSteeringPanel.vue` consume it
 * via `provide`/`inject` (`SdkSteeringKey` + `useSdkSteeringContext`).
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
 */

export function useSdkSteering(options: UseSdkSteeringOptions) {
  // Order matters: state.ts registers w1; actions.ts registers w2 AFTER.
  // See `sdkSteering/state.ts` for the "MUST NOT be reordered" note.
  const state: SdkSteeringState = useSdkSteeringState(options);
  const modelPicker = useModelPicker(state.showModelPicker);
  const actions = useSdkSteeringActions(state);

  return reactive({
    // stores (exposed for templates)
    sdk: state.sdk,
    // local state
    prompt: state.prompt,
    inputEl: state.inputEl,
    userLinked: state.userLinked,
    userUnlinked: state.userUnlinked,
    pendingModel: state.pendingModel,
    showModelPicker: state.showModelPicker,
    sentMessages: state.sentMessages,
    sessionError: state.sessionError,
    resuming: state.resuming,
    resolvedSessionId: state.resolvedSessionId,
    // computed
    isEnabled: state.isEnabled,
    isVisible: state.isVisible,
    isLinked: state.isLinked,
    hasActiveSdkHandle: state.hasActiveSdkHandle,
    linkedSession: state.linkedSession,
    effectiveSessionId: state.effectiveSessionId,
    modelPickerStyle: modelPicker.modelPickerStyle,
    currentMode: state.currentMode,
    currentModel: state.currentModel,
    inferredModel: state.inferredModel,
    liveState: state.liveState,
    hasText: state.hasText,
    sending: state.sending,
    shortSessionId: state.shortSessionId,
    inlineError: state.inlineError,
    modes: state.modes,
    // actions
    linkSession: actions.linkSession,
    handleSend: actions.handleSend,
    handleModeChange: actions.handleModeChange,
    handleAbort: actions.handleAbort,
    handleUnlinkSession: actions.handleUnlinkSession,
    handleShutdownSession: actions.handleShutdownSession,
    handleKeydown: actions.handleKeydown,
    handleConnect: actions.handleConnect,
    clearError: actions.clearError,
    autoResize: actions.autoResize,
    setInputEl: actions.setInputEl,
    selectPendingModel: actions.selectPendingModel,
    toggleModelPicker: modelPicker.toggleModelPicker,
    setModelPickerTrigger: modelPicker.setModelPickerTrigger,
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
