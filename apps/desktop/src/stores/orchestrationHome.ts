import {
  checkSystemDeps,
  discoverCopilotVersions,
  getActiveCopilotVersion,
  listRegisteredRepos,
  listSessions,
} from "@tracepilot/client";
import type {
  CopilotVersion,
  RegisteredRepo,
  RunStatus,
  SessionListItem,
  SessionSource,
  SystemDependencies,
} from "@tracepilot/types";
import {
  type AsyncGuardToken,
  projectLabelFromCwd,
  toErrorMessage,
  useAsyncGuard,
} from "@tracepilot/ui";
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { usePreferencesStore } from "@/stores/preferences";
import { useWorktreesStore } from "@/stores/worktrees";
import { logWarn } from "@/utils/logger";
import { allSettledRecord } from "@/utils/settledRecord";
import { aggregateSettledErrors } from "@/utils/settleErrors";

/** One recently active session in the Command Centre's feed. */
export interface ActivityEvent {
  sessionId: string;
  /** The session's summary; null when it has none yet. */
  title: string | null;
  /** The repository, else the working directory's folder. */
  location: string | null;
  isRunning: boolean;
  runStatus?: RunStatus;
  source?: SessionSource;
  /** When it was last active; null when the session records no time. */
  timestamp: string | null;
}

const FEED_SIZE = 6;

function lastActive(s: SessionListItem): string | null {
  return s.updatedAt ?? s.createdAt ?? null;
}

/** Sorting key; a session with no readable time sorts last. */
function activeMs(s: SessionListItem): number {
  const ms = Date.parse(lastActive(s) ?? "");
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

function toActivityEvent(s: SessionListItem): ActivityEvent {
  return {
    sessionId: s.id,
    title: s.summary || null,
    location: s.repository || projectLabelFromCwd(s.cwd),
    isRunning: s.isRunning,
    runStatus: s.runStatus,
    source: s.source,
    timestamp: lastActive(s),
  };
}

export const useOrchestrationHomeStore = defineStore("orchestrationHome", () => {
  const systemDeps = ref<SystemDependencies | null>(null);
  const sessions = ref<SessionListItem[]>([]);
  /** Sessions arrive after the page renders; until then their counts are unknown. */
  const sessionsLoaded = ref(false);
  const activeSessions = ref(0);
  /** Running sessions whose process reports it is working, or waiting for input. */
  const workingSessions = ref(0);
  const waitingSessions = ref(0);
  const activeVersion = ref<CopilotVersion | null>(null);
  const versions = ref<CopilotVersion[]>([]);
  const registeredRepos = ref<RegisteredRepo[]>([]);
  const loading = ref(false);
  const refreshing = ref(false);
  const error = ref<string | null>(null);
  const lastInitialized = ref(0);
  const loadGuard = useAsyncGuard();

  // Delegate worktree stats to the shared worktrees store (P1 perf fix).
  const worktreesStore = useWorktreesStore();
  const worktreeCount = computed(() => worktreesStore.worktreeCount);
  const staleWorktreeCount = computed(() => worktreesStore.staleCount);
  const totalDiskUsage = computed(() => worktreesStore.totalDiskUsage);

  // The sessions the session list shows, so the counts here match the sidebar's.
  const prefs = usePreferencesStore();
  const visibleSessions = computed(() =>
    prefs.hideEmptySessions
      ? sessions.value.filter((s) => (s.turnCount ?? 0) !== 0)
      : sessions.value,
  );
  const totalSessions = computed(() => visibleSessions.value.length);
  const hiddenEmptySessions = computed(() => sessions.value.length - visibleSessions.value.length);
  const activityFeed = computed<ActivityEvent[]>(() =>
    [...visibleSessions.value]
      .sort((a, b) => activeMs(b) - activeMs(a))
      .slice(0, FEED_SIZE)
      .map(toActivityEvent),
  );

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

      const versionsData =
        bgSettled.versions.status === "fulfilled" ? bgSettled.versions.value : [];

      // Surface background loading errors
      error.value = aggregateSettledErrors(Object.values(bgSettled));

      // A failed refresh keeps the sessions already on screen.
      if (bgSettled.sessions.status === "fulfilled") {
        sessions.value = bgSettled.sessions.value;
        sessionsLoaded.value = true;
      }
      const running = sessions.value.filter((s) => s.isRunning);
      activeSessions.value = running.length;
      workingSessions.value = running.filter((s) => s.runStatus === "busy").length;
      waitingSessions.value = running.filter((s) => s.runStatus === "waiting").length;
      versions.value = versionsData;

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
    sessionsLoaded,
    totalSessions,
    hiddenEmptySessions,
    activeSessions,
    workingSessions,
    waitingSessions,
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
