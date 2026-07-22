import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  contextCaptureCancel,
  contextCaptureDelete,
  contextCaptureGet,
  contextCaptureList,
  contextCapturePreflight,
  contextCaptureStart,
  IPC_EVENTS,
} from "@tracepilot/client";
import type {
  CapturePreflight,
  CaptureProgress,
  CaptureProtocol,
  ContextCaptureSnapshot,
  ContextCaptureSummary,
} from "@tracepilot/types";
import { onBeforeUnmount, type Ref, ref, watch } from "vue";
import { safeListen } from "@/utils/tauriEvents";

const SAVE_DEFAULT_KEY = "tracepilot.contextCapture.saveDefault";

export function useContextCapture(sessionId: Ref<string>) {
  const preflight = ref<CapturePreflight | null>(null);
  const summaries = ref<ContextCaptureSummary[]>([]);
  const snapshot = ref<ContextCaptureSnapshot | null>(null);
  const progress = ref<CaptureProgress | null>(null);
  const loading = ref(false);
  const capturing = ref(false);
  const error = ref<string | null>(null);
  const selectedProtocol = ref<CaptureProtocol>("openAiChatCompletions");
  const storedDefault = localStorage.getItem(SAVE_DEFAULT_KEY);
  const saveSnapshot = ref(storedDefault === "true");
  let unlisten: UnlistenFn | null = null;
  let requestVersion = 0;

  function message(cause: unknown): string {
    if (cause instanceof Error) return cause.message;
    if (typeof cause === "object" && cause && "message" in cause) {
      return String((cause as { message: unknown }).message);
    }
    return String(cause);
  }

  async function setup() {
    if (unlisten) return;
    unlisten = await safeListen<CaptureProgress>(IPC_EVENTS.CONTEXT_CAPTURE_PROGRESS, (event) => {
      if (event.payload.sessionId === sessionId.value) progress.value = event.payload;
    });
  }

  async function loadList() {
    const version = ++requestVersion;
    if (!sessionId.value) return;
    loading.value = true;
    error.value = null;
    try {
      const result = await contextCaptureList(sessionId.value);
      if (version === requestVersion) summaries.value = result;
    } catch (cause) {
      if (version === requestVersion) error.value = message(cause);
    } finally {
      if (version === requestVersion) loading.value = false;
    }
  }

  async function runPreflight() {
    error.value = null;
    loading.value = true;
    try {
      preflight.value = await contextCapturePreflight(sessionId.value);
      selectedProtocol.value = preflight.value.protocol;
    } catch (cause) {
      error.value = message(cause);
    } finally {
      loading.value = false;
    }
  }

  async function startCapture() {
    if (!preflight.value) return;
    localStorage.setItem(SAVE_DEFAULT_KEY, String(saveSnapshot.value));
    error.value = null;
    capturing.value = true;
    progress.value = null;
    try {
      snapshot.value = await contextCaptureStart({
        sessionId: sessionId.value,
        protocol: selectedProtocol.value,
        save: saveSnapshot.value,
        allowDegradedFidelity: !preflight.value.workingDirectoryExists,
      });
      preflight.value = null;
      if (snapshot.value.manifest.saved) await loadList();
    } catch (cause) {
      error.value = message(cause);
    } finally {
      capturing.value = false;
    }
  }

  async function cancelCapture() {
    await contextCaptureCancel(progress.value?.captureId);
  }

  async function openCapture(captureId: string) {
    error.value = null;
    loading.value = true;
    try {
      snapshot.value = await contextCaptureGet(sessionId.value, captureId);
    } catch (cause) {
      error.value = message(cause);
    } finally {
      loading.value = false;
    }
  }

  async function deleteCapture(captureId: string) {
    await contextCaptureDelete(sessionId.value, captureId);
    if (snapshot.value?.manifest.captureId === captureId) snapshot.value = null;
    await loadList();
  }

  watch(
    sessionId,
    () => {
      preflight.value = null;
      snapshot.value = null;
      progress.value = null;
      summaries.value = [];
      void loadList();
    },
    { immediate: true },
  );
  onBeforeUnmount(() => unlisten?.());

  return {
    preflight,
    summaries,
    snapshot,
    progress,
    loading,
    capturing,
    error,
    selectedProtocol,
    saveSnapshot,
    setup,
    loadList,
    runPreflight,
    startCapture,
    cancelCapture,
    openCapture,
    deleteCapture,
  };
}
