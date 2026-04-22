import {
  getAvailableModels,
  getSessionEvents,
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
import { DEFAULT_ORCHESTRATOR_MODEL } from "@tracepilot/types";
import { runMutation, usePolling } from "@tracepilot/ui";
import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import { logWarn } from "@/utils/logger";
import { type ActivityEntry, toActivityEntries } from "@/utils/orchestratorActivity";

export type { ActivityEntry } from "@/utils/orchestratorActivity";

import { POLL_FAST_MS, POLL_SLOW_MS } from "@/config/tuning";

/** Single source of truth lives in `@tracepilot/types` and (on the Rust
 * side) `tracepilot_core::constants::DEFAULT_ORCHESTRATOR_MODEL`. */
const DEFAULT_MODEL = DEFAULT_ORCHESTRATOR_MODEL;
const ACTIVITY_FEED_LIMIT = 30;

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
  const activityFeed = ref<ActivityEntry[]>([]);
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
    await runMutation(error, async () => {
      try {
        health.value = await taskOrchestratorHealth();
      } catch (e) {
        logWarn("[orchestrator] Health check failed:", e);
        throw e;
      }
      return true as const;
    });
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

  /** Fetch recent orchestrator session events and format as activity feed. */
  let lastKnownEventCount = 0;
  async function refreshActivity() {
    const uuid = sessionUuid.value;
    if (!uuid) return;
    try {
      // Use cached count to estimate offset; fetch a generous window to avoid missing events
      const offset = Math.max(0, lastKnownEventCount - ACTIVITY_FEED_LIMIT);
      const resp = await getSessionEvents(uuid, offset, ACTIVITY_FEED_LIMIT * 2);
      lastKnownEventCount = resp.totalCount;
      // If we got less than expected, re-fetch with correct offset
      const entries = toActivityEntries(resp.events);
      activityFeed.value = entries.slice(-ACTIVITY_FEED_LIMIT).reverse(); // newest first
    } catch (e) {
      logWarn("[orchestrator] Activity feed refresh failed:", e);
    }
  }

  /** Single poll cycle: check health + attribution + activity + ingest results.
   *  Uses a single-flight guard to prevent overlapping polls. */
  async function pollCycle() {
    if (pollInFlight) return;
    pollInFlight = true;
    try {
      await checkHealth();
      if (isRunning.value) {
        await Promise.all([refreshAttribution(), refreshActivity(), ingestResults()]);
      }
    } finally {
      pollInFlight = false;
    }
  }

  // Two dedicated pollers — usePolling captures intervalMs at construction
  // time, so we keep one instance per cadence and route via startPolling().
  const pollOpts = { immediate: false, pauseWhenHidden: true, swallowErrors: true } as const;
  const fastPoll = usePolling(pollCycle, { intervalMs: POLL_FAST_MS, ...pollOpts });
  const slowPoll = usePolling(pollCycle, { intervalMs: POLL_SLOW_MS, ...pollOpts });

  function startPolling(intervalMs = POLL_FAST_MS) {
    stopPolling();
    (intervalMs === POLL_SLOW_MS ? slowPoll : fastPoll).start();
  }
  function stopPolling() {
    fastPoll.stop();
    slowPoll.stop();
  }

  // Adjust polling cadence based on orchestrator state.
  // When running → fast full-cycle polling.
  // When idle → slow health-only polling (detects restarts / stale state).
  // `immediate: true` ensures polling starts on store creation even when idle.
  watch(
    isRunning,
    (running) => {
      if (running) {
        startPolling(POLL_FAST_MS);
      } else {
        // Final ingestion, then switch to slow health-only polling
        // (re-check isRunning in case state changed during async ingestion)
        ingestResults().finally(() => {
          if (!isRunning.value) {
            startPolling(POLL_SLOW_MS);
          }
        });
      }
    },
    { immediate: true },
  );

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
    const ok = await runMutation(error, async () => {
      handle.value = await taskOrchestratorStart(model ?? selectedModel.value);
      await checkHealth();
      return true as const;
    });
    starting.value = false;
    if (!ok) logWarn("[orchestrator] Start failed");
  }

  /** Gracefully stop the orchestrator via manifest shutdown flag. */
  async function stopOrchestrator() {
    stopping.value = true;
    const ok = await runMutation(error, async () => {
      await taskOrchestratorStop();
      handle.value = null;
      attribution.value = null;
      await checkHealth();
      return true as const;
    });
    stopping.value = false;
    if (!ok) logWarn("[orchestrator] Stop failed");
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
    activityFeed,
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
    refreshActivity,
    ingestResults,
    pollCycle,
    startPolling,
    stopPolling,
    refresh,
    startOrchestrator,
    stopOrchestrator,
  };
});
