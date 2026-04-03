import {
  taskIngestResults,
  taskOrchestratorHealth,
  taskOrchestratorStart,
  taskOrchestratorStop,
} from "@tracepilot/client";
import type {
  HealthCheckResult,
  OrchestratorHandle,
  OrchestratorState,
} from "@tracepilot/types";
import { toErrorMessage } from "@tracepilot/ui";
import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import { logWarn } from "@/utils/logger";

const POLL_INTERVAL_MS = 5_000;

export const useOrchestratorStore = defineStore("orchestrator", () => {
  // ─── State ────────────────────────────────────────────────────────
  const health = ref<HealthCheckResult | null>(null);
  const handle = ref<OrchestratorHandle | null>(null);
  const loading = ref(false);
  const starting = ref(false);
  const stopping = ref(false);
  const error = ref<string | null>(null);
  const lastIngestedCount = ref(0);
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  // ─── Computed ─────────────────────────────────────────────────────

  const state = computed<OrchestratorState>(() => {
    if (starting.value) return "running";
    if (handle.value && !health.value) return "running"; // Awaiting first heartbeat
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

  // ─── Actions ──────────────────────────────────────────────────────

  async function checkHealth() {
    try {
      health.value = await taskOrchestratorHealth();
    } catch (e) {
      logWarn("[orchestrator] Health check failed:", e);
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

  /** Single poll cycle: check health + ingest results. */
  async function pollCycle() {
    await checkHealth();
    await ingestResults();
  }

  /** Start the background polling loop. */
  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(pollCycle, POLL_INTERVAL_MS);
  }

  /** Stop the background polling loop. */
  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  // Auto-start/stop polling based on orchestrator state
  watch(isRunning, (running) => {
    if (running) {
      startPolling();
    } else {
      // Do one final ingestion then stop
      ingestResults().finally(stopPolling);
    }
  });

  /** Perform a full refresh: health + ingestion. */
  async function refresh() {
    loading.value = true;
    error.value = null;
    try {
      await pollCycle();
    } finally {
      loading.value = false;
    }
  }

  /** Launch the orchestrator. Picks up pending tasks and spawns a CLI session. */
  async function startOrchestrator(model?: string) {
    starting.value = true;
    error.value = null;
    try {
      handle.value = await taskOrchestratorStart(model);
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
    handle,
    loading,
    starting,
    stopping,
    error,
    lastIngestedCount,
    // Computed
    state,
    isRunning,
    isStopped,
    isStale,
    needsRestart,
    // Actions
    checkHealth,
    ingestResults,
    pollCycle,
    startPolling,
    stopPolling,
    refresh,
    startOrchestrator,
    stopOrchestrator,
  };
});
