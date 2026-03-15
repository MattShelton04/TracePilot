// ============================================================
// TracePilot Prototypes — Shared JavaScript
// Common interactivity, mock data, and utility functions
// ============================================================

// --- Theme Toggle ---
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

// --- Tab Switching ---
function initTabs() {
  document.querySelectorAll('.tab-nav-item').forEach(tab => {
    tab.addEventListener('click', (e) => {
      const group = tab.closest('.tab-nav');
      group.querySelectorAll('.tab-nav-item').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.tab;
      if (target) {
        document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');
        const panel = document.getElementById(target);
        if (panel) panel.style.display = 'block';
      }
    });
  });
}

// --- Collapsible Sections ---
function initCollapsibles() {
  document.querySelectorAll('[data-collapse]').forEach(trigger => {
    trigger.addEventListener('click', () => {
      const target = document.getElementById(trigger.dataset.collapse);
      if (target) {
        const isHidden = target.style.display === 'none';
        target.style.display = isHidden ? 'block' : 'none';
        trigger.classList.toggle('expanded', isHidden);
        const chevron = trigger.querySelector('.chevron');
        if (chevron) chevron.style.transform = isHidden ? 'rotate(90deg)' : 'rotate(0deg)';
      }
    });
  });
}

// --- Initialize on DOM ready ---
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  updateThemeIcon();
  initTabs();
  initCollapsibles();
});

// ============================================================
// MOCK DATA
// ============================================================

const MOCK_SESSIONS = [
  {
    id: "c86fe369-c858-4d91-81da-203c5e276e33",
    summary: "Implemented OAuth login with GitHub and Google providers",
    repository: "acme/web-platform",
    branch: "feat/oauth-login",
    hostType: "cli",
    eventCount: 2450,
    turnCount: 12,
    currentModel: "claude-opus-4.6",
    createdAt: "2026-03-14T09:30:00.000Z",
    updatedAt: "2026-03-14T11:45:00.000Z",
  },
  {
    id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    summary: "Refactored database connection pooling for PostgreSQL",
    repository: "acme/api-server",
    branch: "fix/db-pooling",
    hostType: "cli",
    eventCount: 1890,
    turnCount: 8,
    currentModel: "gpt-5.4",
    createdAt: "2026-03-14T14:00:00.000Z",
    updatedAt: "2026-03-14T15:30:00.000Z",
  },
  {
    id: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    summary: "Added comprehensive unit tests for payment processing module",
    repository: "acme/web-platform",
    branch: "test/payments",
    hostType: "cli",
    eventCount: 3200,
    turnCount: 18,
    currentModel: "claude-sonnet-4.6",
    createdAt: "2026-03-13T10:00:00.000Z",
    updatedAt: "2026-03-13T13:20:00.000Z",
  },
  {
    id: "d4e5f6a7-8901-2345-cdef-123456789012",
    summary: "Migrated legacy REST endpoints to GraphQL schema",
    repository: "acme/api-server",
    branch: "feat/graphql-migration",
    hostType: "cli",
    eventCount: 4100,
    turnCount: 22,
    currentModel: "claude-opus-4.6",
    createdAt: "2026-03-12T08:15:00.000Z",
    updatedAt: "2026-03-12T14:00:00.000Z",
  },
  {
    id: "e5f6a7b8-9012-3456-defa-234567890123",
    summary: "Fixed critical XSS vulnerability in user input sanitization",
    repository: "acme/web-platform",
    branch: "fix/xss-vuln",
    hostType: "cli",
    eventCount: 890,
    turnCount: 5,
    currentModel: "claude-opus-4.6",
    createdAt: "2026-03-14T16:00:00.000Z",
    updatedAt: "2026-03-14T16:45:00.000Z",
  },
  {
    id: "f6a7b8c9-0123-4567-efab-345678901234",
    summary: "Set up CI/CD pipeline with GitHub Actions and Docker",
    repository: "acme/infrastructure",
    branch: "feat/ci-pipeline",
    hostType: "cli",
    eventCount: 1560,
    turnCount: 10,
    currentModel: "gpt-5.4",
    createdAt: "2026-03-11T09:00:00.000Z",
    updatedAt: "2026-03-11T11:30:00.000Z",
  },
  {
    id: "17b8c9d0-1234-5678-fabc-456789012345",
    summary: "Implemented real-time WebSocket notifications system",
    repository: "acme/web-platform",
    branch: "feat/ws-notifications",
    hostType: "cli",
    eventCount: 2780,
    turnCount: 15,
    currentModel: "claude-opus-4.6",
    createdAt: "2026-03-10T13:00:00.000Z",
    updatedAt: "2026-03-10T17:15:00.000Z",
  },
  {
    id: "28c9d0e1-2345-6789-abcd-567890123456",
    summary: "Designed and implemented user dashboard analytics widgets",
    repository: "acme/web-platform",
    branch: "feat/dashboard",
    hostType: "cli",
    eventCount: 3450,
    turnCount: 20,
    currentModel: "claude-sonnet-4.6",
    createdAt: "2026-03-09T10:30:00.000Z",
    updatedAt: "2026-03-09T16:00:00.000Z",
  },
  {
    id: "39d0e1f2-3456-7890-bcde-678901234567",
    summary: "Optimized Webpack build configuration reducing bundle by 40%",
    repository: "acme/web-platform",
    branch: "perf/webpack-optimize",
    hostType: "cli",
    eventCount: 1200,
    turnCount: 7,
    currentModel: "gpt-5.4",
    createdAt: "2026-03-08T11:00:00.000Z",
    updatedAt: "2026-03-08T12:30:00.000Z",
  },
];

