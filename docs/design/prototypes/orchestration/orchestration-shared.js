// ============================================================
// TracePilot Orchestration Prototypes — Shared JavaScript
// Mock data, sidebar, icons, and utilities for orchestration pages
// ============================================================

// --- Orchestration Icons (SVG inline) ---
const ORCH_ICONS = {
  rocket: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 1c0 0 4 2 4 8l-1.5 2H5.5L4 9c0-6 4-8 4-8z"/><circle cx="8" cy="6" r="1.2"/><path d="M5.5 11l-1 3 2-1.5M10.5 11l1 3-2-1.5"/></svg>`,
  dashboard: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="1" width="6" height="7" rx="1"/><rect x="9" y="1" width="6" height="4" rx="1"/><rect x="9" y="7" width="6" height="7" rx="1"/><rect x="1" y="10" width="6" height="4" rx="1"/></svg>`,
  config: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 4h12M2 8h12M2 12h12"/><circle cx="5" cy="4" r="1.5" fill="currentColor"/><circle cx="10" cy="8" r="1.5" fill="currentColor"/><circle cx="7" cy="12" r="1.5" fill="currentColor"/></svg>`,
  gitBranch: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="4" cy="4" r="2"/><circle cx="4" cy="12" r="2"/><circle cx="12" cy="6" r="2"/><path d="M4 6v4M6 4.5c3 0 4 1 6 1.5"/></svg>`,
  puzzle: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 2h4v2a2 2 0 0 1 0 4v2H6v-2a2 2 0 0 1 0-4V2z"/><path d="M2 6h2a2 2 0 0 1 4 0h2v4H8a2 2 0 0 1-4 0H2V6z"/></svg>`,
  dollar: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 1v14M11 4.5C11 3.1 9.7 2 8 2S5 3.1 5 4.5 6.3 7 8 7s3 1.1 3 2.5S9.7 14 8 14s-3-1.1-3-2.5"/></svg>`,
  flask: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 2h4M6 2v5L2 14h12L10 7V2"/><path d="M4 10h8" stroke-dasharray="2 2"/></svg>`,
  box: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 1L14 4v8l-6 3L2 12V4l6-3z"/><path d="M8 8l6-4M8 8v7M8 8L2 4"/></svg>`,
  brain: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 14V8"/><path d="M5 8c-2 0-3-1.5-3-3s1.5-3 3-3c.5 0 1 .1 1.5.4C7 1.6 7.5 1 8 1s1 .6 1.5 1.4C10 2.1 10.5 2 11 2c1.5 0 3 1.5 3 3s-1 3-3 3"/><path d="M5 8c-1.5 1-2.5 2.5-2 4.5.3 1 1.5 1.5 2.5 1.5H8M11 8c1.5 1 2.5 2.5 2 4.5-.3 1-1.5 1.5-2.5 1.5H8"/></svg>`,
  home: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 8l6-6 6 6"/><path d="M4 7v6a1 1 0 0 0 1 1h2v-3h2v3h2a1 1 0 0 0 1-1V7"/></svg>`,
  server: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="12" height="4" rx="1"/><rect x="2" y="10" width="12" height="4" rx="1"/><circle cx="5" cy="4" r="0.5" fill="currentColor"/><circle cx="5" cy="12" r="0.5" fill="currentColor"/><path d="M8 6v4"/></svg>`,
  template: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="12" height="12" rx="1.5"/><path d="M2 6h12M6 6v8"/></svg>`,
  shield: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 1L2 4v4c0 3.5 2.5 6 6 7 3.5-1 6-3.5 6-7V4L8 1z"/><polyline points="6,8 7.5,9.5 10,6.5"/></svg>`,
  pulse: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="1,8 4,8 6,3 8,13 10,6 12,8 15,8"/></svg>`,
  refresh: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2.5 8a5.5 5.5 0 0 1 9.3-3.9L13.5 2v4h-4l1.7-1.8A3.8 3.8 0 0 0 4.2 8"/><path d="M13.5 8a5.5 5.5 0 0 1-9.3 3.9L2.5 14v-4h4l-1.7 1.8A3.8 3.8 0 0 0 11.8 8"/></svg>`,
  play: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="4,2 14,8 4,14" fill="currentColor" stroke="none"/></svg>`,
  stop: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="10" height="10" rx="1" fill="currentColor" stroke="none"/></svg>`,
  trash: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 4h10M5 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1M6 7v4M10 7v4"/><path d="M4 4l.7 9a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9L12 4"/></svg>`,
  copy: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5" y="5" width="9" height="9" rx="1"/><path d="M2 11V3a1 1 0 0 1 1-1h8"/></svg>`,
  plus: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="3" x2="8" y2="13"/><line x1="3" y1="8" x2="13" y2="8"/></svg>`,
  filter: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 3h12l-4.5 5.5V13l-3 1V8.5L2 3z"/></svg>`,
  download: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 2v8M4 7l4 4 4-4M2 12v2h12v-2"/></svg>`,
  upload: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 10V2M4 5l4-4 4 4M2 12v2h12v-2"/></svg>`,
  eye: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5z"/><circle cx="8" cy="8" r="2"/></svg>`,
  terminal: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="2" width="14" height="12" rx="1.5"/><polyline points="4,6 7,8.5 4,11"/><line x1="9" y1="11" x2="12" y2="11"/></svg>`,
  warning: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 1L1 14h14L8 1z"/><line x1="8" y1="6" x2="8" y2="10"/><circle cx="8" cy="12" r="0.5" fill="currentColor"/></svg>`,
  check: `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,7 6,10 11,4"/></svg>`,
  x: `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="3" x2="11" y2="11"/><line x1="11" y1="3" x2="3" y2="11"/></svg>`,
};

