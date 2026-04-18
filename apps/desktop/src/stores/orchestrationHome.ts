import {
  checkSystemDeps,
  discoverCopilotVersions,
  getActiveCopilotVersion,
  listRegisteredRepos,
  listSessions,
} from "@tracepilot/client";
import type { CopilotVersion, RegisteredRepo, SystemDependencies } from "@tracepilot/types";
import { type AsyncGuardToken, toErrorMessage, useAsyncGuard } from "@tracepilot/ui";
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { useWorktreesStore } from "@/stores/worktrees";
import { logWarn } from "@/utils/logger";
import { allSettledRecord } from "@/utils/settledRecord";
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
  const loadGuard = useAsyncGuard();

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
    const token = loadGuard.start();
    const now = Date.now();
    const isFresh = lastInitialized.value > 0 && now - lastInitialized.value < CACHE_TTL_MS;

    if (isFresh) {
      // Data is fresh — refresh silently in the background
      refreshing.value = true;
      await doFetch(token);
      if (loadGuard.isValid(token)) refreshing.value = false;
      return;
    }

    if (hasCachedData.value) {
      // Stale cache — show it immediately but refresh in background
      refreshing.value = true;
      doFetch(token).finally(() => {
        if (loadGuard.isValid(token)) refreshing.value = false;
      });
      return;
    }

    // First load — show loading spinner
    loading.value = true;
    error.value = null;
    await doFetch(token);
    if (loadGuard.isValid(token)) loading.value = false;
  }

  async function doFetch(token: AsyncGuardToken) {
    try {
      // Fast path: system deps and version info load first (< 100ms).
      // Failures here are intentionally silent: null values are handled
      // gracefully by the UI and the background path surfaces its own errors.
      const fastSettled = await allSettledRecord({
        deps: checkSystemDeps(),
        active: getActiveCopilotVersion(),
      });

      if (!loadGuard.isValid(token)) return;

      const deps = fastSettled.deps.status === "fulfilled" ? fastSettled.deps.value : null;
      const active = fastSettled.active.status === "fulfilled" ? fastSettled.active.value : null;
      systemDeps.value = deps;
      activeVersion.value = active;

      // If this was the initial load, mark as loaded so the UI renders
      if (loading.value) loading.value = false;

      // Background path: sessions + versions (can be slower)
      const bgSettled = await allSettledRecord({
        sessions: listSessions(),
        versions: discoverCopilotVersions(),
      });

      if (!loadGuard.isValid(token)) return;

      const sessions = bgSettled.sessions.status === "fulfilled" ? bgSettled.sessions.value : [];
      const versionsData =
        bgSettled.versions.status === "fulfilled" ? bgSettled.versions.value : [];

      // Surface background loading errors
      error.value = aggregateSettledErrors(Object.values(bgSettled));

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
      await doLoadWorktreeStatsFromRegistry(token);

      if (loadGuard.isValid(token)) lastInitialized.value = Date.now();
    } catch (e) {
      if (!loadGuard.isValid(token)) return;
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

  async function doLoadWorktreeStatsFromRegistry(token?: AsyncGuardToken) {
    try {
      const repos = await listRegisteredRepos();
      if (token != null && !loadGuard.isValid(token)) return;
      registeredRepos.value = repos;
      if (repos.length === 0) return;

      // Sync repos to the worktrees store so it can load them all at once.
      worktreesStore.registeredRepos = repos;
      if (token != null && !loadGuard.isValid(token)) return;
      await worktreesStore.loadAllWorktrees();
    } catch (e) {
      logWarn("[orchestrationHome] Failed to load worktree stats from registry", e);
    }
  }

  async function loadWorktreeStatsFromRegistry() {
    await doLoadWorktreeStatsFromRegistry();
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