const MOCK_TURNS = [
  {
    turnIndex: 0,
    userMessage: "Please implement the login feature with OAuth support. We need GitHub and Google providers integrated with our existing auth module.",
    assistantMessages: ["I'll implement the OAuth login feature. Let me start by examining your existing auth module and then add GitHub and Google providers.\n\nFirst, let me look at the current project structure..."],
    model: "claude-opus-4.6",
    toolCalls: [
      { toolName: "view", success: true, durationMs: 85, args: "src/auth/index.ts" },
      { toolName: "view", success: true, durationMs: 62, args: "src/auth/providers/" },
      { toolName: "view", success: true, durationMs: 91, args: "package.json" },
    ],
    durationMs: 45000,
    isComplete: true,
    timestamp: "2026-03-14T09:30:00.000Z",
  },
  {
    turnIndex: 1,
    userMessage: "Looks good so far. Can you also add proper error handling and rate limiting?",
    assistantMessages: ["I'll add comprehensive error handling with custom error types and implement rate limiting using a sliding window approach.\n\nLet me create the error types first, then add the rate limiter middleware..."],
    model: "claude-opus-4.6",
    toolCalls: [
      { toolName: "create", success: true, durationMs: 120, args: "src/auth/errors.ts" },
      { toolName: "create", success: true, durationMs: 145, args: "src/auth/rate-limiter.ts" },
      { toolName: "edit", success: true, durationMs: 340, args: "src/auth/providers/github.ts" },
      { toolName: "edit", success: true, durationMs: 280, args: "src/auth/providers/google.ts" },
      { toolName: "powershell", success: false, durationMs: 2100, args: "npm test -- --filter auth" },
      { toolName: "edit", success: true, durationMs: 180, args: "src/auth/providers/github.ts" },
      { toolName: "powershell", success: true, durationMs: 1800, args: "npm test -- --filter auth" },
    ],
    durationMs: 89000,
    isComplete: true,
    timestamp: "2026-03-14T09:45:00.000Z",
  },
  {
    turnIndex: 2,
    userMessage: "Perfect. Now let's write integration tests for the OAuth flow.",
    assistantMessages: ["I'll create comprehensive integration tests covering the full OAuth flow for both providers, including error scenarios and edge cases..."],
    model: "claude-opus-4.6",
    toolCalls: [
      { toolName: "create", success: true, durationMs: 200, args: "tests/auth/oauth.test.ts" },
      { toolName: "create", success: true, durationMs: 180, args: "tests/auth/fixtures/mock-tokens.ts" },
      { toolName: "powershell", success: true, durationMs: 4500, args: "npm test -- --filter oauth" },
    ],
    durationMs: 67000,
    isComplete: true,
    timestamp: "2026-03-14T10:15:00.000Z",
  },
];

