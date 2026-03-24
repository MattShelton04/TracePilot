import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

// ── Mock client ───────────────────────────────────────────────
const mockGetAnalytics = vi.fn().mockResolvedValue({
  totalSessions: 0,
  totalTokens: 0,
  totalCost: 0,
  totalPremiumRequests: 0,
  averageHealthScore: 0,
  tokenUsageByDay: [],
  sessionsPerDay: [],
  modelDistribution: [],
  costByDay: [],
  sessionsWithErrors: 0,
  totalRateLimits: 0,
  totalCompactions: 0,
  totalTruncations: 0,
  incidentsByDay: [],
});
const mockGetToolAnalysis = vi.fn().mockResolvedValue({
  totalCalls: 0,
  successRate: 0,
  avgDurationMs: 0,
  mostUsedTool: '',
  tools: [],
  activityHeatmap: [],
});
const mockGetCodeImpact = vi.fn().mockResolvedValue({
  filesModified: 0,
  linesAdded: 0,
  linesRemoved: 0,
  netChange: 0,
  fileTypeBreakdown: [],
  mostModifiedFiles: [],
  changesByDay: [],
});

vi.mock('@tracepilot/client', () => ({
  getAnalytics: (...args: unknown[]) => mockGetAnalytics(...args),
  getToolAnalysis: (...args: unknown[]) => mockGetToolAnalysis(...args),
  getCodeImpact: (...args: unknown[]) => mockGetCodeImpact(...args),
}));

// ── Track onMounted callbacks manually ────────────────────────
let mountCallbacks: (() => void)[] = [];
vi.mock('vue', async () => {
  const actual = await vi.importActual<typeof import('vue')>('vue');
  return {
    ...actual,
    onMounted: (cb: () => void) => { mountCallbacks.push(cb); },
  };
});

// ── Import after mocks are in place ───────────────────────────
import { useAnalyticsStore } from '../../stores/analytics';
import { useAnalyticsPage } from '../../composables/useAnalyticsPage';

describe('useAnalyticsPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mountCallbacks = [];
  });

  it('returns the analytics store instance', () => {
    const fetchFn = vi.fn().mockResolvedValue(undefined);
    const { store } = useAnalyticsPage(fetchFn);
    expect(store).toBe(useAnalyticsStore());
  });

  it('calls fetchAvailableRepos and fetchFn on mount', async () => {
    const store = useAnalyticsStore();
    const fetchFn = vi.fn().mockResolvedValue(undefined);
    const spy = vi.spyOn(store, 'fetchAvailableRepos').mockResolvedValue(undefined);

    useAnalyticsPage(fetchFn);

    // Simulate mount
    for (const cb of mountCallbacks) await cb();

    expect(spy).toHaveBeenCalledOnce();
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(fetchFn).toHaveBeenCalledWith();
  });

  it('calls fetchFn with force:true when selectedRepo changes', async () => {
    const store = useAnalyticsStore();
    const fetchFn = vi.fn().mockResolvedValue(undefined);

    useAnalyticsPage(fetchFn);

    store.setRepo('my-repo');
    await nextTick();

    expect(fetchFn).toHaveBeenCalledWith({ force: true });
  });

  it('calls fetchFn with force:true when dateRange changes', async () => {
    const store = useAnalyticsStore();
    const fetchFn = vi.fn().mockResolvedValue(undefined);

    useAnalyticsPage(fetchFn);

    store.setTimeRange('7d');
    await nextTick();

    expect(fetchFn).toHaveBeenCalledWith({ force: true });
  });
});
