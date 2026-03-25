import type { AnalyticsData, CodeImpactData, ToolAnalysisData } from '@tracepilot/types';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAnalyticsStore } from '../../stores/analytics';

// ── Mock client functions ─────────────────────────────────────
const mockGetAnalytics = vi.fn();
const mockGetToolAnalysis = vi.fn();
const mockGetCodeImpact = vi.fn();

vi.mock('@tracepilot/client', () => ({
  getAnalytics: (...args: unknown[]) => mockGetAnalytics(...args),
  getToolAnalysis: (...args: unknown[]) => mockGetToolAnalysis(...args),
  getCodeImpact: (...args: unknown[]) => mockGetCodeImpact(...args),
}));

// ── Fixtures ──────────────────────────────────────────────────
const FIXTURE_ANALYTICS: AnalyticsData = {
  totalSessions: 10,
  totalTokens: 500_000,
  totalCost: 5.0,
  totalPremiumRequests: 25,
  averageHealthScore: 0.8,
  tokenUsageByDay: [{ date: '2025-01-01', tokens: 50_000 }],
  activityPerDay: [{ date: '2025-01-01', count: 3 }],
  modelDistribution: [{ model: 'gpt-4', tokens: 500_000, percentage: 100, inputTokens: 250_000, outputTokens: 250_000, cacheReadTokens: 0, premiumRequests: 5, requestCount: 50 }],
  costByDay: [{ date: '2025-01-01', cost: 5.0 }],
  apiDurationStats: {
    avgMs: 1_000_000,
    medianMs: 900_000,
    p95Ms: 2_000_000,
    minMs: 100_000,
    maxMs: 3_000_000,
    totalSessionsWithDuration: 10,
  },
  productivityMetrics: {
    avgTurnsPerSession: 5.0,
    avgToolCallsPerTurn: 3.0,
    avgTokensPerTurn: 10_000,
    avgTokensPerApiSecond: 2_500,
  },
  cacheStats: {
    totalCacheReadTokens: 50_000,
    totalInputTokens: 250_000,
    cacheHitRate: 20.0,
    nonCachedInputTokens: 200_000,
  },
  healthDistribution: {
    healthyCount: 7,
    attentionCount: 2,
    criticalCount: 1,
  },
  sessionsWithErrors: 2,
  totalRateLimits: 3,
  totalCompactions: 5,
  totalTruncations: 1,
  incidentsByDay: [
    { date: "2026-03-18", errors: 1, rateLimits: 1, compactions: 3, truncations: 1 },
    { date: "2026-03-19", errors: 1, rateLimits: 2, compactions: 2, truncations: 0 },
  ],
};

const FIXTURE_TOOL_ANALYSIS: ToolAnalysisData = {
  totalCalls: 50,
  successRate: 0.95,
  avgDurationMs: 500,
  mostUsedTool: 'edit',
  tools: [
    { name: 'edit', callCount: 30, successRate: 0.97, avgDurationMs: 400, totalDurationMs: 12_000 },
    { name: 'view', callCount: 20, successRate: 0.92, avgDurationMs: 650, totalDurationMs: 13_000 },
  ],
  activityHeatmap: [{ day: 0, hour: 10, count: 5 }],
};

const FIXTURE_CODE_IMPACT: CodeImpactData = {
  filesModified: 15,
  linesAdded: 1000,
  linesRemoved: 300,
  netChange: 700,
  fileTypeBreakdown: [{ extension: '.ts', count: 10, percentage: 66.7 }],
  mostModifiedFiles: [{ path: 'src/index.ts', additions: 100, deletions: 30 }],
  changesByDay: [{ date: '2025-01-01', additions: 200, deletions: 60 }],
};

// ── Tests ─────────────────────────────────────────────────────

