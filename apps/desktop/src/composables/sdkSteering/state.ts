import type { BridgeSessionMode, SessionLiveState } from "@tracepilot/types";
import type { ComputedRef, Ref } from "vue";
import { computed, ref, watch } from "vue";
import { useSessionDetailContext } from "@/composables/useSessionDetailContext";
import { usePreferencesStore } from "@/stores/preferences";
import { useSdkStore } from "@/stores/sdk";

/**
 * Reactive state container for `useSdkSteering`.
 *
 * Owns ALL refs / computeds / watchers consumed by the actions and
 * model-picker layers. No IPC, no DOM querying.
 *
 * ── Watcher ordering (MUST NOT be reordered) ───────────────────────
 *   w1: `watch(sessionIdRef, …)` resets userLinked / resolvedSessionId /
 *       sessionError / sentMessages / pendingModel / showModelPicker.
 *   w2: `watch(prompt, () => nextTick(autoResize))` keeps the textarea
 *       height in sync with the typed content. Registered by
 *       `useSdkSteeringActions` because it depends on the autoResize
 *       helper there — but it MUST remain registered AFTER w1, which is
 *       why state.ts is constructed before actions.ts in the shell.
 */

export interface UseSdkSteeringOptions {
  sessionIdRef: Ref<string | null>;
  sessionCwdRef: Ref<string | undefined>;
  onMessageSent?: (prompt: string) => void;
}

export interface SentMessage {
  id: number;
  text: string;
  timestamp: number;
  status: "sending" | "sent" | "error";
  turnId?: string;
  error?: string;
}

export { MAX_INPUT_HEIGHT, MAX_SENT_LOG } from "@/config/sdkSteering";

export interface SdkSteeringState {
  // Injected stores / context
  sdk: ReturnType<typeof useSdkStore>;
  prefs: ReturnType<typeof usePreferencesStore>;
  detail: ReturnType<typeof useSessionDetailContext>;
  sessionIdRef: Ref<string | null>;
  sessionCwdRef: Ref<string | undefined>;
  onMessageSent?: (prompt: string) => void;

  // Local refs
  prompt: Ref<string>;
  inputEl: Ref<HTMLTextAreaElement | null>;
  userLinked: Ref<boolean>;
  userUnlinked: Ref<boolean>;
  pendingModel: Ref<string | null>;
  showModelPicker: Ref<boolean>;
  sentMessages: Ref<SentMessage[]>;
  sessionError: Ref<string | null>;
  resuming: Ref<boolean>;
  resolvedSessionId: Ref<string | null>;

  // Computeds
  effectiveSessionId: ComputedRef<string | null>;
  isEnabled: ComputedRef<boolean>;
  isVisible: ComputedRef<boolean>;
  linkedSession: ComputedRef<ReturnType<typeof useSdkStore>["sessions"][number] | null>;
  hasActiveSdkHandle: ComputedRef<boolean>;
  isLinked: ComputedRef<boolean>;
  currentMode: ComputedRef<BridgeSessionMode>;
  inferredModel: ComputedRef<string | null>;
  currentModel: ComputedRef<string | null>;
  liveState: ComputedRef<SessionLiveState | null>;
  hasText: ComputedRef<boolean>;
  sending: ComputedRef<boolean>;
  shortSessionId: ComputedRef<string | null>;
  inlineError: ComputedRef<string | null>;
  modes: { value: BridgeSessionMode; label: string; icon: string }[];
}

export function useSdkSteeringState(options: UseSdkSteeringOptions): SdkSteeringState {
  const { sessionIdRef, sessionCwdRef, onMessageSent } = options;
  const sdk = useSdkStore();
  const prefs = usePreferencesStore();
  const detail = useSessionDetailContext();

  // ─── Local state ──────────────────────────────────────────────
  const prompt = ref("");
  const inputEl = ref<HTMLTextAreaElement | null>(null);
  const userLinked = ref(false);
  const userUnlinked = ref(false);
  /** Model chosen by user before linking — passed to ResumeSessionConfig.model */
  const pendingModel = ref<string | null>(null);
  const showModelPicker = ref(false);

  // ─── Sent messages log ────────────────────────────────────────
  const sentMessages = ref<SentMessage[]>([]);

  // ─── Session linking state ───────────────────────────────────
  const sessionError = ref<string | null>(null);
  const resuming = ref(false);
  /** The actual session ID used by the SDK (may differ from props.sessionId after resume). */
  const resolvedSessionId = ref<string | null>(null);

  const effectiveSessionId = computed(() => resolvedSessionId.value ?? sessionIdRef.value);

  // ─── Computed ────────────────────────────────────────────────
  const isEnabled = computed(() => prefs.isFeatureEnabled("copilotSdk"));

  const linkedSession = computed(() => {
    const sid = effectiveSessionId.value ?? sessionIdRef.value;
    if (!sid) return null;
    return sdk.sessions.find((s) => s.sessionId === sid) ?? null;
  });

  /** Panel is visible whenever SDK is connected and feature is on (even if session isn't linked yet). */
  const isVisible = computed(() => isEnabled.value && sdk.isConnected && !!sessionIdRef.value);

  /** Whether the session is actively linked AND the user wants to steer it. */
  const hasActiveSdkHandle = computed(() => linkedSession.value?.isActive === true);
  const isLinked = computed(() => hasActiveSdkHandle.value && !userUnlinked.value);

  const modes: { value: BridgeSessionMode; label: string; icon: string }[] = [
    { value: "interactive", label: "Ask", icon: "message-circle" },
    { value: "plan", label: "Plan", icon: "clipboard-list" },
    { value: "autopilot", label: "Auto", icon: "rocket" },
  ];

  const currentMode = computed<BridgeSessionMode>(
    () => (linkedSession.value?.mode as BridgeSessionMode | undefined) ?? "interactive",
  );

  /** Model inferred from existing chat turns when SDK session doesn't provide one. */
  const inferredModel = computed(() => {
    const turns = detail.turns;
    if (!turns?.length) return null;
    for (let i = turns.length - 1; i >= 0; i--) {
      if (turns[i].model) return turns[i].model ?? null;
    }
    return null;
  });

  const currentModel = computed(() => linkedSession.value?.model ?? inferredModel.value ?? null);

  const liveState = computed((): SessionLiveState | null => {
    const sid = effectiveSessionId.value;
    return sid ? (sdk.sessionStatesById[sid] ?? null) : null;
  });

  const hasText = computed(() => prompt.value.trim().length > 0);

  /** True only while THIS session is mid-send — multiple concurrent sessions
   * (popouts, tabs) can each send independently without disabling each other. */
  const sending = computed(() => sdk.isSending(effectiveSessionId.value));

  const shortSessionId = computed(() => {
    const id = sessionIdRef.value;
    if (!id) return null;
    return id.length > 12 ? `${id.slice(0, 8)}…` : id;
  });

  const inlineError = computed(() => sessionError.value ?? sdk.lastError ?? null);

  // w1: Reset resolved ID when session changes (see top-of-file ordering note).
  watch(sessionIdRef, () => {
    userLinked.value = false;
    userUnlinked.value = false;
    resolvedSessionId.value = null;
    sessionError.value = null;
    sentMessages.value = [];
    pendingModel.value = null;
    showModelPicker.value = false;
  });

  return {
    sdk,
    prefs,
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
    isEnabled,
    isVisible,
    linkedSession,
    hasActiveSdkHandle,
    isLinked,
    currentMode,
    inferredModel,
    currentModel,
    liveState,
    hasText,
    sending,
    shortSessionId,
    inlineError,
    modes,
  };
}
