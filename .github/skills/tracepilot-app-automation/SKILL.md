---
name: tracepilot-app-automation
description: >
  Launch, interact with, and collect diagnostics from the running TracePilot desktop
  app via Playwright + Chrome DevTools Protocol (CDP). Use this skill when you need
  to test UI flows end-to-end against the real Tauri IPC backend, reproduce bugs in
  the actual app, take screenshots, profile performance, validate IPC timing budgets,
  or collect telemetry for autonomous analysis and optimization.
---

# TracePilot App Automation Skill

This skill enables you to interact with the **running TracePilot desktop application**
(Tauri 2 + WebView2 + Vue 3) via Playwright connected over Chrome DevTools Protocol.
Unlike component-level Vitest tests which use jsdom mocks, this gives you access to
the real Rust backend, real IPC, real SQLite database, and real session data.

## Quick Start

### 1. Launch TracePilot with CDP Enabled

```powershell
.\scripts\e2e\launch.ps1
```

This starts TracePilot in dev mode with CDP debugging on a dynamically selected port
(9222–9232), bound to localhost only. It writes the port to
`scripts/e2e/.tracepilot-cdp.port` and the PID to `scripts/e2e/.tracepilot-cdp.<port>.pid`.

> **Note**: Only one TracePilot instance can run at a time (WebView2 locks its user
> data directory). If a stale instance exists, the launch script will clean it up first.

Wait for the script to report `TracePilot CDP Ready` before proceeding.

### 2. Connect via Playwright

```javascript
import { connect, collectTelemetry, startConsoleCapture, navigateTo } from './scripts/e2e/connect.mjs';

const { browser, page, context, port } = await connect();
// page is now a live Playwright Page connected to the TracePilot webview
```

Or run the smoke test directly:

```powershell
node scripts/e2e/smoke-test.mjs
```

### 3. Interact with the App

```javascript
// Click a session card
await page.locator('[data-testid="session-card"]').first().click();
await page.waitForTimeout(1500);

// Navigate via sidebar
await page.locator('[data-testid="nav-search"]').click();

// Type in search (use search-input-field for the fillable <input>)
await page.locator('[data-testid="search-input-field"]').fill('refactor');
await page.waitForTimeout(2000);

// Take a screenshot
await page.screenshot({ path: 'screenshot.png' });
```

### 4. Collect Telemetry

```javascript
const telemetry = await collectTelemetry(page, context);
console.log(telemetry.perf.mountTimings);   // Component mount durations
console.log(telemetry.ipc.perfLog);          // IPC call timings
console.log(telemetry.cdp.metrics);          // Heap size, DOM nodes, etc.
```

The telemetry object shape is:
```json
{
  "timestamp": "...",
  "url": "...",
  "perf": { "mountTimings": [...], "slowEntries": [...], "measures": [...] },
  "ipc":  { "perfLog": [...] },
  "cdp":  { "metrics": { "JSHeapUsedSize": ..., "Nodes": ..., ... } },
  "console": [...]
}
```

---

## Prerequisites

- **Node.js** ≥ 18 (already available in dev environment)
- **playwright-core** (installed as workspace dev dependency)
- **Rust toolchain + pnpm** (for `pnpm tauri dev`)
- **Windows** with Edge WebView2 runtime

The `connect.mjs` module uses `playwright-core` (no browser download needed — it
connects to the existing WebView2 instance via CDP).

---

## Architecture

```
TracePilot.exe (Tauri + WebView2)
  │
  │  CDP websocket (127.0.0.1:PORT)
  │
  ▼
Playwright (playwright-core)
  │
  ├── DOM access (click, type, assert, screenshot)
  ├── Console interception (perf warnings, errors)
  ├── page.evaluate() → window.__TRACEPILOT_PERF__
  ├── page.evaluate() → window.__TRACEPILOT_IPC_PERF__
  ├── CDP session → Performance.getMetrics (heap, nodes)
  └── CDP session → Tracing (chrome trace JSON)
```

Tauri IPC does NOT use HTTP — it uses internal message passing. Standard
`page.on('request')` won't capture IPC calls. Instead, use the built-in
instrumentation exposed on `window`:

- `window.__TRACEPILOT_PERF__` — Component mount timings, slow entry detection
- `window.__TRACEPILOT_IPC_PERF__` — Per-command IPC timing with slow-call warnings
- `window.__TRACEPILOT_READY__` — Boolean flag set after app mount + init

