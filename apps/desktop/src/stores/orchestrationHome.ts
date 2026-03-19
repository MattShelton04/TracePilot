import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { SystemDependencies, CopilotVersion, WorktreeInfo } from '@tracepilot/types';
import {
  checkSystemDeps,
  listSessions,
  discoverCopilotVersions,
  getActiveCopilotVersion,
  listWorktrees,
} from '@tracepilot/client';

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
  const loading = ref(false);
  const error = ref<string | null>(null);
  const activityFeed = ref<ActivityEvent[]>([]);

  const isHealthy = computed(() => {
    if (!systemDeps.value) return false;
    return systemDeps.value.gitAvailable && systemDeps.value.copilotAvailable;
  });

  const copilotVersionStr = computed(() => activeVersion.value?.version ?? systemDeps.value?.copilotVersion ?? 'unknown');

  async function initialize() {
    loading.value = true;
    error.value = null;
    try {
      const results = await Promise.allSettled([
        checkSystemDeps(),
        listSessions(),
        discoverCopilotVersions(),
        getActiveCopilotVersion(),
      ]);

      const deps = results[0].status === 'fulfilled' ? results[0].value : null;
      const sessions = results[1].status === 'fulfilled' ? results[1].value : [];
      const versionsData = results[2].status === 'fulfilled' ? results[2].value : [];
      const active = results[3].status === 'fulfilled' ? results[3].value : null;

      systemDeps.value = deps;
      totalSessions.value = sessions.length;
      activeSessions.value = sessions.filter((s) => s.isRunning).length;
      versions.value = versionsData;
      activeVersion.value = active;

      // Generate activity feed from recent sessions
      activityFeed.value = sessions.slice(0, 6).map((s, i) => ({
        id: `feed-${i}`,
        type: s.isRunning ? 'session_launched' as const : 'batch_completed' as const,
        message: s.isRunning
          ? `Session started in ${s.repository ?? 'unknown'}`
          : `Session completed in ${s.repository ?? 'unknown'}`,
        timestamp: s.updatedAt ?? s.createdAt ?? new Date().toISOString(),
      }));
    } catch (e) {
      error.value = String(e);
    } finally {
      loading.value = false;
    }
  }

  async function loadWorktreeStats(repoPath?: string) {
    if (!repoPath) return;
    try {
      const wts = await listWorktrees(repoPath);
      worktreeCount.value = wts.length;
      staleWorktreeCount.value = wts.filter((w: WorktreeInfo) => w.status === 'stale').length;
      totalDiskUsage.value = wts.reduce((sum: number, w: WorktreeInfo) => sum + (w.diskUsageBytes ?? 0), 0);
    } catch {
      // Non-critical
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
    loading,
    error,
    activityFeed,
    isHealthy,
    copilotVersionStr,
    initialize,
    loadWorktreeStats,
  };
});
