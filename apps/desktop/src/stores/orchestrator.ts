import {
  getAvailableModels,
  taskAttribution,
  taskIngestResults,
  taskOrchestratorHealth,
  taskOrchestratorStart,
  taskOrchestratorStop,
} from "@tracepilot/client";
import type {
  AttributionSnapshot,
  HealthCheckResult,
  ModelInfo,
  OrchestratorHandle,
  OrchestratorState,
} from "@tracepilot/types";
import { toErrorMessage } from "@tracepilot/ui";
import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import { logWarn } from "@/utils/logger";

const POLL_FAST_MS = 5_000; // When running: full cycle every 5s
const POLL_SLOW_MS = 15_000; // When idle: health-only check every 15s
const DEFAULT_MODEL = "gpt-5-mini";

export const useOrchestratorStore = defineStore("orchestrator", () => {
  // ─── State ────────────────────────────────────────────────────────
  const health = ref<HealthCheckResult | null>(null);
  const attribution = ref<AttributionSnapshot | null>(null);
  const handle = ref<OrchestratorHandle | null>(null);
  const loading = ref(false);
  const starting = ref(false);
  const stopping = ref(false);
  const error = ref<string | null>(null);
  const lastIngestedCount = ref(0);
  const models = ref<ModelInfo[]>([]);
  const selectedModel = ref(DEFAULT_MODEL);
  const configModelLoaded = ref(false);
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let pollInFlight = false;

  // ─── Computed ─────────────────────────────────────────────────────

  const state = computed<OrchestratorState>(() => {
    if (starting.value) return "running";
    if (handle.value && !health.value) return "running";
    if (!health.value) return "idle";
    switch (health.value.health) {
      case "healthy":
        return "running";
      case "stale":
        return "error";
      case "unknown":
        return handle.value ? "running" : "idle";
      case "stopped":
        return "idle";
      default:
        return "idle";
    }
  });

  const isRunning = computed(() => state.value === "running");
  const isStopped = computed(() => state.value === "idle");
  const isStale = computed(() => health.value?.health === "stale");
  const needsRestart = computed(() => health.value?.needsRestart === true);

  /** Session UUID of the orchestrator (discovered via health check). */
  const sessionUuid = computed(() => health.value?.sessionUuid ?? null);

  /** Session path resolved by the backend (platform-agnostic). */
  const sessionPath = computed(() => health.value?.sessionPath ?? null);

  const activeSubagents = computed(() =>
    (attribution.value?.subagents ?? []).filter(
      (s) => s.status === "running" || s.status === "spawning",
    ),
  );

  const completedSubagents = computed(() =>
    (attribution.value?.subagents ?? []).filter(
      (s) => s.status === "completed" || s.status === "failed",
    ),
  );

  // ─── Actions ──────────────────────────────────────────────────────

  async function checkHealth() {
    try {
      const result = await taskOrchestratorHealth();
      health.value = result;
    } catch (e) {
      logWarn("[orchestrator] Health check failed:", e);
    }
  }

  /** Load available models from the backend and set initial model from config. */
  async function loadModels() {
    try {
      models.value = await getAvailableModels();
      // Load configured model preference from backend config (only once)
      if (!configModelLoaded.value) {
        try {
          const { getConfig } = await import("@tracepilot/client");
          const cfg = await getConfig();
          if (cfg.tasks?.orchestratorModel) {
            selectedModel.value = cfg.tasks.orchestratorModel;
          }
          configModelLoaded.value = true;
        } catch {
          // Config read failed — keep default
        }
      }
    } catch (e) {
      logWarn("[orchestrator] Failed to load models:", e);
    }
  }

  /** Refresh subagent attribution from orchestrator session events. */
  async function refreshAttribution() {
    const path = sessionPath.value;
    if (!path) return;
    try {
      attribution.value = await taskAttribution(path);
    } catch (e) {
      logWarn("[orchestrator] Attribution refresh failed:", e);
    }
  }

  /** Scan jobs directory and ingest any completed results into the DB. */
  async function ingestResults(): Promise<number> {
    try {
      const count = await taskIngestResults();
      lastIngestedCount.value = count;
      return count;
    } catch (e) {
      logWarn("[orchestrator] Ingestion failed:", e);
      return 0;
    }
  }

  /** Single poll cycle: check health + attribution + ingest results.
   *  Uses a single-flight guard to prevent overlapping polls. */
  async function pollCycle() {
    if (pollInFlight) return;
    pollInFlight = true;
    try {
      await checkHealth();
      if (isRunning.value) {
        await refreshAttribution();
        await ingestResults();
      }
    } finally {
      pollInFlight = false;
    }
  }

  /** Start the background polling loop at the given interval. */
  function startPolling(intervalMs = POLL_FAST_MS) {
    stopPolling();
    pollTimer = setInterval(pollCycle, intervalMs);
  }

  /** Stop the background polling loop. */
  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  // Adjust polling cadence based on orchestrator state.
  // When running → fast full-cycle polling.
  // When idle → slow health-only polling (detects restarts / stale state).
  watch(isRunning, (running) => {
    if (running) {
      startPolling(POLL_FAST_MS);
    } else {
      // Final ingestion, then switch to slow health-only polling
      ingestResults().finally(() => startPolling(POLL_SLOW_MS));
    }
  });

  /** Perform a full refresh: health + attribution + ingestion. */
  async function refresh() {
    loading.value = true;
    error.value = null;
    try {
      await pollCycle();
    } finally {
      loading.value = false;
    }
  }

  /** Launch the orchestrator. Uses selectedModel unless overridden. */
  async function startOrchestrator(model?: string) {
    starting.value = true;
    error.value = null;
    try {
      handle.value = await taskOrchestratorStart(model ?? selectedModel.value);
      await checkHealth();
    } catch (e) {
      error.value = toErrorMessage(e);
      logWarn("[orchestrator] Start failed:", e);
    } finally {
      starting.value = false;
    }
  }

  /** Gracefully stop the orchestrator via manifest shutdown flag. */
  async function stopOrchestrator() {
    stopping.value = true;
    error.value = null;
    try {
      await taskOrchestratorStop();
      handle.value = null;
      attribution.value = null;
      await checkHealth();
    } catch (e) {
      error.value = toErrorMessage(e);
      logWarn("[orchestrator] Stop failed:", e);
    } finally {
      stopping.value = false;
    }
  }

  return {
    // State
    health,
    attribution,
    handle,
    loading,
    starting,
    stopping,
    error,
    lastIngestedCount,
    models,
    selectedModel,
    // Computed
    state,
    isRunning,
    isStopped,
    isStale,
    needsRestart,
    sessionUuid,
    sessionPath,
    activeSubagents,
    completedSubagents,
    // Actions
    checkHealth,
    loadModels,
    refreshAttribution,
    ingestResults,
    pollCycle,
    startPolling,
    stopPolling,
    refresh,
    startOrchestrator,
    stopOrchestrator,
  };
});