const MOCK_EVENTS = [
  { eventType: "session.start", timestamp: "2026-03-14T09:30:00.000Z", id: "evt-001" },
  { eventType: "user.message", timestamp: "2026-03-14T09:30:01.000Z", id: "evt-002" },
  { eventType: "assistant.turn_start", timestamp: "2026-03-14T09:30:02.000Z", id: "evt-003" },
  { eventType: "tool.execution_start", timestamp: "2026-03-14T09:30:03.000Z", id: "evt-004" },
  { eventType: "tool.execution_complete", timestamp: "2026-03-14T09:30:04.000Z", id: "evt-005" },
  { eventType: "tool.execution_start", timestamp: "2026-03-14T09:30:05.000Z", id: "evt-006" },
  { eventType: "tool.execution_complete", timestamp: "2026-03-14T09:30:06.000Z", id: "evt-007" },
  { eventType: "assistant.message", timestamp: "2026-03-14T09:30:07.000Z", id: "evt-008" },
  { eventType: "assistant.turn_end", timestamp: "2026-03-14T09:30:08.000Z", id: "evt-009" },
  { eventType: "user.message", timestamp: "2026-03-14T09:45:00.000Z", id: "evt-010" },
  { eventType: "assistant.turn_start", timestamp: "2026-03-14T09:45:01.000Z", id: "evt-011" },
  { eventType: "tool.execution_start", timestamp: "2026-03-14T09:45:02.000Z", id: "evt-012" },
  { eventType: "tool.execution_complete", timestamp: "2026-03-14T09:45:03.000Z", id: "evt-013" },
  { eventType: "tool.execution_start", timestamp: "2026-03-14T09:45:04.000Z", id: "evt-014" },
  { eventType: "tool.execution_complete", timestamp: "2026-03-14T09:45:05.000Z", id: "evt-015" },
  { eventType: "session.plan_changed", timestamp: "2026-03-14T09:50:00.000Z", id: "evt-016" },
  { eventType: "tool.execution_start", timestamp: "2026-03-14T09:50:01.000Z", id: "evt-017" },
  { eventType: "tool.execution_complete", timestamp: "2026-03-14T09:50:02.000Z", id: "evt-018" },
  { eventType: "assistant.message", timestamp: "2026-03-14T09:55:00.000Z", id: "evt-019" },
  { eventType: "assistant.turn_end", timestamp: "2026-03-14T09:55:01.000Z", id: "evt-020" },
];

const MOCK_TODOS = {
  todos: [
    { id: "user-auth", title: "Create user auth module", description: "Implement JWT-based authentication in src/auth/ with login, logout, and token refresh endpoints.", status: "done" },
    { id: "api-routes", title: "Add API routes", description: "Create REST endpoints for login, logout, refresh token.", status: "done" },
    { id: "oauth-providers", title: "OAuth provider integration", description: "Add GitHub and Google OAuth providers with proper scopes and token exchange.", status: "in_progress" },
    { id: "rate-limiting", title: "Implement rate limiting", description: "Sliding window rate limiter for auth endpoints (100 req/min).", status: "in_progress" },
    { id: "session-mgmt", title: "Session management", description: "Implement session storage and token refresh logic with Redis backend.", status: "pending" },
    { id: "integration-tests", title: "Write integration tests", description: "End-to-end tests for all auth flows including error scenarios.", status: "blocked" },
  ],
  deps: [
    { todoId: "api-routes", dependsOn: "user-auth" },
    { todoId: "oauth-providers", dependsOn: "user-auth" },
    { todoId: "session-mgmt", dependsOn: "oauth-providers" },
    { todoId: "session-mgmt", dependsOn: "rate-limiting" },
    { todoId: "integration-tests", dependsOn: "api-routes" },
    { todoId: "integration-tests", dependsOn: "session-mgmt" },
  ],
};

