import { getAnalytics, getCodeImpact, getToolAnalysis } from '@tracepilot/client';
import type { AnalyticsData, CodeImpactData, ToolAnalysisData } from '@tracepilot/types';
import { defineStore } from 'pinia';
import { ref } from 'vue';

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

  // Track what's been loaded to avoid redundant fetches
  const loaded = new Set<string>();

  // Actions
  async function fetchAnalytics(options?: { fromDate?: string; toDate?: string; force?: boolean }) {
    const cacheKey = `analytics:${options?.fromDate ?? ''}:${options?.toDate ?? ''}`;
    if (!options?.force && loaded.has(cacheKey)) return;

    analyticsLoading.value = true;
    analyticsError.value = null;
    try {
      analytics.value = await getAnalytics({
        fromDate: options?.fromDate,
        toDate: options?.toDate,
      });
      loaded.add(cacheKey);
    } catch (e) {
      analyticsError.value = e instanceof Error ? e.message : String(e);
    } finally {
      analyticsLoading.value = false;
    }
  }

  async function fetchToolAnalysis(options?: {
    fromDate?: string;
    toDate?: string;
    force?: boolean;
  }) {
    const cacheKey = `toolAnalysis:${options?.fromDate ?? ''}:${options?.toDate ?? ''}`;
    if (!options?.force && loaded.has(cacheKey)) return;

    toolAnalysisLoading.value = true;
    toolAnalysisError.value = null;
    try {
      toolAnalysis.value = await getToolAnalysis({
        fromDate: options?.fromDate,
        toDate: options?.toDate,
      });
      loaded.add(cacheKey);
    } catch (e) {
      toolAnalysisError.value = e instanceof Error ? e.message : String(e);
    } finally {
      toolAnalysisLoading.value = false;
    }
  }

  async function fetchCodeImpact(options?: {
    fromDate?: string;
    toDate?: string;
    force?: boolean;
  }) {
    const cacheKey = `codeImpact:${options?.fromDate ?? ''}:${options?.toDate ?? ''}`;
    if (!options?.force && loaded.has(cacheKey)) return;

    codeImpactLoading.value = true;
    codeImpactError.value = null;
    try {
      codeImpact.value = await getCodeImpact({
        fromDate: options?.fromDate,
        toDate: options?.toDate,
      });
      loaded.add(cacheKey);
    } catch (e) {
      codeImpactError.value = e instanceof Error ? e.message : String(e);
    } finally {
      codeImpactLoading.value = false;
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

    // Actions
    fetchAnalytics,
    fetchToolAnalysis,
    fetchCodeImpact,
    refreshAll,
    $reset,
  };
});