describe('useAnalyticsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  // ── Initial state ─────────────────────────────────────────
  describe('initial state', () => {
    it('initializes with null data and no errors', () => {
      const store = useAnalyticsStore();
      expect(store.analytics).toBeNull();
      expect(store.toolAnalysis).toBeNull();
      expect(store.codeImpact).toBeNull();
    });

    it('initializes with loading states false', () => {
      const store = useAnalyticsStore();
      expect(store.analyticsLoading).toBe(false);
      expect(store.toolAnalysisLoading).toBe(false);
      expect(store.codeImpactLoading).toBe(false);
    });

    it('initializes with no errors', () => {
      const store = useAnalyticsStore();
      expect(store.analyticsError).toBeNull();
      expect(store.toolAnalysisError).toBeNull();
      expect(store.codeImpactError).toBeNull();
    });
  });

  // ── fetchAnalytics ────────────────────────────────────────
  describe('fetchAnalytics', () => {
    it('fetches and stores analytics data', async () => {
      mockGetAnalytics.mockResolvedValue(FIXTURE_ANALYTICS);
      const store = useAnalyticsStore();

      await store.fetchAnalytics();

      expect(store.analytics).toEqual(FIXTURE_ANALYTICS);
      expect(store.analyticsLoading).toBe(false);
      expect(store.analyticsError).toBeNull();
    });

    it('sets loading state during fetch', async () => {
      let resolvePromise: ((value: AnalyticsData) => void) | undefined;
      mockGetAnalytics.mockReturnValue(
        new Promise<AnalyticsData>((resolve) => {
          resolvePromise = resolve;
        }),
      );
      const store = useAnalyticsStore();

      const fetchPromise = store.fetchAnalytics({ force: true });
      expect(store.analyticsLoading).toBe(true);

      resolvePromise?.(FIXTURE_ANALYTICS);
      await fetchPromise;
      expect(store.analyticsLoading).toBe(false);
    });

    it('handles errors gracefully', async () => {
      mockGetAnalytics.mockRejectedValue(new Error('Network error'));
      const store = useAnalyticsStore();

      await store.fetchAnalytics();

      expect(store.analytics).toBeNull();
      expect(store.analyticsError).toBe('Network error');
      expect(store.analyticsLoading).toBe(false);
    });

    it('handles non-Error rejection values', async () => {
      mockGetAnalytics.mockRejectedValue('string error');
      const store = useAnalyticsStore();

      await store.fetchAnalytics();

      expect(store.analyticsError).toBe('string error');
    });

    it('passes date filters to client function', async () => {
      mockGetAnalytics.mockResolvedValue(FIXTURE_ANALYTICS);
      const store = useAnalyticsStore();

      await store.fetchAnalytics({ fromDate: '2025-01-01', toDate: '2025-01-31' });

      expect(mockGetAnalytics).toHaveBeenCalledWith({
        fromDate: '2025-01-01',
        toDate: '2025-01-31',
        hideEmpty: true,
      });
    });

    it('skips fetch when already loaded (cache hit)', async () => {
      mockGetAnalytics.mockResolvedValue(FIXTURE_ANALYTICS);
      const store = useAnalyticsStore();

      await store.fetchAnalytics();
      await store.fetchAnalytics(); // second call

      expect(mockGetAnalytics).toHaveBeenCalledTimes(1);
    });

    it('re-fetches when forced', async () => {
      mockGetAnalytics.mockResolvedValue(FIXTURE_ANALYTICS);
      const store = useAnalyticsStore();

      await store.fetchAnalytics();
      await store.fetchAnalytics({ force: true });

      expect(mockGetAnalytics).toHaveBeenCalledTimes(2);
    });

    it('fetches again with different date range', async () => {
      mockGetAnalytics.mockResolvedValue(FIXTURE_ANALYTICS);
      const store = useAnalyticsStore();

      await store.fetchAnalytics({ fromDate: '2025-01-01' });
      await store.fetchAnalytics({ fromDate: '2025-02-01' });

      expect(mockGetAnalytics).toHaveBeenCalledTimes(2);
    });

    it('clears previous error on retry', async () => {
      mockGetAnalytics.mockRejectedValueOnce(new Error('fail'));
      const store = useAnalyticsStore();

      await store.fetchAnalytics();
      expect(store.analyticsError).toBe('fail');

      mockGetAnalytics.mockResolvedValue(FIXTURE_ANALYTICS);
      await store.fetchAnalytics({ force: true });
      expect(store.analyticsError).toBeNull();
      expect(store.analytics).toEqual(FIXTURE_ANALYTICS);
    });
  });

  // ── fetchToolAnalysis ─────────────────────────────────────
  describe('fetchToolAnalysis', () => {
    it('fetches and stores tool analysis data', async () => {
      mockGetToolAnalysis.mockResolvedValue(FIXTURE_TOOL_ANALYSIS);
      const store = useAnalyticsStore();

      await store.fetchToolAnalysis();

      expect(store.toolAnalysis).toEqual(FIXTURE_TOOL_ANALYSIS);
      expect(store.toolAnalysisLoading).toBe(false);
      expect(store.toolAnalysisError).toBeNull();
    });

    it('handles errors', async () => {
      mockGetToolAnalysis.mockRejectedValue(new Error('parse error'));
      const store = useAnalyticsStore();

      await store.fetchToolAnalysis();

      expect(store.toolAnalysis).toBeNull();
      expect(store.toolAnalysisError).toBe('parse error');
    });

    it('caches by date range', async () => {
      mockGetToolAnalysis.mockResolvedValue(FIXTURE_TOOL_ANALYSIS);
      const store = useAnalyticsStore();

      await store.fetchToolAnalysis({ fromDate: '2025-01-01' });
      await store.fetchToolAnalysis({ fromDate: '2025-01-01' });

      expect(mockGetToolAnalysis).toHaveBeenCalledTimes(1);
    });
  });

  // ── fetchCodeImpact ───────────────────────────────────────
  describe('fetchCodeImpact', () => {
    it('fetches and stores code impact data', async () => {
      mockGetCodeImpact.mockResolvedValue(FIXTURE_CODE_IMPACT);
      const store = useAnalyticsStore();

      await store.fetchCodeImpact();

      expect(store.codeImpact).toEqual(FIXTURE_CODE_IMPACT);
      expect(store.codeImpactLoading).toBe(false);
      expect(store.codeImpactError).toBeNull();
    });

    it('handles errors', async () => {
      mockGetCodeImpact.mockRejectedValue(new Error('disk error'));
      const store = useAnalyticsStore();

      await store.fetchCodeImpact();

      expect(store.codeImpact).toBeNull();
      expect(store.codeImpactError).toBe('disk error');
    });
  });

  // ── refreshAll ────────────────────────────────────────────
  describe('refreshAll', () => {
    it('fetches all three datasets in parallel', async () => {
      mockGetAnalytics.mockResolvedValue(FIXTURE_ANALYTICS);
      mockGetToolAnalysis.mockResolvedValue(FIXTURE_TOOL_ANALYSIS);
      mockGetCodeImpact.mockResolvedValue(FIXTURE_CODE_IMPACT);
      const store = useAnalyticsStore();

      await store.refreshAll();

      expect(store.analytics).toEqual(FIXTURE_ANALYTICS);
      expect(store.toolAnalysis).toEqual(FIXTURE_TOOL_ANALYSIS);
      expect(store.codeImpact).toEqual(FIXTURE_CODE_IMPACT);
    });

    it('clears cache and re-fetches everything', async () => {
      mockGetAnalytics.mockResolvedValue(FIXTURE_ANALYTICS);
      mockGetToolAnalysis.mockResolvedValue(FIXTURE_TOOL_ANALYSIS);
      mockGetCodeImpact.mockResolvedValue(FIXTURE_CODE_IMPACT);
      const store = useAnalyticsStore();

      await store.fetchAnalytics();
      await store.fetchToolAnalysis();
      await store.fetchCodeImpact();

      await store.refreshAll();

      expect(mockGetAnalytics).toHaveBeenCalledTimes(2);
      expect(mockGetToolAnalysis).toHaveBeenCalledTimes(2);
      expect(mockGetCodeImpact).toHaveBeenCalledTimes(2);
    });

    it('handles partial failures', async () => {
      mockGetAnalytics.mockResolvedValue(FIXTURE_ANALYTICS);
      mockGetToolAnalysis.mockRejectedValue(new Error('tool fail'));
      mockGetCodeImpact.mockResolvedValue(FIXTURE_CODE_IMPACT);
      const store = useAnalyticsStore();

      await store.refreshAll();

      expect(store.analytics).toEqual(FIXTURE_ANALYTICS);
      expect(store.toolAnalysisError).toBe('tool fail');
      expect(store.codeImpact).toEqual(FIXTURE_CODE_IMPACT);
    });

    it('passes date options through to all fetches', async () => {
      mockGetAnalytics.mockResolvedValue(FIXTURE_ANALYTICS);
      mockGetToolAnalysis.mockResolvedValue(FIXTURE_TOOL_ANALYSIS);
      mockGetCodeImpact.mockResolvedValue(FIXTURE_CODE_IMPACT);
      const store = useAnalyticsStore();

      await store.refreshAll({ fromDate: '2025-03-01', toDate: '2025-03-31' });

      const expected = { fromDate: '2025-03-01', toDate: '2025-03-31', hideEmpty: true };
      expect(mockGetAnalytics).toHaveBeenCalledWith(expected);
      expect(mockGetToolAnalysis).toHaveBeenCalledWith(expected);
      expect(mockGetCodeImpact).toHaveBeenCalledWith(expected);
    });
  });

  // ── $reset ────────────────────────────────────────────────
  describe('$reset', () => {
    it('resets all state to initial values', async () => {
      mockGetAnalytics.mockResolvedValue(FIXTURE_ANALYTICS);
      mockGetToolAnalysis.mockResolvedValue(FIXTURE_TOOL_ANALYSIS);
      mockGetCodeImpact.mockResolvedValue(FIXTURE_CODE_IMPACT);
      const store = useAnalyticsStore();

      await store.refreshAll();
      expect(store.analytics).not.toBeNull();

      store.$reset();

      expect(store.analytics).toBeNull();
      expect(store.toolAnalysis).toBeNull();
      expect(store.codeImpact).toBeNull();
      expect(store.analyticsLoading).toBe(false);
      expect(store.toolAnalysisLoading).toBe(false);
      expect(store.codeImpactLoading).toBe(false);
      expect(store.analyticsError).toBeNull();
      expect(store.toolAnalysisError).toBeNull();
      expect(store.codeImpactError).toBeNull();
    });

    it('clears cache so next fetch re-requests data', async () => {
      mockGetAnalytics.mockResolvedValue(FIXTURE_ANALYTICS);
      const store = useAnalyticsStore();

      await store.fetchAnalytics();
      store.$reset();
      await store.fetchAnalytics();

      expect(mockGetAnalytics).toHaveBeenCalledTimes(2);
    });
  });

  // ── Independence ──────────────────────────────────────────
  describe('independence', () => {
    it('fetching one dataset does not affect others', async () => {
      mockGetAnalytics.mockResolvedValue(FIXTURE_ANALYTICS);
      const store = useAnalyticsStore();

      await store.fetchAnalytics();

      expect(store.analytics).toEqual(FIXTURE_ANALYTICS);
      expect(store.toolAnalysis).toBeNull();
      expect(store.codeImpact).toBeNull();
      expect(store.toolAnalysisLoading).toBe(false);
      expect(store.codeImpactLoading).toBe(false);
    });

    it('error in one dataset does not affect others', async () => {
      mockGetAnalytics.mockRejectedValue(new Error('analytics fail'));
      mockGetToolAnalysis.mockResolvedValue(FIXTURE_TOOL_ANALYSIS);
      const store = useAnalyticsStore();

      await store.fetchAnalytics();
      await store.fetchToolAnalysis();

      expect(store.analyticsError).toBe('analytics fail');
      expect(store.toolAnalysis).toEqual(FIXTURE_TOOL_ANALYSIS);
      expect(store.toolAnalysisError).toBeNull();
    });
  });
});
