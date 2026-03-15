import { getAnalytics, getCodeImpact, getToolAnalysis, listSessions } from '@tracepilot/client';
import type { AnalyticsData, CodeImpactData, ToolAnalysisData } from '@tracepilot/types';
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export const useAnalyticsStore = defineStore('analytics', () => {
  // State
  const analytics = ref<AnalyticsData | null>(null);
  const toolAnalysis = ref<ToolAnalysisData | null>(null);
  const codeImpact = ref<CodeImpactData | null>(null);

  const analyticsLoading = ref(false);
  const toolAnalysisLoading = ref(false);
  const codeImpactLoading = ref(false);

  const analyticsError = ref<string | null>(null);
  const toolAnalysisError = ref<string | null>(null);
  const codeImpactError = ref<string | null>(null);

  // Repository filter
  const selectedRepo = ref<string | null>(null);
  const availableRepos = ref<string[]>([]);

  // Track what's been loaded to avoid redundant fetches
  const loaded = new Set<string>();

  // Request generation counters to prevent stale async writes
  let analyticsGen = 0;
  let toolAnalysisGen = 0;
  let codeImpactGen = 0;

  function cacheKeyFor(prefix: string, options?: { fromDate?: string; toDate?: string; repo?: string }) {
    return `${prefix}:${options?.fromDate ?? ''}:${options?.toDate ?? ''}:${options?.repo ?? ''}`;
  }

  /** Fetch the list of unique repositories from session metadata. */
  async function fetchAvailableRepos() {
    if (availableRepos.value.length > 0) return;
    try {
      const sessions = await listSessions();
      const repos = new Set(sessions.map(s => s.repository).filter(Boolean) as string[]);
      availableRepos.value = [...repos].sort();
    } catch {
      // Non-critical — just means repo filter won't have options
    }
  }

  // Actions
  async function fetchAnalytics(options?: { fromDate?: string; toDate?: string; repo?: string; force?: boolean }) {
    const repo = options?.repo ?? selectedRepo.value ?? undefined;
    const cacheKey = cacheKeyFor('analytics', { ...options, repo });
    if (!options?.force && loaded.has(cacheKey)) return;

    const gen = ++analyticsGen;
    analyticsLoading.value = true;
    analyticsError.value = null;
    try {
      const result = await getAnalytics({
        fromDate: options?.fromDate,
        toDate: options?.toDate,
        repo,
      });
      if (gen !== analyticsGen) return; // superseded by newer request
      analytics.value = result;
      loaded.add(cacheKey);
    } catch (e) {
      if (gen !== analyticsGen) return;
      analyticsError.value = e instanceof Error ? e.message : String(e);
    } finally {
      if (gen === analyticsGen) analyticsLoading.value = false;
    }
  }

  async function fetchToolAnalysis(options?: {
    fromDate?: string;
    toDate?: string;
    repo?: string;
    force?: boolean;
  }) {
    const repo = options?.repo ?? selectedRepo.value ?? undefined;
    const cacheKey = cacheKeyFor('toolAnalysis', { ...options, repo });
    if (!options?.force && loaded.has(cacheKey)) return;

    const gen = ++toolAnalysisGen;
    toolAnalysisLoading.value = true;
    toolAnalysisError.value = null;
    try {
      const result = await getToolAnalysis({
        fromDate: options?.fromDate,
        toDate: options?.toDate,
        repo,
      });
      if (gen !== toolAnalysisGen) return;
      toolAnalysis.value = result;
      loaded.add(cacheKey);
    } catch (e) {
      if (gen !== toolAnalysisGen) return;
      toolAnalysisError.value = e instanceof Error ? e.message : String(e);
    } finally {
      if (gen === toolAnalysisGen) toolAnalysisLoading.value = false;
    }
  }

  async function fetchCodeImpact(options?: {
    fromDate?: string;
    toDate?: string;
    repo?: string;
    force?: boolean;
  }) {
    const repo = options?.repo ?? selectedRepo.value ?? undefined;
    const cacheKey = cacheKeyFor('codeImpact', { ...options, repo });
    if (!options?.force && loaded.has(cacheKey)) return;

    const gen = ++codeImpactGen;
    codeImpactLoading.value = true;
    codeImpactError.value = null;
    try {
      const result = await getCodeImpact({
        fromDate: options?.fromDate,
        toDate: options?.toDate,
        repo,
      });
      if (gen !== codeImpactGen) return;
      codeImpact.value = result;
      loaded.add(cacheKey);
    } catch (e) {
      if (gen !== codeImpactGen) return;
      codeImpactError.value = e instanceof Error ? e.message : String(e);
    } finally {
      if (gen === codeImpactGen) codeImpactLoading.value = false;
    }
  }

  async function refreshAll(options?: { fromDate?: string; toDate?: string }) {
    loaded.clear();
    await Promise.all([
      fetchAnalytics({ ...options, force: true }),
      fetchToolAnalysis({ ...options, force: true }),
      fetchCodeImpact({ ...options, force: true }),
    ]);
  }

  /** Change the active repository filter. Cache keys already include repo so no clear needed. */
  function setRepo(repo: string | null) {
    selectedRepo.value = repo;
  }

  function $reset() {
    analytics.value = null;
    toolAnalysis.value = null;
    codeImpact.value = null;
    analyticsLoading.value = false;
    toolAnalysisLoading.value = false;
    codeImpactLoading.value = false;
    analyticsError.value = null;
    toolAnalysisError.value = null;
    codeImpactError.value = null;
    selectedRepo.value = null;
    loaded.clear();
  }

  return {
    // State
    analytics,
    toolAnalysis,
    codeImpact,
    analyticsLoading,
    toolAnalysisLoading,
    codeImpactLoading,
    analyticsError,
    toolAnalysisError,
    codeImpactError,
    selectedRepo,
    availableRepos,

    // Actions
    fetchAnalytics,
    fetchToolAnalysis,
    fetchCodeImpact,
    fetchAvailableRepos,
    refreshAll,
    setRepo,
    $reset,
  };
});
