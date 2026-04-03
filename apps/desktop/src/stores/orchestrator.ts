import { taskAttribution, taskOrchestratorHealth } from "@tracepilot/client";
import type { AttributionSnapshot, HealthCheckResult, OrchestratorState } from "@tracepilot/types";
import { toErrorMessage } from "@tracepilot/ui";
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { logWarn } from "@/utils/logger";

export const useOrchestratorStore = defineStore("orchestrator", () => {
  // ─── State ────────────────────────────────────────────────────────
  const health = ref<HealthCheckResult | null>(null);
  const attribution = ref<AttributionSnapshot | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const pollingEnabled = ref(false);

  // ─── Computed ─────────────────────────────────────────────────────

  const state = computed<OrchestratorState>(() => {
    if (!health.value) return "idle";
    switch (health.value.health) {
      case "healthy":
        return "running";
      case "stale":
        return "error";
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
    error.value = null;
    try {
      health.value = await taskOrchestratorHealth();
    } catch (e) {
      error.value = toErrorMessage(e);
      logWarn("[orchestrator] Health check failed:", e);
    }
  }

  async function refreshAttribution(sessionPath: string) {
    try {
      attribution.value = await taskAttribution(sessionPath);
    } catch (e) {
      logWarn("[orchestrator] Attribution refresh failed:", e);
    }
  }

  /** Perform a full refresh of health + attribution. */
  async function refresh(sessionPath?: string) {
    loading.value = true;
    error.value = null;
    try {
      await checkHealth();
      if (sessionPath) {
        await refreshAttribution(sessionPath);
      }
    } finally {
      loading.value = false;
    }
  }

  return {
    // State
    health,
    attribution,
    loading,
    error,
    pollingEnabled,
    // Computed
    state,
    isRunning,
    isStopped,
    isStale,
    needsRestart,
    activeSubagents,
    completedSubagents,
    // Actions
    checkHealth,
    refreshAttribution,
    refresh,
  };
});
