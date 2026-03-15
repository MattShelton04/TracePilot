import type { AnalyticsData, CodeImpactData, ToolAnalysisData } from '@tracepilot/types';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock client ───────────────────────────────────────────────
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
  totalTokens: 2_500_000,
  totalCost: 5.5,
  totalPremiumRequests: 40,
  averageHealthScore: 0.82,
  tokenUsageByDay: [
    { date: '2025-01-01', tokens: 100_000 },
    { date: '2025-01-02', tokens: 150_000 },
    { date: '2025-01-03', tokens: 200_000 },
  ],
  sessionsPerDay: [
    { date: '2025-01-01', count: 3 },
    { date: '2025-01-02', count: 4 },
    { date: '2025-01-03', count: 3 },
  ],
  modelDistribution: [
    { model: 'gpt-4', tokens: 1_500_000, percentage: 60, inputTokens: 750_000, outputTokens: 750_000, cacheReadTokens: 0 },
    { model: 'claude-3', tokens: 1_000_000, percentage: 40, inputTokens: 500_000, outputTokens: 500_000, cacheReadTokens: 0 },
  ],
  costByDay: [
    { date: '2025-01-01', cost: 1.5 },
    { date: '2025-01-02', cost: 2.0 },
    { date: '2025-01-03', cost: 2.0 },
  ],
  sessionDurationStats: {
    avgMs: 1_800_000,
    medianMs: 1_200_000,
    p95Ms: 5_400_000,
    minMs: 120_000,
    maxMs: 7_200_000,
    totalSessionsWithDuration: 8,
  },
  productivityMetrics: {
    avgTurnsPerSession: 8.5,
    avgToolCallsPerTurn: 4.2,
    avgTokensPerTurn: 60_489,
  },
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
  activityHeatmap: [
    { day: 0, hour: 10, count: 5 },
    { day: 1, hour: 14, count: 3 },
  ],
};

const FIXTURE_CODE_IMPACT: CodeImpactData = {
  filesModified: 15,
  linesAdded: 1000,
  linesRemoved: 300,
  netChange: 700,
  fileTypeBreakdown: [
    { extension: '.ts', count: 10, percentage: 66.7 },
    { extension: '.vue', count: 5, percentage: 33.3 },
  ],
  mostModifiedFiles: [
    { path: 'src/index.ts', additions: 100, deletions: 30 },
    { path: 'src/App.vue', additions: 80, deletions: 20 },
  ],
  changesByDay: [
    { date: '2025-01-01', additions: 200, deletions: 60 },
    { date: '2025-01-02', additions: 300, deletions: 80 },
    { date: '2025-01-03', additions: 500, deletions: 160 },
  ],
};

// ── LoadingOverlay stub ───────────────────────────────────────
const LoadingOverlayStub = {
  name: 'LoadingOverlay',
  props: { loading: Boolean, message: String },
  template: '<div v-if="loading" class="loading-stub">Loading…</div><slot v-else />',
};

const globalStubs = {
  global: {
    stubs: { LoadingOverlay: LoadingOverlayStub },
  },
};

// ── Lazy-load view components so mocks are in place ───────────
async function loadAnalyticsDashboard() {
  const mod = await import('../../views/AnalyticsDashboardView.vue');
  return mod.default;
}

async function loadToolAnalysis() {
  const mod = await import('../../views/ToolAnalysisView.vue');
  return mod.default;
}

async function loadCodeImpact() {
  const mod = await import('../../views/CodeImpactView.vue');
  return mod.default;
}

// ── Tests ─────────────────────────────────────────────────────