// --- Orchestration Sidebar Generator ---
function generateOrchSidebar(activePage) {
  const sections = [
    {
      title: null, // No title for first section
      items: [
        { id: 'orch-home', label: 'Home', icon: ORCH_ICONS.home, href: '../orchestration-home/variant-a.html' },
        { id: 'mission-control', label: 'Mission Control', icon: ORCH_ICONS.dashboard, badge: '4', href: '../mission-control/variant-a.html' },
      ]
    },
    {
      title: 'Launch & Run',
      items: [
        { id: 'launcher', label: 'Session Launcher', icon: ORCH_ICONS.rocket, href: '../session-launcher/variant-a.html' },
        { id: 'worktrees', label: 'Worktrees', icon: ORCH_ICONS.gitBranch, badge: '7', href: '../worktree-manager/variant-a.html' },
        { id: 'batch', label: 'Batch Operations', icon: ORCH_ICONS.box, href: '../batch-operations/variant-a.html' },
        { id: 'ab-testing', label: 'A/B Testing', icon: ORCH_ICONS.flask, href: '../ab-testing/variant-a.html' },
      ]
    },
    {
      title: 'Configuration',
      items: [
        { id: 'config', label: 'Config Injector', icon: ORCH_ICONS.config, href: '../config-injector/variant-a.html' },
        { id: 'extensions', label: 'Extensions', icon: ORCH_ICONS.puzzle, href: '../extension-manager/variant-a.html' },
        { id: 'mcp', label: 'MCP Servers', icon: ORCH_ICONS.server, href: '../mcp-manager/variant-a.html' },
      ]
    },
    {
      title: 'Insights',
      items: [
        { id: 'cost', label: 'Cost & Budget', icon: ORCH_ICONS.dollar, href: '../cost-tracker/variant-a.html' },
        { id: 'knowledge', label: 'Knowledge Base', icon: ORCH_ICONS.brain, href: '../knowledge-base/variant-a.html' },
      ]
    },
  ];

  let html = `
    <div class="sidebar-brand">
      <div class="sidebar-brand-icon">⏱</div>
      <span class="sidebar-brand-text">TracePilot</span>
    </div>
    <nav class="sidebar-nav" role="navigation" aria-label="Orchestration navigation">
  `;

  sections.forEach(section => {
    if (section.title) {
      html += `<div class="sidebar-section-title">${section.title}</div>`;
    }
    section.items.forEach(item => {
      const isActive = activePage === item.id;
      html += `
        <a class="sidebar-nav-item${isActive ? ' active' : ''}" href="${item.href}">
          <span class="nav-icon">${item.icon}</span>
          <span>${item.label}</span>
          ${item.badge ? `<span class="sidebar-nav-badge">${item.badge}</span>` : ''}
        </a>
      `;
    });
  });

  html += `
    </nav>
    <div class="sidebar-footer">
      <span class="sidebar-version">v0.2.0 — Orchestration</span>
      <button class="theme-toggle" onclick="toggleTheme()">
        <span class="theme-icon">🌙</span>
      </button>
    </div>
  `;
  return html;
}