const MOCK_METRICS = {
  shutdownType: "normal",
  totalPremiumRequests: 1.33,
  totalApiDurationMs: 154200,
  currentModel: "claude-opus-4.6",
  codeChanges: {
    linesAdded: 342,
    linesRemoved: 56,
    filesModified: [
      "src/auth/index.ts",
      "src/auth/providers/github.ts",
      "src/auth/providers/google.ts",
      "src/auth/errors.ts",
      "src/auth/rate-limiter.ts",
      "tests/auth/oauth.test.ts",
      "tests/auth/fixtures/mock-tokens.ts",
      "package.json",
    ],
  },
  modelMetrics: {
    "claude-opus-4.6": {
      requests: { count: 32, cost: 0.87 },
      usage: {
        inputTokens: 892300,
        outputTokens: 45200,
        cacheReadTokens: 234000,
        cacheWriteTokens: 12000,
      },
    },
    "gpt-5.4": {
      requests: { count: 15, cost: 0.46 },
      usage: {
        inputTokens: 234100,
        outputTokens: 23400,
        cacheReadTokens: 89000,
        cacheWriteTokens: 5600,
      },
    },
    "claude-haiku-4.5": {
      requests: { count: 8, cost: 0.03 },
      usage: {
        inputTokens: 45000,
        outputTokens: 8200,
        cacheReadTokens: 12000,
        cacheWriteTokens: 0,
      },
    },
  },
};

const MOCK_CHECKPOINTS = [
  { number: 1, title: "Initial project scaffolding", filename: "001-initial-scaffolding.md" },
  { number: 2, title: "Auth module foundation", filename: "002-auth-module.md" },
  { number: 3, title: "OAuth providers integrated", filename: "003-oauth-providers.md" },
];

// --- Utility Functions ---
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
  return '$' + n.toFixed(4);
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

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function formatTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString();
}

function toolIcon(name) {
  const icons = {
    view: '👁', edit: '✏️', create: '📄', grep: '🔍', glob: '📂',
    powershell: '💻', bash: '💻', task: '🤖', read_agent: '📖',
    write_agent: '✍️', web_search: '🌐', web_fetch: '🌐',
    sql: '🗄️', ask_user: '💬', report_intent: '📋',
  };
  if (name && name.startsWith('github-mcp')) return '🐙';
  return icons[name] || '⚡';
}

function eventBadgeClass(eventType) {
  if (!eventType) return 'event-badge';
  if (eventType.startsWith('session')) return 'event-badge event-session';
  if (eventType.startsWith('user')) return 'event-badge event-user';
  if (eventType.startsWith('assistant')) return 'event-badge event-assistant';
  if (eventType.startsWith('tool')) return 'event-badge event-tool';
  if (eventType.startsWith('context')) return 'event-badge event-context';
  if (eventType.startsWith('subagent')) return 'event-badge event-subagent';
  return 'event-badge';
}

// SVG Icons as inline strings
const ICONS = {
  sessions: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>`,
  search: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="4.5"/><line x1="10.5" y1="10.5" x2="14" y2="14"/></svg>`,
  analytics: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="8" width="3" height="6" rx="0.5"/><rect x="6" y="4" width="3" height="10" rx="0.5"/><rect x="11" y="1" width="3" height="13" rx="0.5"/></svg>`,
  health: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 14s-5.5-3.5-5.5-7.5C2.5 3.5 4.5 2 6.5 2 7.3 2 8 2.5 8 2.5S8.7 2 9.5 2c2 0 4 1.5 4 4.5S8 14 8 14z"/></svg>`,
  export: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 2v8M4 6l4-4 4 4M2 12h12v2H2z"/></svg>`,
  settings: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="2.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.5 1.5M11.5 11.5L13 13M13 3l-1.5 1.5M4.5 11.5L3 13"/></svg>`,
  compare: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="1" width="5.5" height="14" rx="1"/><rect x="9.5" y="1" width="5.5" height="14" rx="1"/></svg>`,
  replay: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="5,3 13,8 5,13" fill="currentColor" stroke="none"/></svg>`,
  tools: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 2l4 4-8 8-4-4z"/><path d="M2 14l2-2"/></svg>`,
  code: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="5,4 1,8 5,12"/><polyline points="11,4 15,8 11,12"/><line x1="9" y1="2" x2="7" y2="14"/></svg>`,
  chevronRight: `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="4,2 8,6 4,10"/></svg>`,
  check: `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,7 6,10 11,4"/></svg>`,
  x: `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="3" x2="11" y2="11"/><line x1="11" y1="3" x2="3" y2="11"/></svg>`,
  clock: `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="5.5"/><polyline points="7,4 7,7 9.5,8.5"/></svg>`,
  spinner: `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="5.5" stroke-dasharray="24" stroke-dashoffset="8"/></svg>`,
  blocked: `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="5.5"/><line x1="3.5" y1="3.5" x2="10.5" y2="10.5"/></svg>`,
  pending: `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="5.5"/></svg>`,
};

