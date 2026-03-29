import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { SystemDependencies, CopilotVersion, WorktreeInfo, RegisteredRepo } from '@tracepilot/types';
import {
  checkSystemDeps,
  listSessions,
  discoverCopilotVersions,
  getActiveCopilotVersion,
  listWorktrees,
  listRegisteredRepos,
} from '@tracepilot/client';
import { toErrorMessage } from '@tracepilot/ui';
import { logWarn } from '@/utils/logger';

export interface ActivityEvent {
  id: string;
  type: 'session_launched' | 'session_error' | 'batch_completed' | 'budget_alert' | 'config_changed';
  message: string;
  timestamp: string;
}

export const useOrchestrationHomeStore = defineStore('orchestrationHome', () => {
  const systemDeps = ref<SystemDependencies | null>(null);
  const totalSessions = ref(0);
  const activeSessions = ref(0);
  const activeVersion = ref<CopilotVersion | null>(null);
  const versions = ref<CopilotVersion[]>([]);
  const worktreeCount = ref(0);
  const staleWorktreeCount = ref(0);
  const totalDiskUsage = ref(0);
  const registeredRepos = ref<RegisteredRepo[]>([]);
  const loading = ref(false);
  const refreshing = ref(false);
  const error = ref<string | null>(null);
  const activityFeed = ref<ActivityEvent[]>([]);
  const lastInitialized = ref(0);

  const isHealthy = computed(() => {
    if (!systemDeps.value) return false;
    return systemDeps.value.gitAvailable && systemDeps.value.copilotAvailable;
  });

  const copilotVersionStr = computed(() => activeVersion.value?.version ?? systemDeps.value?.copilotVersion ?? 'unknown');

  // Show cached data immediately if initialized within the last 5 minutes
  const hasCachedData = computed(() => lastInitialized.value > 0);
  const CACHE_TTL_MS = 5 * 60 * 1000;

  async function initialize() {
    const now = Date.now();
    const isFresh = lastInitialized.value > 0 && (now - lastInitialized.value) < CACHE_TTL_MS;

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
      doFetch().finally(() => { refreshing.value = false; });
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

      const deps = depsResult.status === 'fulfilled' ? depsResult.value : null;
      const active = activeResult.status === 'fulfilled' ? activeResult.value : null;
      systemDeps.value = deps;
      activeVersion.value = active;

      // If this was the initial load, mark as loaded so the UI renders
      if (loading.value) loading.value = false;

      // Background path: sessions + versions (can be slower)
      const [sessionsResult, versionsResult] = await Promise.allSettled([
        listSessions(),
        discoverCopilotVersions(),
      ]);

      const sessions = sessionsResult.status === 'fulfilled' ? sessionsResult.value : [];
      const versionsData = versionsResult.status === 'fulfilled' ? versionsResult.value : [];

      // Surface background loading errors
      const bgFailures = [sessionsResult, versionsResult]
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .map((r) => toErrorMessage(r.reason));
      if (bgFailures.length) {
        error.value = bgFailures.join('; ');
      } else {
        error.value = null;
      }

      totalSessions.value = sessions.length;
      activeSessions.value = sessions.filter((s) => s.isRunning).length;
      versions.value = versionsData;

      // Generate activity feed from recent sessions
      activityFeed.value = sessions.slice(0, 6).map((s, i) => ({
        id: `feed-${i}`,
        type: s.isRunning ? 'session_launched' as const : 'batch_completed' as const,
        message: s.isRunning
          ? `Session started in ${s.repository ?? 'unknown'}`
          : `Session completed in ${s.repository ?? 'unknown'}`,
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

  /** Compute aggregate stats from a list of worktrees. */
  function computeWorktreeStats(worktrees: WorktreeInfo[]) {
    return {
      total: worktrees.length,
      stale: worktrees.filter((w) => w.status === 'stale').length,
      diskUsage: worktrees.reduce((sum, w) => sum + (w.diskUsageBytes ?? 0), 0),
    };
  }

  async function loadWorktreeStats(repoPath?: string) {
    if (!repoPath) return;
    try {
      const stats = computeWorktreeStats(await listWorktrees(repoPath));
      worktreeCount.value = stats.total;
      staleWorktreeCount.value = stats.stale;
      totalDiskUsage.value = stats.diskUsage;
    } catch (e) {
      // Non-critical - worktree stats are supplementary UI info
      logWarn('[orchestrationHome] Failed to load worktree stats', e);
    }
  }

  async function loadWorktreeStatsFromRegistry() {
    try {
      const repos = await listRegisteredRepos();
      registeredRepos.value = repos;
      if (repos.length === 0) return;

      let totalWt = 0;
      let staleWt = 0;
      let totalDisk = 0;

      const results = await Promise.allSettled(
        repos.map((r) => listWorktrees(r.path)),
      );
      for (const result of results) {
        if (result.status === 'fulfilled') {
          const stats = computeWorktreeStats(result.value);
          totalWt += stats.total;
          staleWt += stats.stale;
          totalDisk += stats.diskUsage;
        }
      }

      worktreeCount.value = totalWt;
      staleWorktreeCount.value = staleWt;
      totalDiskUsage.value = totalDisk;
    } catch (e) {
      // Non-critical - worktree stats are supplementary UI info
      logWarn('[orchestrationHome] Failed to load worktree stats from registry', e);
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