// ============================================================
// ORCHESTRATION MOCK DATA
// ============================================================

const ORCH_MODELS = [
  { id: 'claude-opus-4.6', name: 'Claude Opus 4.6', tier: 'premium', icon: '🟣' },
  { id: 'claude-opus-4.6-fast', name: 'Claude Opus 4.6 (Fast)', tier: 'premium', icon: '🟣' },
  { id: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6', tier: 'standard', icon: '🔵' },
  { id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5', tier: 'standard', icon: '🔵' },
  { id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5', tier: 'fast', icon: '⚡' },
  { id: 'gpt-5.4', name: 'GPT-5.4', tier: 'standard', icon: '🟢' },
  { id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex', tier: 'standard', icon: '🟢' },
  { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro', tier: 'standard', icon: '🟡' },
  { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini', tier: 'fast', icon: '⚡' },
  { id: 'gpt-4.1', name: 'GPT-4.1', tier: 'fast', icon: '⚡' },
];

const ORCH_REPOS = [
  { id: 'tracepilot', name: 'TracePilot', path: 'C:\\git\\TracePilot', branches: ['main', 'feat/orchestration', 'feat/config-injector', 'fix/session-parsing', 'dev'] },
  { id: 'api-server', name: 'api-server', path: 'C:\\git\\api-server', branches: ['main', 'feat/graphql', 'fix/auth-tokens', 'release/v2.1'] },
  { id: 'web-platform', name: 'web-platform', path: 'C:\\git\\web-platform', branches: ['main', 'feat/dashboard-v2', 'fix/perf-regression', 'feat/dark-mode'] },
  { id: 'infra', name: 'infrastructure', path: 'C:\\git\\infrastructure', branches: ['main', 'feat/k8s-migration', 'hotfix/dns'] },
  { id: 'shared-libs', name: 'shared-libs', path: 'C:\\git\\shared-libs', branches: ['main', 'feat/logger-v3', 'fix/serialization'] },
];

const ORCH_TEMPLATES = [
  { id: 'bug-fix', name: 'Bug Fix', description: 'Diagnose and fix a reported bug with test coverage', icon: '🐛', model: 'claude-opus-4.6', reasoning: 'high', autoApprove: false, category: 'fix', usageCount: 24, successRate: 0.87 },
  { id: 'feature-build', name: 'Feature Build', description: 'Implement a new feature end-to-end with tests', icon: '🚀', model: 'claude-opus-4.6', reasoning: 'high', autoApprove: false, category: 'build', usageCount: 18, successRate: 0.78 },
  { id: 'code-review', name: 'Code Review', description: 'Review recent changes for bugs, security, and style', icon: '🔍', model: 'claude-sonnet-4.6', reasoning: 'medium', autoApprove: true, category: 'review', usageCount: 31, successRate: 0.95 },
  { id: 'refactor', name: 'Refactor', description: 'Clean up and restructure existing code', icon: '♻️', model: 'claude-opus-4.6', reasoning: 'high', autoApprove: false, category: 'refactor', usageCount: 12, successRate: 0.82 },
  { id: 'test-writing', name: 'Test Writing', description: 'Add comprehensive test coverage to a module', icon: '🧪', model: 'claude-sonnet-4.6', reasoning: 'medium', autoApprove: true, category: 'test', usageCount: 15, successRate: 0.91 },
  { id: 'documentation', name: 'Documentation', description: 'Generate or update project documentation', icon: '📝', model: 'claude-haiku-4.5', reasoning: 'low', autoApprove: true, category: 'docs', usageCount: 9, successRate: 0.93 },
  { id: 'quick-fix', name: 'Quick Fix', description: 'Fast, targeted fix for a small issue', icon: '⚡', model: 'claude-haiku-4.5', reasoning: 'low', autoApprove: true, category: 'fix', usageCount: 42, successRate: 0.89 },
  { id: 'dependency-update', name: 'Dependency Update', description: 'Update dependencies and fix breaking changes', icon: '📦', model: 'gpt-5.4', reasoning: 'medium', autoApprove: false, category: 'maintenance', usageCount: 7, successRate: 0.71 },
];

const ORCH_ACTIVE_SESSIONS = [
  { id: 'sess-a3f2e8', repo: 'TracePilot', branch: 'feat/orchestration', model: 'claude-opus-4.6', status: 'working', statusLabel: 'Building config injector', turn: 8, tokensIn: 245000, tokensOut: 38000, premiumReqs: 0.42, elapsed: 1800000, pid: 14523, worktree: 'C:\\git\\TracePilot-wt-orch', healthScore: 92, startedAt: '2026-03-19T00:15:00Z' },
  { id: 'sess-b7c1d4', repo: 'api-server', branch: 'feat/graphql', model: 'gpt-5.4', status: 'idle', statusLabel: 'Waiting for user input', turn: 4, tokensIn: 89000, tokensOut: 12000, premiumReqs: 0.15, elapsed: 2700000, pid: 15891, worktree: null, healthScore: 78, startedAt: '2026-03-19T00:00:00Z' },
  { id: 'sess-d9e4f1', repo: 'web-platform', branch: 'fix/perf-regression', model: 'claude-sonnet-4.6', status: 'error', statusLabel: 'Build failed: 3 test failures', turn: 12, tokensIn: 412000, tokensOut: 67000, premiumReqs: 0.78, elapsed: 3600000, pid: 16234, worktree: 'C:\\git\\web-platform-wt-perf', healthScore: 35, startedAt: '2026-03-18T23:45:00Z' },
  { id: 'sess-f1a8b2', repo: 'infrastructure', branch: 'feat/k8s-migration', model: 'claude-opus-4.6', status: 'working', statusLabel: 'Writing Helm charts', turn: 6, tokensIn: 178000, tokensOut: 29000, premiumReqs: 0.31, elapsed: 1200000, pid: 17012, worktree: 'C:\\git\\infra-wt-k8s', healthScore: 88, startedAt: '2026-03-19T00:25:00Z' },
];

const ORCH_WORKTREES = [
  { id: 'wt-1', repo: 'TracePilot', path: 'C:\\git\\TracePilot-wt-orch', branch: 'feat/orchestration', session: 'sess-a3f2e8', diskMB: 142, createdAt: '2026-03-19T00:15:00Z', status: 'active' },
  { id: 'wt-2', repo: 'web-platform', path: 'C:\\git\\web-platform-wt-perf', branch: 'fix/perf-regression', session: 'sess-d9e4f1', diskMB: 287, createdAt: '2026-03-18T23:45:00Z', status: 'active' },
  { id: 'wt-3', repo: 'infrastructure', path: 'C:\\git\\infra-wt-k8s', branch: 'feat/k8s-migration', session: 'sess-f1a8b2', diskMB: 95, createdAt: '2026-03-19T00:25:00Z', status: 'active' },
  { id: 'wt-4', repo: 'TracePilot', path: 'C:\\git\\TracePilot-wt-auth', branch: 'feat/auth-refactor', session: null, diskMB: 138, createdAt: '2026-03-17T14:00:00Z', status: 'stale' },
  { id: 'wt-5', repo: 'api-server', path: 'C:\\git\\api-server-wt-perf', branch: 'perf/query-optimize', session: null, diskMB: 203, createdAt: '2026-03-16T09:30:00Z', status: 'stale' },
  { id: 'wt-6', repo: 'shared-libs', path: 'C:\\git\\shared-libs-wt-log', branch: 'feat/logger-v3', session: null, diskMB: 54, createdAt: '2026-03-18T16:00:00Z', status: 'completed' },
  { id: 'wt-7', repo: 'web-platform', path: 'C:\\git\\web-platform-wt-dark', branch: 'feat/dark-mode', session: null, diskMB: 291, createdAt: '2026-03-15T10:00:00Z', status: 'stale' },
];

const ORCH_AGENT_DEFS = [
  { id: 'explore', name: 'Explore', model: 'claude-haiku-4.5', description: 'Fast codebase exploration and Q&A', tools: ['grep', 'glob', 'view', 'bash', 'powershell'], promptExcerpt: 'You are a fast, helpful code explorer...' },
  { id: 'task', name: 'Task', model: 'claude-haiku-4.5', description: 'Execute commands with verbose output', tools: ['All CLI tools'], promptExcerpt: 'You execute commands and report results...' },
  { id: 'code-review', name: 'Code Review', model: 'claude-sonnet-4.5', description: 'Review code changes with high signal', tools: ['All CLI tools for investigation'], promptExcerpt: 'You review code changes with extremely high signal-to-noise...' },
  { id: 'research', name: 'Research', model: 'claude-sonnet-4.6', description: 'Deep research and analysis', tools: ['web_search', 'web_fetch', 'grep', 'glob', 'view'], promptExcerpt: 'You conduct thorough research...' },
  { id: 'configure-copilot', name: 'Configure Copilot', model: 'claude-haiku-4.5', description: 'Help configure Copilot settings', tools: ['view', 'edit', 'create'], promptExcerpt: 'You help users configure GitHub Copilot...' },
];

const ORCH_EXTENSIONS = [
  { id: 'auto-lint', name: 'Auto Lint', status: 'active', hooks: ['onPostToolUse'], path: '.github/extensions/auto-lint/extension.mjs', description: 'Automatically runs linter after file edits', scope: 'project' },
  { id: 'context-injector', name: 'Context Injector', status: 'active', hooks: ['onSessionStart', 'onUserPromptSubmitted'], path: '.github/extensions/context-injector/extension.mjs', description: 'Injects project context on session start', scope: 'project' },
  { id: 'tool-guard', name: 'Tool Guard', status: 'disabled', hooks: ['onPreToolUse'], path: '~/.copilot/extensions/tool-guard/extension.mjs', description: 'Blocks dangerous tool executions', scope: 'user' },
  { id: 'cost-tracker', name: 'Cost Tracker', status: 'active', hooks: ['onPostToolUse', 'onSessionEnd'], path: '~/.copilot/extensions/cost-tracker/extension.mjs', description: 'Tracks token usage and costs per session', scope: 'user' },
];

const ORCH_MCP_SERVERS = [
  { id: 'github', name: 'GitHub MCP', url: 'stdio://gh-mcp-server', status: 'connected', tools: 12, latencyMs: 45, errorRate: 0.01 },
  { id: 'jira', name: 'Jira MCP', url: 'https://jira-mcp.internal:8443', status: 'connected', tools: 8, latencyMs: 120, errorRate: 0.03 },
  { id: 'postgres', name: 'PostgreSQL MCP', url: 'stdio://pg-mcp', status: 'disconnected', tools: 6, latencyMs: null, errorRate: null },
];

const ORCH_BUDGET = {
  premiumRequests: { used: 187, limit: 300, period: 'monthly' },
  dailySpend: [
    { date: '2026-03-13', cost: 2.45, requests: 23 },
    { date: '2026-03-14', cost: 3.12, requests: 31 },
    { date: '2026-03-15', cost: 1.87, requests: 18 },
    { date: '2026-03-16', cost: 4.56, requests: 42 },
    { date: '2026-03-17', cost: 2.89, requests: 27 },
    { date: '2026-03-18', cost: 5.23, requests: 48 },
    { date: '2026-03-19', cost: 1.66, requests: 15 },
  ],
  modelBreakdown: [
    { model: 'claude-opus-4.6', cost: 12.34, requests: 89, pct: 45 },
    { model: 'claude-sonnet-4.6', cost: 5.67, requests: 42, pct: 25 },
    { model: 'gpt-5.4', cost: 3.45, requests: 31, pct: 15 },
    { model: 'claude-haiku-4.5', cost: 0.89, requests: 18, pct: 8 },
    { model: 'other', cost: 1.23, requests: 7, pct: 7 },
  ],
  alerts: { warn: 75, critical: 90 },
};

const ORCH_MEMORIES = [
  { id: 'mem-1', subject: 'testing', fact: 'Run all Rust tests: cargo test -p tracepilot-core -p tracepilot-indexer', repo: 'TracePilot', category: 'general', sourceSession: 'sess-old-1', createdAt: '2026-03-14T10:00:00Z', scope: 'repo-specific' },
  { id: 'mem-2', subject: 'authentication', fact: 'Use JWT for authentication with bcrypt password hashing', repo: 'api-server', category: 'general', sourceSession: 'sess-old-2', createdAt: '2026-03-15T14:00:00Z', scope: 'repo-specific' },
  { id: 'mem-3', subject: 'naming conventions', fact: 'Use kebab-case for all file names and PascalCase for Vue components', repo: null, category: 'user_preferences', sourceSession: 'sess-old-3', createdAt: '2026-03-12T08:00:00Z', scope: 'universal' },
  { id: 'mem-4', subject: 'error handling', fact: 'Use ErrKind wrapper for every public API error in Rust crates', repo: 'TracePilot', category: 'general', sourceSession: 'sess-old-4', createdAt: '2026-03-16T11:00:00Z', scope: 'repo-specific' },
  { id: 'mem-5', subject: 'deployment', fact: 'Always run database migrations before deploying new versions', repo: null, category: 'general', sourceSession: 'sess-old-5', createdAt: '2026-03-13T16:00:00Z', scope: 'universal' },
  { id: 'mem-6', subject: 'Tauri commands', fact: 'Every Tauri command needs 3 registrations: #[tauri::command], generate_handler![], and .commands(&[]) in build.rs', repo: 'TracePilot', category: 'file_specific', sourceSession: 'sess-old-6', createdAt: '2026-03-17T09:00:00Z', scope: 'repo-specific' },
];

const ORCH_BATCH_JOBS = [
  { id: 'batch-1', name: 'Update ESLint config across repos', prompt: 'Update ESLint configuration to use flat config format and fix all new warnings', targets: ['web-platform', 'api-server', 'shared-libs'], model: 'claude-sonnet-4.6', status: 'running', progress: { completed: 1, running: 1, queued: 1, failed: 0 }, startedAt: '2026-03-19T00:30:00Z' },
  { id: 'batch-2', name: 'Add LICENSE headers', prompt: 'Add MIT license header to all source files missing it', targets: ['TracePilot', 'api-server', 'web-platform', 'infrastructure', 'shared-libs'], model: 'claude-haiku-4.5', status: 'completed', progress: { completed: 5, running: 0, queued: 0, failed: 0 }, startedAt: '2026-03-18T22:00:00Z' },
];

const ORCH_AB_TESTS = [
  { id: 'ab-1', name: 'Opus vs GPT-5.4 on auth refactor', prompt: 'Refactor the authentication module to use OAuth 2.0 PKCE flow', variants: [
    { model: 'claude-opus-4.6', status: 'completed', tokensIn: 234000, tokensOut: 45000, duration: 1200000, turns: 8, linesAdded: 342, linesRemoved: 127, testsPassed: true, cost: 0.87 },
    { model: 'gpt-5.4', status: 'completed', tokensIn: 189000, tokensOut: 38000, duration: 980000, turns: 6, linesAdded: 298, linesRemoved: 115, testsPassed: true, cost: 0.62 },
  ], winner: 'claude-opus-4.6', startedAt: '2026-03-18T10:00:00Z' },
];

const ORCH_ACTIVITY = [
  { type: 'session_launched', message: 'Session launched in TracePilot (feat/orchestration)', time: '2026-03-19T00:15:00Z', icon: ORCH_ICONS.rocket },
  { type: 'worktree_created', message: 'Worktree created: TracePilot-wt-orch', time: '2026-03-19T00:15:01Z', icon: ORCH_ICONS.gitBranch },
  { type: 'session_error', message: 'Session sess-d9e4f1 hit build errors', time: '2026-03-19T00:42:00Z', icon: ORCH_ICONS.warning },
  { type: 'config_changed', message: 'explore agent model changed to claude-opus-4.6', time: '2026-03-18T23:50:00Z', icon: ORCH_ICONS.config },
  { type: 'batch_completed', message: 'Batch "Add LICENSE headers" completed (5/5 success)', time: '2026-03-18T22:45:00Z', icon: ORCH_ICONS.box },
  { type: 'budget_alert', message: 'Budget usage at 62% (187/300 premium requests)', time: '2026-03-18T22:00:00Z', icon: ORCH_ICONS.dollar },
];

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function formatDuration(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return `${h}h ${remM}m`;
}

function formatNumber(n) {
  if (n == null) return '—';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toString();
}

function formatCost(n) {
  if (n == null) return '—';
  return '$' + n.toFixed(2);
}

function formatRelativeTime(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function formatPct(n) {
  return Math.round(n) + '%';
}

function sessionStatusDot(status) {
  const colors = {
    working: 'var(--success-fg)',
    idle: 'var(--warning-fg)',
    error: 'var(--danger-fg)',
    waiting: 'var(--accent-fg)',
    completed: 'var(--done-fg)',
    queued: 'var(--neutral-fg)',
  };
  const color = colors[status] || colors.queued;
  const pulse = status === 'working' ? 'animation: pulse 2s infinite;' : '';
  return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};${pulse}"></span>`;
}

function modelTierBadge(model) {
  const m = ORCH_MODELS.find(x => x.id === model);
  if (!m) return `<span class="badge badge-neutral">${model}</span>`;
  const cls = m.tier === 'premium' ? 'badge-done' : m.tier === 'standard' ? 'badge-accent' : 'badge-neutral';
  return `<span class="badge ${cls}">${m.icon} ${m.name}</span>`;
}

function healthBadge(score) {
  if (score >= 80) return `<span class="badge badge-success">${score}</span>`;
  if (score >= 50) return `<span class="badge badge-warning">${score}</span>`;
  return `<span class="badge badge-danger">${score}</span>`;
}

// Theme toggling
function initTheme() {
  const saved = localStorage.getItem('tp-theme');
  if (saved === 'light') document.documentElement.setAttribute('data-theme', 'light');
}
function toggleTheme() {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  if (isLight) {
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('tp-theme', 'dark');
  } else {
    document.documentElement.setAttribute('data-theme', 'light');
    localStorage.setItem('tp-theme', 'light');
  }
  updateThemeIcon();
}
function updateThemeIcon() {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  document.querySelectorAll('.theme-icon').forEach(el => {
    el.textContent = isLight ? '☀️' : '🌙';
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  updateThemeIcon();
});
