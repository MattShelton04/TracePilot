import {
  checkSystemDeps,
  discoverCopilotVersions,
  getActiveCopilotVersion,
  listRegisteredRepos,
  listSessions,
} from "@tracepilot/client";
import type { CopilotVersion, RegisteredRepo, SystemDependencies } from "@tracepilot/types";
import { toErrorMessage } from "@tracepilot/ui";
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { useWorktreesStore } from "@/stores/worktrees";
import { logWarn } from "@/utils/logger";
import { aggregateSettledErrors } from "@/utils/settleErrors";

export interface ActivityEvent {
  id: string;
  type:
    | "session_launched"
    | "session_error"
    | "batch_completed"
    | "budget_alert"
    | "config_changed";
  message: string;
  timestamp: string;
}

export const useOrchestrationHomeStore = defineStore("orchestrationHome", () => {
  const systemDeps = ref<SystemDependencies | null>(null);
  const totalSessions = ref(0);
  const activeSessions = ref(0);
  const activeVersion = ref<CopilotVersion | null>(null);
  const versions = ref<CopilotVersion[]>([]);
  const registeredRepos = ref<RegisteredRepo[]>([]);
  const loading = ref(false);
  const refreshing = ref(false);
  const error = ref<string | null>(null);
  const activityFeed = ref<ActivityEvent[]>([]);
  const lastInitialized = ref(0);

  // Delegate worktree stats to the shared worktrees store (P1 perf fix).
  const worktreesStore = useWorktreesStore();
  const worktreeCount = computed(() => worktreesStore.worktreeCount);
  const staleWorktreeCount = computed(() => worktreesStore.staleCount);
  const totalDiskUsage = computed(() => worktreesStore.totalDiskUsage);

  const isHealthy = computed(() => {
    if (!systemDeps.value) return false;
    return systemDeps.value.gitAvailable && systemDeps.value.copilotAvailable;
  });

  const copilotVersionStr = computed(
    () => activeVersion.value?.version ?? systemDeps.value?.copilotVersion ?? "unknown",
  );

  // Show cached data immediately if initialized within the last 5 minutes
  const hasCachedData = computed(() => lastInitialized.value > 0);
  const CACHE_TTL_MS = 5 * 60 * 1000;

  async function initialize() {
    const now = Date.now();
    const isFresh = lastInitialized.value > 0 && now - lastInitialized.value < CACHE_TTL_MS;

    if (isFresh) {
      // Data is fresh — refresh silently in the background
      refreshing.value = true;
      await doFetch();
      refreshing.value = false;
      return;
    }

    if (hasCachedData.value) {
      // Stale cache — show it immediately but refresh in background
      refreshing.value = true;
      doFetch().finally(() => {
        refreshing.value = false;
      });
      return;
    }

    // First load — show loading spinner
    loading.value = true;
    error.value = null;
    await doFetch();
    loading.value = false;
  }

  async function doFetch() {
    try {
      // Fast path: system deps and version info load first (< 100ms)
      const [depsResult, activeResult] = await Promise.allSettled([
        checkSystemDeps(),
        getActiveCopilotVersion(),
      ]);

      const deps = depsResult.status === "fulfilled" ? depsResult.value : null;
      const active = activeResult.status === "fulfilled" ? activeResult.value : null;
      systemDeps.value = deps;
      activeVersion.value = active;

      // If this was the initial load, mark as loaded so the UI renders
      if (loading.value) loading.value = false;

      // Background path: sessions + versions (can be slower)
      const [sessionsResult, versionsResult] = await Promise.allSettled([
        listSessions(),
        discoverCopilotVersions(),
      ]);

      const sessions = sessionsResult.status === "fulfilled" ? sessionsResult.value : [];
      const versionsData = versionsResult.status === "fulfilled" ? versionsResult.value : [];

      // Surface background loading errors
      error.value = aggregateSettledErrors([sessionsResult, versionsResult]);

      totalSessions.value = sessions.length;
      activeSessions.value = sessions.filter((s) => s.isRunning).length;
      versions.value = versionsData;

      // Generate activity feed from recent sessions
      activityFeed.value = sessions.slice(0, 6).map((s, i) => ({
        id: `feed-${i}`,
        type: s.isRunning ? ("session_launched" as const) : ("batch_completed" as const),
        message: s.isRunning
          ? `Session started in ${s.repository ?? "unknown"}`
          : `Session completed in ${s.repository ?? "unknown"}`,
        timestamp: s.updatedAt ?? s.createdAt ?? new Date().toISOString(),
      }));

      // Load worktree stats from all registered repos
      await loadWorktreeStatsFromRegistry();

      lastInitialized.value = Date.now();
    } catch (e) {
      error.value = toErrorMessage(e);
      loading.value = false;
    }
  }

  async function loadWorktreeStats(repoPath?: string) {
    if (!repoPath) return;
    try {
      await worktreesStore.loadWorktrees(repoPath);
    } catch (e) {
      logWarn("[orchestrationHome] Failed to load worktree stats", e);
    }
  }

  async function loadWorktreeStatsFromRegistry() {
    try {
      const repos = await listRegisteredRepos();
      registeredRepos.value = repos;
      if (repos.length === 0) return;

      // Sync repos to the worktrees store so it can load them all at once.
      worktreesStore.registeredRepos = repos;
      await worktreesStore.loadAllWorktrees();
    } catch (e) {
      logWarn("[orchestrationHome] Failed to load worktree stats from registry", e);
    }
  }

  return {
    systemDeps,
    totalSessions,
    activeSessions,
    activeVersion,
    versions,
    worktreeCount,
    staleWorktreeCount,
    totalDiskUsage,
    registeredRepos,
    loading,
    refreshing,
    error,
    activityFeed,
    isHealthy,
    copilotVersionStr,
    initialize,
    loadWorktreeStats,
    loadWorktreeStatsFromRegistry,
  };
});