---

## Navigation Map

The app uses **hash-based routing** (`createWebHashHistory()`). Navigate by setting
`window.location.hash` or using the `navigateTo()` helper.

| Route | Page | Key testids |
|-------|------|-------------|
| `/#/` | Session List | `session-grid`, `session-card`, `session-search`, `session-toolbar` |
| `/#/session/:id/overview` | Session Detail | `session-tabs`, `session-tab-*`, `session-detail-content` |
| `/#/session/:id/conversation` | Conversation | `session-tab-session-conversation` |
| `/#/session/:id/events` | Events | `session-tab-session-events` |
| `/#/session/:id/todos` | Todos | `session-tab-session-todos` |
| `/#/session/:id/metrics` | Metrics | `session-tab-session-metrics` |
| `/#/session/:id/timeline` | Timeline | `session-tab-session-timeline` |
| `/#/search` | Deep Search | `search-input`, `search-input-field`, `nav-search` |
| `/#/analytics` | Analytics | `nav-analytics` |
| `/#/tools` | Tool Analysis | `nav-tools` |
| `/#/code` | Code Impact | `nav-code` |
| `/#/models` | Model Comparison | `nav-models` |
| `/#/settings` | Settings | `nav-settings` |
| `/#/orchestration` | Orchestration | `nav-orchestration`, `orchestration-actions` |
| `/#/orchestration/worktrees` | Worktrees | `nav-worktrees` |
| `/#/orchestration/launcher` | Launcher | `nav-launcher` |
| `/#/orchestration/config` | Config Injector | `nav-config-injector` |

### Navigation Helper

```javascript
import { navigateTo } from './scripts/e2e/connect.mjs';
await navigateTo(page, '/search');       // goes to /#/search
await navigateTo(page, '/analytics');    // goes to /#/analytics
```

---

## data-testid Reference

These selectors are stable automation anchors (not tied to CSS classes):

| Selector | Element | Location |
|----------|---------|----------|
| `[data-testid="app-sidebar"]` | Main sidebar nav | AppSidebar.vue |
| `[data-testid="nav-sessions"]` | Sessions nav link | AppSidebar.vue |
| `[data-testid="nav-search"]` | Search nav link | AppSidebar.vue |
| `[data-testid="nav-analytics"]` | Analytics nav link | AppSidebar.vue |
| `[data-testid="nav-settings"]` | Settings nav link | AppSidebar.vue |
| `[data-testid="nav-orchestration"]` | Orchestration nav link | AppSidebar.vue |
| `[data-testid="nav-worktrees"]` | Worktrees nav link | AppSidebar.vue |
| `[data-testid="nav-launcher"]` | Launcher nav link | AppSidebar.vue |
| `[data-testid="nav-config-injector"]` | Config nav link | AppSidebar.vue |
| `[data-testid="session-toolbar"]` | Session list toolbar | SessionListView.vue |
| `[data-testid="session-search"]` | Session list search wrapper | SessionListView.vue |
| `[data-testid="search-input-field"]` | Search input (fillable) | SearchInput.vue |
| `[data-testid="session-grid"]` | Session cards container | SessionListView.vue |
| `[data-testid="session-card"]` | Individual session card | SessionListView.vue |
| `[data-testid="session-tabs"]` | Session detail tab bar | TabNav.vue |
| `[data-testid="session-detail-content"]` | Detail tab content area | SessionDetailView.vue |
| `[data-testid="search-input"]` | Deep search input field | SessionSearchView.vue |
| `[data-testid="orchestration-actions"]` | Quick action grid | OrchestrationHomeView.vue |

---

## Telemetry Collection Recipes

### Console Log Capture

```javascript
import { startConsoleCapture } from './scripts/e2e/connect.mjs';

const capture = startConsoleCapture(page);
// ... perform actions ...
const logs = capture.getLogs();
capture.stop();

// Filter for performance warnings
const perfWarnings = logs.filter(l =>
  l.text.includes('[ipc:SLOW]') || l.text.includes('[perf]')
);
```

The app automatically logs these to console in dev mode:
- `[ipc:SLOW] <command> took <ms>ms` — IPC calls exceeding 100ms
- `[perf] Slow mount: <component> <ms>ms` — Components > 50ms mount time
- `[perf] Long task: <ms>ms` — Main thread blocks > 50ms