function getStatusIcon(status) {
  switch(status) {
    case 'done': return `<span style="color:var(--success-fg)">${ICONS.check}</span>`;
    case 'in_progress': return `<span style="color:var(--accent-fg)">${ICONS.clock}</span>`;
    case 'blocked': return `<span style="color:var(--danger-fg)">${ICONS.blocked}</span>`;
    case 'pending': return `<span style="color:var(--neutral-fg)">${ICONS.pending}</span>`;
    default: return `<span style="color:var(--neutral-fg)">${ICONS.pending}</span>`;
  }
}

function getStatusBadgeClass(status) {
  switch(status) {
    case 'done': return 'badge-success';
    case 'in_progress': return 'badge-accent';
    case 'blocked': return 'badge-danger';
    case 'pending': return 'badge-neutral';
    default: return 'badge-neutral';
  }
}

// Helper to generate the sidebar HTML
function generateSidebar(activePage) {
  const navItems = [
    { id: 'sessions', label: 'Sessions', icon: ICONS.sessions, badge: '53', href: 'session-list.html' },
    { id: 'analytics', label: 'Analytics', icon: ICONS.analytics, href: 'analytics-dashboard.html' },
    { id: 'health', label: 'Health', icon: ICONS.health, href: 'health-scoring.html' },
    { id: 'tools', label: 'Tool Analysis', icon: ICONS.tools, href: 'tool-analysis.html' },
    { id: 'code', label: 'Code Impact', icon: ICONS.code, href: 'code-impact.html' },
  ];
  const advItems = [
    { id: 'compare', label: 'Compare', icon: ICONS.compare, href: 'session-comparison.html' },
    { id: 'replay', label: 'Replay', icon: ICONS.replay, href: 'session-replay.html' },
    { id: 'export', label: 'Export', icon: ICONS.export, href: 'export-dialog.html' },
    { id: 'settings', label: 'Settings', icon: ICONS.settings, href: 'settings.html' },
  ];

  let html = `
    <div class="sidebar-brand">
      <div class="sidebar-brand-icon">⏱</div>
      <span class="sidebar-brand-text">TracePilot</span>
    </div>
    <nav class="sidebar-nav" role="navigation" aria-label="Main navigation">
  `;

  navItems.forEach(item => {
    const isActive = activePage === item.id;
    html += `
      <a class="sidebar-nav-item${isActive ? ' active' : ''}" href="${item.href}">
        <span class="nav-icon">${item.icon}</span>
        <span>${item.label}</span>
        ${item.badge ? `<span class="sidebar-nav-badge">${item.badge}</span>` : ''}
      </a>
    `;
  });

  html += `<div class="sidebar-section-title">Advanced</div>`;

  advItems.forEach(item => {
    const isActive = activePage === item.id;
    html += `
      <a class="sidebar-nav-item${isActive ? ' active' : ''}" href="${item.href}">
        <span class="nav-icon">${item.icon}</span>
        <span>${item.label}</span>
      </a>
    `;
  });

  html += `
    </nav>
    <div class="sidebar-footer">
      <span class="sidebar-version">v0.2.0</span>
      <button class="theme-toggle" onclick="toggleTheme()">
        <span class="theme-icon">🌙</span>
      </button>
    </div>
  `;
  return html;
}
