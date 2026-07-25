import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  contextBenchmarkDelete,
  contextBenchmarkGet,
  contextBenchmarkList,
  contextBenchmarkPreflight,
  contextBenchmarkStart,
  contextCaptureCancel,
  IPC_EVENTS,
} from "@tracepilot/client";
import type {
  BenchmarkPreflight,
  BenchmarkProfile,
  CaptureProgress,
  CaptureProtocol,
  ContextCaptureSnapshot,
  ContextCaptureSummary,
} from "@tracepilot/types";
import { onBeforeUnmount, ref } from "vue";
import { safeListen } from "@/utils/tauriEvents";

const BENCHMARK_COLLECTION_ID = "00000000-0000-4000-8000-000000000001";

function errorMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "object" && cause && "message" in cause) {
    return String((cause as { message: unknown }).message);
  }
  return String(cause);
}

export function useContextBenchmarks() {
  const preflight = ref<BenchmarkPreflight | null>(null);
  const summaries = ref<ContextCaptureSummary[]>([]);
  const snapshot = ref<ContextCaptureSnapshot | null>(null);
  const progress = ref<CaptureProgress | null>(null);
  const loading = ref(false);
  const capturing = ref(false);
  const error = ref<string | null>(null);
  const profile = ref<BenchmarkProfile>("isolatedBaseline");
  const repositoryPath = ref("");
  const model = ref("gpt-5");
  const protocol = ref<CaptureProtocol>("openAiResponses");
  let unlisten: UnlistenFn | null = null;

  async function setup() {
    if (!unlisten) {
      unlisten = await safeListen<CaptureProgress>(IPC_EVENTS.CONTEXT_CAPTURE_PROGRESS, (event) => {
        if (event.payload.sessionId === BENCHMARK_COLLECTION_ID) progress.value = event.payload;
      });
    }
    await Promise.all([loadPreflight(), loadList()]);
  }

  async function loadPreflight() {
    try {
      preflight.value = await contextBenchmarkPreflight();
    } catch (cause) {
      error.value = errorMessage(cause);
    }
  }

  async function loadList() {
    loading.value = true;
    error.value = null;
    try {
      summaries.value = await contextBenchmarkList();
    } catch (cause) {
      error.value = errorMessage(cause);
    } finally {
      loading.value = false;
    }
  }

  async function startCapture(): Promise<ContextCaptureSnapshot | null> {
    error.value = null;
    capturing.value = true;
    progress.value = null;
    try {
      const captured = await contextBenchmarkStart({
        profile: profile.value,
        repositoryPath: profile.value === "currentEnvironment" ? repositoryPath.value.trim() : null,
        model: model.value.trim(),
        protocol: protocol.value,
        save: true,
      });
      snapshot.value = captured;
      await loadList();
      return captured;
    } catch (cause) {
      error.value = errorMessage(cause);
      return null;
    } finally {
      capturing.value = false;
    }
  }

  async function cancelCapture() {
    await contextCaptureCancel(progress.value?.captureId);
  }

  async function openCapture(captureId: string) {
    loading.value = true;
    error.value = null;
    try {
      snapshot.value = await contextBenchmarkGet(captureId);
    } catch (cause) {
      error.value = errorMessage(cause);
    } finally {
      loading.value = false;
    }
  }

  async function getCapture(captureId: string) {
    return contextBenchmarkGet(captureId);
  }

  async function deleteCapture(captureId: string) {
    await contextBenchmarkDelete(captureId);
    if (snapshot.value?.manifest.captureId === captureId) snapshot.value = null;
    await loadList();
  }

  onBeforeUnmount(() => unlisten?.());

  return {
    preflight,
    summaries,
    snapshot,
    progress,
    loading,
    capturing,
    error,
    profile,
    repositoryPath,
    model,
    protocol,
    setup,
    loadList,
    startCapture,
    cancelCapture,
    openCapture,
    getCapture,
    deleteCapture,
  };
}