describe('AnalyticsDashboardView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('renders stat cards with analytics data', async () => {
    mockGetAnalytics.mockResolvedValue(FIXTURE_ANALYTICS);
    const Component = await loadAnalyticsDashboard();
    const wrapper = mount(Component, globalStubs);

    await flushPromises();

    expect(wrapper.text()).toContain('10'); // totalSessions
    expect(wrapper.text()).toContain('2.5M'); // totalTokens
    expect(wrapper.text()).toContain('$1.60'); // copilotCost
    expect(wrapper.text()).toContain('Copilot Cost');
    expect(wrapper.text()).toContain('Wholesale Cost');
    expect(wrapper.text()).toContain('0.82'); // averageHealthScore
  });

  it('renders duration stats section', async () => {
    mockGetAnalytics.mockResolvedValue(FIXTURE_ANALYTICS);
    const Component = await loadAnalyticsDashboard();
    const wrapper = mount(Component, globalStubs);

    await flushPromises();

    expect(wrapper.text()).toContain('Session Duration');
    expect(wrapper.text()).toContain('Average');
    expect(wrapper.text()).toContain('Median');
    expect(wrapper.text()).toContain('P95');
  });

  it('renders productivity metrics section', async () => {
    mockGetAnalytics.mockResolvedValue(FIXTURE_ANALYTICS);
    const Component = await loadAnalyticsDashboard();
    const wrapper = mount(Component, globalStubs);

    await flushPromises();

    expect(wrapper.text()).toContain('Productivity Metrics');
    expect(wrapper.text()).toContain('8.5'); // avgTurnsPerSession
    expect(wrapper.text()).toContain('4.2'); // avgToolCallsPerTurn
  });

  it('shows error state with retry button', async () => {
    mockGetAnalytics.mockRejectedValue(new Error('Backend unavailable'));
    const Component = await loadAnalyticsDashboard();
    const wrapper = mount(Component, globalStubs);

    await flushPromises();

    expect(wrapper.text()).toContain('Failed to load analytics');
    expect(wrapper.text()).toContain('Backend unavailable');
    expect(wrapper.find('button').text()).toContain('Retry');
  });

  it('does not render StubBanner', async () => {
    mockGetAnalytics.mockResolvedValue(FIXTURE_ANALYTICS);
    const Component = await loadAnalyticsDashboard();
    const wrapper = mount(Component, globalStubs);

    await flushPromises();

    expect(wrapper.find('[class*="stub"]').exists()).toBe(false);
  });

  it('does not show hardcoded trend percentages', async () => {
    mockGetAnalytics.mockResolvedValue(FIXTURE_ANALYTICS);
    const Component = await loadAnalyticsDashboard();
    const wrapper = mount(Component, globalStubs);

    await flushPromises();

    expect(wrapper.text()).not.toContain('↑ 12%');
    expect(wrapper.text()).not.toContain('↑ 18%');
    expect(wrapper.text()).not.toContain('↓ 3%');
  });

  it('renders SVG charts when data has multiple points', async () => {
    mockGetAnalytics.mockResolvedValue(FIXTURE_ANALYTICS);
    const Component = await loadAnalyticsDashboard();
    const wrapper = mount(Component, globalStubs);

    await flushPromises();

    const svgs = wrapper.findAll('svg');
    expect(svgs.length).toBeGreaterThanOrEqual(2);
  });

  it('renders model distribution donut chart', async () => {
    mockGetAnalytics.mockResolvedValue(FIXTURE_ANALYTICS);
    const Component = await loadAnalyticsDashboard();
    const wrapper = mount(Component, globalStubs);

    await flushPromises();

    expect(wrapper.text()).toContain('Model Distribution');
    expect(wrapper.text()).toContain('gpt-4');
    expect(wrapper.text()).toContain('claude-3');
    expect(wrapper.text()).toContain('60%');
    expect(wrapper.text()).toContain('40%');
  });

  it('handles data without duration stats gracefully', async () => {
    const dataWithoutDuration = {
      ...FIXTURE_ANALYTICS,
      sessionDurationStats: undefined,
      productivityMetrics: undefined,
    };
    mockGetAnalytics.mockResolvedValue(dataWithoutDuration);
    const Component = await loadAnalyticsDashboard();
    const wrapper = mount(Component, globalStubs);

    await flushPromises();

    expect(wrapper.text()).toContain('10');
    expect(wrapper.text()).not.toContain('Session Duration');
  });
});

describe('ToolAnalysisView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('renders tool analysis stat cards', async () => {
    mockGetToolAnalysis.mockResolvedValue(FIXTURE_TOOL_ANALYSIS);
    const Component = await loadToolAnalysis();
    const wrapper = mount(Component, globalStubs);

    await flushPromises();

    expect(wrapper.text()).toContain('50'); // totalCalls
    expect(wrapper.text()).toContain('edit'); // mostUsedTool
    expect(wrapper.text()).toContain('95.0%'); // successRate
  });

  it('renders tool table with sorted tools', async () => {
    mockGetToolAnalysis.mockResolvedValue(FIXTURE_TOOL_ANALYSIS);
    const Component = await loadToolAnalysis();
    const wrapper = mount(Component, globalStubs);

    await flushPromises();

    expect(wrapper.text()).toContain('edit');
    expect(wrapper.text()).toContain('view');
    expect(wrapper.text()).toContain('30'); // edit callCount
    expect(wrapper.text()).toContain('20'); // view callCount
  });

  it('shows error state on failure', async () => {
    mockGetToolAnalysis.mockRejectedValue(new Error('Parse error'));
    const Component = await loadToolAnalysis();
    const wrapper = mount(Component, globalStubs);

    await flushPromises();

    expect(wrapper.text()).toContain('Failed to load tool analysis');
    expect(wrapper.text()).toContain('Parse error');
  });

  it('does not render StubBanner', async () => {
    mockGetToolAnalysis.mockResolvedValue(FIXTURE_TOOL_ANALYSIS);
    const Component = await loadToolAnalysis();
    const wrapper = mount(Component, globalStubs);

    await flushPromises();

    expect(wrapper.find('[class*="stub"]').exists()).toBe(false);
  });

  it('renders heatmap grid', async () => {
    mockGetToolAnalysis.mockResolvedValue(FIXTURE_TOOL_ANALYSIS);
    const Component = await loadToolAnalysis();
    const wrapper = mount(Component, globalStubs);

    await flushPromises();

    expect(wrapper.text()).toContain('Activity Heatmap');
    expect(wrapper.text()).toContain('Mon');
    expect(wrapper.text()).toContain('Sun');
  });
});