### IPC Timing Extraction

```javascript
const ipcLog = await page.evaluate(() =>
  window.__TRACEPILOT_IPC_PERF__?.getIpcPerfLog() ?? []
);
// Returns: [{ cmd: 'list_sessions', duration: 142, timestamp: 1719... }, ...]
```

### CDP Performance Metrics

```javascript
const cdpSession = await context.newCDPSession(page);
await cdpSession.send('Performance.enable');
const { metrics } = await cdpSession.send('Performance.getMetrics');
await cdpSession.detach();

// Key metrics: JSHeapUsedSize, JSHeapTotalSize, Nodes, Documents,
// LayoutCount, RecalcStyleCount, ScriptDuration
```

### Chrome Trace Capture

```javascript
await browser.startTracing(page, {
  path: 'trace.json',
  screenshots: true,
  categories: ['devtools.timeline'],
});
// ... perform actions ...
await browser.stopTracing();
// Load trace.json in chrome://tracing for analysis
```

### Component Mount Timings

```javascript
const perfLog = await page.evaluate(() =>
  window.__TRACEPILOT_PERF__?.getPerfLog() ?? []
);
// Returns: [{ name: 'SessionListView:mount', duration: 5.2, ... }, ...]
```

### Performance Budget Validation

```javascript
import { validateBudgets, collectTelemetry } from './scripts/e2e/connect.mjs';

const telemetry = await collectTelemetry(page, context);
const result = validateBudgets(telemetry, 'perf-budget.json');

if (!result.passed) {
  for (const v of result.violations) {
    console.error(`BUDGET EXCEEDED: ${v.command} ${v.actual}${v.unit} > ${v.budget}${v.unit}`);
  }
}
```

The `perf-budget.json` at repo root defines IPC timing budgets:
- `listSessions`: 200ms
- `getSessionDetail`: 100ms
- `searchContent`: 500ms
- etc.

> **Note:** Not all IPC commands have budgets. Notably `get_search_facets` (observed
> at 2.2s), `check_system_deps` (~1s), and `get_shutdown_metrics` (~1s) have no
> budget entries and will pass validation silently. Check `perf-budget.json` to see
> what's covered.

---

## IPC Command Surface (85 commands)

When you need to test or invoke specific backend functionality, here's the full
command surface available via `plugin:tracepilot|<command>`:

**Sessions (12):** `list_sessions`, `get_session_detail`, `get_session_incidents`,
`get_session_turns`, `check_session_freshness`, `get_session_events`,
`get_session_todos`, `get_session_checkpoints`, `get_session_plan`,
`get_shutdown_metrics`, `get_tool_result`, `resume_session_in_terminal`

**Search (13):** `search_sessions`, `search_content`, `get_search_facets`,
`get_search_stats`, `get_search_repositories`, `get_search_tool_names`,
`rebuild_search_index`, `reindex_sessions`, `reindex_sessions_full`,
`fts_integrity_check`, `fts_optimize`, `fts_health`, `get_result_context`

**Analytics (3):** `get_analytics`, `get_tool_analysis`, `get_code_impact`

**Config (24):** `check_config_exists`, `get_config`, `save_config`,
`validate_session_dir`, `factory_reset`, `get_agent_definitions`, and 18 more

**Orchestration (20):** `check_system_deps`, `list_worktrees`, `create_worktree`,
`remove_worktree`, `launch_session`, `get_available_models`, and 14 more

**State (6):** `get_db_size`, `get_session_count`, `is_session_running`,
`get_install_type`, `check_for_updates`, `get_git_info`

**Logging (2):** `get_log_path`, `export_logs`

**Export (5):** `export_sessions`, `preview_export`, `get_session_sections`,
`preview_import`, `import_sessions`

---

## Tips & Gotchas

### Always use `.mjs` files, not inline scripts
PowerShell and inline Node ES module scripts don't mix well (quote escaping issues).
Always write automation as `.mjs` files and run with `node script.mjs`, never with
`node -e "..."`.

### Clear IPC perf log before your test flow
The IPC perf log accumulates across the app lifetime. If you don't call
`clearIpcPerfLog()` at the start, you'll measure stale entries from earlier
navigation. Always clear first:

```javascript
await page.evaluate(() => window.__TRACEPILOT_IPC_PERF__?.clearIpcPerfLog());
// ... now perform your test flow ...
const fresh = await page.evaluate(() => window.__TRACEPILOT_IPC_PERF__?.getIpcPerfLog());
```

### Route transitions need settling time
`navigateTo()` includes a 1-second wait, but data-heavy views need more:
- **Session list** (192+ sessions): wait 2s for grid render
- **Analytics** (chart rendering): wait 2s
- **Session detail** (large sessions): wait 2-3s for all tabs to load data
- Use `page.waitForTimeout()` after navigation, NOT `page.waitForNavigation()`
  (hash routing doesn't trigger navigation events)

### Tab labels include counts
Tab buttons show counts like "Conversation 470" and "Events 8783". Use
`data-testid` selectors (`[data-testid^="session-tab-"]`), not text matching.

### Check if the app is already running
Before running `launch.ps1` or `pnpm tauri dev`, check if TracePilot is already
running with CDP enabled:

```powershell
try { (Invoke-RestMethod http://127.0.0.1:9222/json/version -TimeoutSec 2) } catch { "Not running" }
```

If it's already up, skip the launch step and connect directly.

### Always use `127.0.0.1`, never `localhost`
CDP binds to `127.0.0.1` (IPv4). On Windows, `localhost` may resolve to `::1` (IPv6),
causing silent connection failures. All scripts use `127.0.0.1` explicitly.

### Incremental Rust builds
`pnpm tauri dev` uses incremental compilation. If only frontend files changed,
the rebuild is fast (<5s via Vite HMR). If Rust source changed, expect 30-60s for
incremental recompilation. The app window won't appear until compilation completes —
poll for CDP readiness rather than assuming a fixed wait time.

### Shutting down the app
Always shut down TracePilot when you're done to avoid orphan processes:

```javascript
import { connect, shutdown } from './scripts/e2e/connect.mjs';
const { browser, page, port } = await connect();
// ... do work ...
await shutdown(browser, port); // disconnects Playwright + kills this specific instance
```

Or from PowerShell:
```powershell
.\scripts\e2e\stop.ps1             # stops the most recent instance
.\scripts\e2e\stop.ps1 -Port 9222  # stops a specific instance
.\scripts\e2e\stop.ps1 -All        # stops ALL tracked instances
```

### Single-instance limitation
WebView2 locks its user data directory, so only one TracePilot instance can run at a
time. If you need a fresh instance, shut down the current one first:

```javascript
await shutdown(browser, port);
// then launch again
```

### Session List DOM scales with session count
With 192 sessions, the session list creates ~4,100 DOM nodes. This is 6x larger
than any other route. With larger session directories, expect proportionally more
nodes and slower mount times (~107ms at 192 sessions).

---

## Troubleshooting

### CDP port already in use
The launch script scans ports 9222–9232 automatically. If all are busy, kill stale
processes: check `scripts/e2e/.tracepilot-cdp.<port>.pid` for the last known PID,
or run `.\scripts\e2e\stop.ps1 -All` to clean up.

### `page.evaluate()` not working
CDP protocol commands bypass CSP. If `page.evaluate()` fails in a built binary,
use direct CDP session commands instead (Performance.getMetrics, etc.).

### Vite HMR breaking CDP connection
If using `pnpm tauri dev`, Vite HMR can occasionally break the WebSocket connection.
Reconnect or use `pnpm tauri build` for stable test runs.

### App not appearing ready
The connection helper polls for `window.__TRACEPILOT_READY__`. If the app hangs
during initialization, check console logs for errors:

```javascript
const capture = startConsoleCapture(page);
// wait...
console.log(capture.getLogs().filter(l => l.type === 'error'));
```

### Screenshots are blank or wrong size
WebView2 renders at system DPI. Screenshots may differ across machines. Use element
selectors rather than coordinate-based assertions.

---

## Cross-Reference

- **Performance Playbook**: `docs/performance-playbook.md` — Criterion benchmarks,
  flamegraphs, dhat, SQLite profiling, bundle analysis
- **Performance Budgets**: `perf-budget.json` — IPC timing thresholds
- **Agent Automation Report**: `docs/agent-automation-report.md` — Full design doc
  with PoC results and reviewer feedback