describe('CodeImpactView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('renders code impact stat cards', async () => {
    mockGetCodeImpact.mockResolvedValue(FIXTURE_CODE_IMPACT);
    const Component = await loadCodeImpact();
    const wrapper = mount(Component, globalStubs);

    await flushPromises();

    expect(wrapper.text()).toContain('15'); // filesModified
    expect(wrapper.text()).toContain('1,000'); // linesAdded
    expect(wrapper.text()).toContain('300'); // linesRemoved
    expect(wrapper.text()).toContain('700'); // netChange
  });

  it('renders file type breakdown', async () => {
    mockGetCodeImpact.mockResolvedValue(FIXTURE_CODE_IMPACT);
    const Component = await loadCodeImpact();
    const wrapper = mount(Component, globalStubs);

    await flushPromises();

    expect(wrapper.text()).toContain('.ts');
    expect(wrapper.text()).toContain('.vue');
  });

  it('renders most modified files', async () => {
    mockGetCodeImpact.mockResolvedValue(FIXTURE_CODE_IMPACT);
    const Component = await loadCodeImpact();
    const wrapper = mount(Component, globalStubs);

    await flushPromises();

    expect(wrapper.text()).toContain('src/index.ts');
    expect(wrapper.text()).toContain('src/App.vue');
  });

  it('shows error state on failure', async () => {
    mockGetCodeImpact.mockRejectedValue(new Error('disk error'));
    const Component = await loadCodeImpact();
    const wrapper = mount(Component, globalStubs);

    await flushPromises();

    expect(wrapper.text()).toContain('Failed to load code impact data');
    expect(wrapper.text()).toContain('disk error');
  });

  it('does not render StubBanner', async () => {
    mockGetCodeImpact.mockResolvedValue(FIXTURE_CODE_IMPACT);
    const Component = await loadCodeImpact();
    const wrapper = mount(Component, globalStubs);

    await flushPromises();

    expect(wrapper.find('[class*="stub"]').exists()).toBe(false);
  });

  it('renders changes over time chart', async () => {
    mockGetCodeImpact.mockResolvedValue(FIXTURE_CODE_IMPACT);
    const Component = await loadCodeImpact();
    const wrapper = mount(Component, globalStubs);

    await flushPromises();

    expect(wrapper.text()).toContain('Changes Over Time');
    const svgs = wrapper.findAll('svg');
    expect(svgs.length).toBeGreaterThanOrEqual(1);
  });

  it('shows positive net change with correct label', async () => {
    mockGetCodeImpact.mockResolvedValue(FIXTURE_CODE_IMPACT);
    const Component = await loadCodeImpact();
    const wrapper = mount(Component, globalStubs);

    await flushPromises();

    expect(wrapper.text()).toContain('+700');
    expect(wrapper.text()).toContain('Net positive');
  });

  it('shows negative net change with correct label', async () => {
    const negativeData = { ...FIXTURE_CODE_IMPACT, netChange: -200 };
    mockGetCodeImpact.mockResolvedValue(negativeData);
    const Component = await loadCodeImpact();
    const wrapper = mount(Component, globalStubs);

    await flushPromises();

    expect(wrapper.text()).toContain('-200');
    expect(wrapper.text()).toContain('Net negative');
    expect(wrapper.text()).not.toContain('Net positive');
  });

  it('shows most modified files as session frequency', async () => {
    mockGetCodeImpact.mockResolvedValue(FIXTURE_CODE_IMPACT);
    const Component = await loadCodeImpact();
    const wrapper = mount(Component, globalStubs);

    await flushPromises();

    // Should show "100 sessions" not "+100"
    expect(wrapper.text()).toContain('session');
    expect(wrapper.text()).not.toMatch(/\+100/);
  });
});
