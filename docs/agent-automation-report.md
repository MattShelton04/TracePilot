# TracePilot Agent Automation — Report & Implementation Plan

## Problem Statement

TracePilot is a Tauri 2 desktop app (Rust backend + Vue 3 frontend) that visualizes
GitHub Copilot CLI sessions. Its test infrastructure today is strong for unit/component
tests (Vitest + jsdom) but has **zero end-to-end tests** against the real running
application. There is no way for an AI agent (or any automation) to interact with the
actual Tauri webview backed by real Rust IPC.

This report details how to "close the loop" — enabling AI agents (specifically Copilot
CLI) to launch, drive, inspect, and analyze the running TracePilot desktop app.

---

## 1. Current State

### What exists
| Layer | Coverage | Tool |
|-------|----------|------|
| Rust crates | ~489 tests | `cargo test` |
| Vue components/stores | ~421 tests | Vitest + jsdom |
| UI package | Good | Vitest + jsdom |
| Benchmarks | Criterion suites | `cargo bench` |
| Bundle analysis | CI-enforced budgets | Vite + rollup-plugin-visualizer |

### What's missing
- **No Playwright / Cypress / WebDriver** — zero browser automation
- **No launched-app E2E tests** — nothing starts the Tauri binary
- **No Tauri IPC integration tests** — command wiring untested end-to-end
- **No visual regression** testing
- **No automated telemetry collection** from the running app

### Existing instrumentation (leverage-ready)
The app already ships dev-mode diagnostics that are **ideal** for agent consumption:

| Instrument | Access | What it provides |
|------------|--------|-----------------|
| `__TRACEPILOT_PERF__` | `window` global | Component mount timings, slow-entry detection |
| IPC perf log | `getIpcPerfLog()` via `@tracepilot/client` | Per-command IPC timing with slow-call warnings |
| Long Task Observer | Console warnings | >50ms main-thread blocks |
| Tauri log plugin | Stdout + log file + webview bridge | Rust-side structured logs (slow SQL, errors) |
| `performance.*` API | Standard browser | Navigation timing, custom marks/measures |

---

## 2. Recommended Approach: Playwright + CDP over WebView2

### Why Playwright + CDP?

Tauri 2 on Windows uses **Edge WebView2** (Chromium-based). By enabling the Chrome
DevTools Protocol (CDP) remote debugging port, Playwright can connect to the running
webview exactly as it would to a regular Chromium browser. This gives us:

- Full DOM access (click, type, assert, screenshot)
- Console log interception (`page.on('console')`)
- Network request monitoring (`page.on('request')` / `page.on('response')`)
- Performance trace capture (`browser.startTracing()`)
- Raw CDP session access for low-level profiling
- JavaScript evaluation in the webview context (`page.evaluate()`)

### How it works

```
┌──────────────────┐     CDP (ws://localhost:9222)     ┌──────────────┐
│  TracePilot.exe  │◄──────────────────────────────────►│  Playwright  │
│  (Tauri + WV2)   │                                    │  (Node.js)   │
└──────────────────┘                                    └──────────────┘
        │                                                      │
        │  Real Rust IPC                              Agent scripts
        │  Real filesystem                            (skill / CLI)
        │  Real SQLite                                         │
        ▼                                                      ▼
   Session data                                     Telemetry JSON
   (~/.copilot/session-state/)                      Screenshots
                                                    Analysis reports
```

### Enabling CDP in Tauri (dev/test builds only)

**Option A — Environment variable (simplest, recommended):**
```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"
pnpm tauri dev
```

**Option B — Rust-side for test builds:**
```rust
// In main.rs, gated behind a feature flag or debug_assertions
#[cfg(debug_assertions)]
std::env::set_var(
    "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
    "--remote-debugging-port=9222",
);
```

**Option C — Tauri config (additionalBrowserArgs):**
```json
{
  "windows": [{
    "webviewAttributes": {
      "additionalBrowserArgs": "--remote-debugging-port=9222"
    }
  }]
}
```

> ⚠️ **Security**: CDP must NEVER be enabled in production builds. Options A or B
> are preferred because they're opt-in.

### Connecting Playwright

```typescript
import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://localhost:9222');
const context = browser.contexts()[0];
const page = context.pages()[0];

// Now interact with the real TracePilot app
await page.click('[data-testid="session-card"]');
await page.waitForSelector('[data-testid="session-detail"]');
```

### Alternative: `@srsholmes/tauri-playwright`

A community package that adds a Rust-side Tauri plugin + socket bridge for deeper
Playwright integration. It can invoke IPC commands directly from tests. However:

- **Pros**: Cleaner architecture, direct IPC testing
- **Cons**: Additional Rust dependency, less mature, smaller community
- **Verdict**: Start with CDP (zero dependencies), evaluate `tauri-playwright` later

---

## 3. Telemetry & Diagnostics Collection

This is the "massive bonus" — enabling agents to autonomously collect and analyze
performance data from the running app.

### 3.1 Console Logs

```typescript
const logs: { type: string; text: string; timestamp: number }[] = [];

page.on('console', (msg) => {
  logs.push({
    type: msg.type(),
    text: msg.text(),
    timestamp: Date.now(),
  });
});
```

This captures:
- `[perf] Slow mount: ...` warnings from `usePerfMonitor`
- `[ipc:SLOW] ...` warnings from IPC timing
- `[perf] Long task: ...` from the Long Task Observer
- Any `console.error` / `console.warn` from the app
- Rust-side logs forwarded to webview (if `attachConsole` is enabled)

### 3.2 IPC Performance Metrics

```typescript
// Extract the IPC performance log from the app's internal instrumentation
const ipcMetrics = await page.evaluate(() => {
  // @tracepilot/client exposes this on window in dev mode
  const { getIpcPerfLog } = window.__TAURI_INTERNALS__
    ? await import('@tracepilot/client')
    : { getIpcPerfLog: () => [] };
  return getIpcPerfLog();
});

// Or use the existing perf monitor
const perfSummary = await page.evaluate(() => {
  return window.__TRACEPILOT_PERF__?.getPerfLog() ?? [];
});
```

### 3.3 Network / IPC Request Monitoring

Tauri IPC doesn't use HTTP, so standard network monitoring won't catch it. However:

**Strategy 1 — Leverage the built-in IPC perf log:**
The `invokePlugin()` wrapper already times every IPC call. We can extract this via
`page.evaluate()`.

**Strategy 2 — CDP Network domain for any HTTP calls:**
```typescript
page.on('request', (req) => {
  if (req.url().includes('github.com')) {
    networkLog.push({ url: req.url(), method: req.method() });
  }
});
```

**Strategy 3 — CDP Performance domain for deep profiling:**
```typescript
const cdpSession = await context.newCDPSession(page);
await cdpSession.send('Performance.enable');
const metrics = await cdpSession.send('Performance.getMetrics');
// Returns: JSHeapUsedSize, Nodes, LayoutCount, RecalcStyleCount, etc.
```

### 3.4 Chrome Trace Capture

```typescript
await browser.startTracing(page, {
  path: 'trace.json',
  screenshots: true,
  categories: ['devtools.timeline'],
});

// ... perform user actions ...

await browser.stopTracing();
// trace.json can be loaded in chrome://tracing or analyzed programmatically
```

### 3.5 Performance API Extraction

```typescript
const navTiming = await page.evaluate(() => {
  const nav = performance.getEntriesByType('navigation')[0];
  return JSON.parse(JSON.stringify(nav));
});

const customMarks = await page.evaluate(() => {
  return performance.getEntriesByType('measure').map(m => ({
    name: m.name,
    duration: m.duration,
    startTime: m.startTime,
  }));
});
```

### 3.6 Screenshot Capture

```typescript
await page.screenshot({ path: 'session-list.png', fullPage: true });
```

### 3.7 Combining with Existing Performance Playbook

The `perf-budget.json` defines IPC timing budgets. An agent can validate these:

```typescript
const budgets = JSON.parse(fs.readFileSync('perf-budget.json', 'utf-8'));

// Navigate to session list, measure IPC timing
await page.goto('/#/');
await page.waitForSelector('[data-testid="session-card"]');

const ipcLog = await page.evaluate(() =>
  window.__TRACEPILOT_PERF__?.getPerfLog() ?? []
);

// Validate against budgets
const listSessionsTime = ipcLog.find(e => e.name.includes('listSessions'));
if (listSessionsTime && listSessionsTime.duration > budgets.ipc.listSessionsMs) {
  console.error(`BUDGET EXCEEDED: listSessions took ${listSessionsTime.duration}ms`);
}
```

---

## 4. Skill Architecture — One Skill or Multiple?

### Recommendation: Two skills

The scope naturally splits into two concerns with different invocation patterns:

#### Skill 1: `tracepilot-app-interaction` (Primary)
**Purpose**: Launch, connect to, and interact with the running TracePilot app.

**When to use**: When the agent needs to test UI flows, verify features work end-to-end,
reproduce bugs, or take screenshots of the running app.

**Contents**:
- `SKILL.md` — Instructions for launching the app with CDP, connecting Playwright,
  navigating the app, interacting with UI elements
- `scripts/launch-app.ps1` — Start TracePilot with CDP enabled
- `scripts/connect.ts` — Playwright connection helper
- `scripts/health-check.ts` — Verify the app is running and responsive
- Route/page reference for navigation
- data-testid conventions (we'd need to add these)

#### Skill 2: `tracepilot-diagnostics` (Companion)
**Purpose**: Collect and analyze performance metrics, logs, and telemetry from a
running TracePilot instance.

**When to use**: When the agent needs to profile performance, debug slow IPC calls,
analyze console errors, validate performance budgets, or generate diagnostic reports.

**Contents**:
- `SKILL.md` — Instructions for collecting telemetry, analyzing perf data
- `scripts/collect-telemetry.ts` — Comprehensive telemetry collector
- `scripts/validate-budgets.ts` — Check against `perf-budget.json`
- `scripts/analyze-ipc.ts` — IPC timing analysis
- Reference to existing `performance-playbook.md`
- Integration with Criterion benchmarks and bundle analysis

### Why two skills instead of one?

1. **Separation of concerns**: Interaction ≠ diagnostics. An agent fixing a UI bug
   doesn't need the diagnostics playbook, and an agent profiling performance doesn't
   need navigation instructions.

2. **Context efficiency**: Skills are loaded into context. A single mega-skill would
   consume more tokens for every invocation, even when only half is needed.

3. **Composability**: The diagnostics skill can be used independently (e.g., after
   manual testing) or composed with the interaction skill.

4. **Maintainability**: Performance budgets and telemetry APIs change independently
   from UI structure and navigation.

### Why NOT three or more?

- A third "CI/E2E test runner" skill would be premature — we need the foundation first
- The diagnostics scope is narrow enough to stay in one skill
- Over-splitting creates skill discovery problems

---

## 5. Skill Definitions

### Skill 1: `tracepilot-app-interaction`

```yaml
---
name: tracepilot-app-interaction
description: >
  Launch and interact with the running TracePilot desktop app via Playwright + CDP.
  Use this skill when you need to test UI flows, verify features end-to-end,
  reproduce bugs, take screenshots, or interact with the actual Tauri webview
  backed by real Rust IPC. Requires the app to be running with CDP enabled.
---
```

**Skill body would include:**

1. **Prerequisites check** — Verify Node.js, Playwright, Rust toolchain
2. **Launch sequence** — How to start the app with CDP
3. **Connection recipe** — Playwright `connectOverCDP` boilerplate
4. **Navigation map** — All routes with selectors
5. **Common interaction patterns** — Session list, session detail tabs, search,
   analytics, orchestration, settings
6. **IPC command reference** — What backend commands exist (for `page.evaluate`
   direct invocation)
7. **Troubleshooting** — Common issues (CDP port busy, WebView2 not found, etc.)

### Skill 2: `tracepilot-diagnostics`

```yaml
---
name: tracepilot-diagnostics
description: >
  Collect and analyze performance metrics, console logs, IPC timing, and telemetry
  from a running TracePilot instance. Use this skill when profiling performance,
  debugging slow operations, validating performance budgets, or generating
  diagnostic reports. Works with both the running app (via CDP) and offline
  analysis of benchmark/trace data.
---
```

**Skill body would include:**

1. **Telemetry collection recipes** — Console, IPC, Performance API, CDP metrics
2. **Performance budget validation** — Against `perf-budget.json`
3. **Trace capture workflow** — Chrome trace recording + analysis
4. **Rust-side profiling** — Criterion benchmarks, flamegraphs, dhat
5. **Bundle analysis** — Vite analyze mode
6. **Diagnostic report generation** — Structured output format
7. **Integration with performance-playbook.md** — Cross-reference

---

## 6. Implementation Roadmap

### Phase 1: Foundation (Required first)
1. **Add `data-testid` attributes** to key interactive elements across the app
   - Session cards, detail tabs, search input, nav items, buttons
   - This is non-negotiable for reliable automation
2. **Add CDP launch script** (`scripts/launch-cdp.ps1`)
3. **Install Playwright** as a dev dependency (`pnpm add -D playwright @playwright/test`)
4. **Create connection helper** (`scripts/e2e/connect.ts`)
5. **Verify basic connectivity** — script that launches app, connects, takes screenshot

### Phase 2: Skill Creation
6. **Create `.github/skills/tracepilot-app-interaction/SKILL.md`**
7. **Create `.github/skills/tracepilot-diagnostics/SKILL.md`**
8. **Add helper scripts** referenced by skills

### Phase 3: Telemetry Bridge
9. **Expose IPC perf log on window** (similar to `__TRACEPILOT_PERF__`)
   - `window.__TRACEPILOT_IPC_PERF__` = `{ getIpcPerfLog, clearIpcPerfLog }`
10. **Add structured telemetry export** — JSON dump of all diagnostics
11. **Create budget validation script**

### Phase 4: CI Integration (Future)
12. **Add E2E test job to CI** — Launch app, run smoke tests, collect telemetry
13. **Automated performance regression detection**

---

## 7. Required Code Changes

### 7.1 Minimal changes to existing code

**`apps/desktop/src-tauri/src/main.rs`** — Add CDP flag for debug builds:
```rust
#[cfg(debug_assertions)]
if std::env::var("TRACEPILOT_CDP").is_ok() {
    std::env::set_var(
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
        "--remote-debugging-port=9222",
    );
}
```

**`packages/client/src/invoke.ts`** — Expose IPC perf log on window:
```typescript
if (typeof window !== "undefined") {
  (window as any).__TRACEPILOT_IPC_PERF__ = {
    getIpcPerfLog,
    clearIpcPerfLog,
  };
}
```

**Various Vue components** — Add `data-testid` attributes to key elements.

### 7.2 New files

```
.github/skills/
  tracepilot-app-interaction/
    SKILL.md
  tracepilot-diagnostics/
    SKILL.md
scripts/e2e/
  launch-cdp.ps1        # Launch app with CDP enabled
  connect.ts            # Playwright connection helper
  health-check.ts       # Verify app is running
  collect-telemetry.ts  # Comprehensive telemetry collection
  validate-budgets.ts   # Check against perf-budget.json
  smoke-test.ts         # Basic E2E smoke test
```

---

## 8. Example: Full Agent Workflow

Here's what an AI agent session would look like using these skills:

```
User: "The session list is loading slowly. Profile it and suggest improvements."

Agent (using tracepilot-app-interaction skill):
  1. Runs scripts/e2e/launch-cdp.ps1 to start app with CDP
  2. Connects via Playwright
  3. Navigates to session list

Agent (using tracepilot-diagnostics skill):
  4. Starts console log collection
  5. Starts Chrome trace recording
  6. Triggers a page reload to capture fresh metrics
  7. Stops trace recording
  8. Extracts __TRACEPILOT_PERF__ data
  9. Extracts __TRACEPILOT_IPC_PERF__ data
  10. Extracts CDP Performance.getMetrics
  11. Validates against perf-budget.json
  12. Generates diagnostic report:
      - listSessions IPC: 340ms (budget: 200ms) ❌
      - SessionListView mount: 120ms (threshold: 50ms) ❌
      - 2 long tasks detected (85ms, 62ms)
      - Heap size: 45MB
  13. Reads Rust-side slow SQL warnings from logs
  14. Suggests: "The listSessions IPC call exceeds budget by 70%.
      The slow SQL warning shows the sessions query taking 280ms.
      Recommend adding an index on session_date column."
```

---

## 9. Verified Proof-of-Concept Results

The following was verified live against TracePilot v0.6.0 running with CDP enabled:

### Connection & Navigation
```
✅ Playwright connected to WebView2 via CDP (localhost:9222)
✅ Page title: "TracePilot"
✅ Vue app mounted (#root found)
✅ __TRACEPILOT_PERF__ available on window
✅ __TAURI_INTERNALS__ present (real Tauri IPC active)
✅ Clicked session card → navigated to /session/:id/overview
✅ Hash-based navigation to #/search, #/analytics works
✅ Screenshot capture works (1440×960 full app)
✅ Found 192 session cards (real data)
```

### Telemetry Collection (live capture)
```
Component mount timings:
  SessionListView:mount   — 5.2ms
  SessionDetailView:mount — 2.2ms
  AnalyticsDashboardView  — 4.1ms

Console warnings captured automatically:
  [ipc:SLOW] get_search_facets took 2193.7ms   ← would fail perf budget
  [ipc:SLOW] fts_health took 917.2ms
  [ipc:SLOW] get_search_stats took 430.0ms
  [ipc:SLOW] get_session_detail took 153.6ms
  [ipc:SLOW] get_shutdown_metrics took 151.5ms
  [ipc:SLOW] get_session_turns took 129.5ms
  [perf] Long task: 53.0ms

CDP Performance metrics:
  JSHeapUsedSize:   34.2MB
  JSHeapTotalSize:  102.6MB
  DOM Nodes:        12,411
  Documents:        3
```

### Key Finding
The IPC perf log and console warning capture worked **out of the box** — no code
changes needed. The existing `invokePlugin()` timing instrumentation and
`usePerfMonitor` composable are directly consumable via `page.evaluate()`. This
means Phase 1 can deliver value immediately with just the CDP launch script.

---

## 10. Known Limitations & Risks

| Risk | Mitigation |
|------|------------|
| CDP only works on Windows (WebView2) | TracePilot currently only targets Windows |
| CDP port conflicts | Use configurable port, health-check before connecting |
| WebView2 version differences | Pin minimum WebView2 runtime version |
| `data-testid` maintenance burden | Convention doc + lint rule |
| App startup time adds to test duration | Reuse running instance across tests |
| Mock fallback breaks when testing real IPC | CDP approach tests the REAL app, not mocks |
| Security: CDP in production | Feature-flag / env-var gating only |

---

## 11. References

- [Playwright WebView2 Documentation](https://playwright.dev/docs/webview2)
- [Tauri CDP Example (Haprog)](https://github.com/Haprog/tauri-cdp)
- [Playwright CDP Example](https://github.com/Haprog/playwright-cdp)
- [Tauri Testing Docs](https://v2.tauri.app/develop/tests/)
- [tauri-playwright Package](https://github.com/srsholmes/tauri-playwright)
- [Playwright + CDP Supercharging](https://www.thegreenreport.blog/articles/supercharging-playwright-tests-with-chrome-devtools-protocol/)
- [WebView2 Browser Flags (Microsoft)](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/webview-features-flags)
- [Creating Agent Skills for GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-skills)

---

## 12. Appendix: TracePilot IPC Command Surface

For agent reference, the full IPC surface exposed by `plugin:tracepilot|*`:

### Sessions (12 commands)
`list_sessions`, `get_session_detail`, `get_session_incidents`, `get_session_turns`,
`check_session_freshness`, `get_session_events`, `get_session_todos`,
`get_session_checkpoints`, `get_session_plan`, `get_shutdown_metrics`,
`get_tool_result`, `resume_session_in_terminal`

### Search & Indexing (13 commands)
`search_sessions`, `search_content`, `get_search_facets`, `get_search_stats`,
`get_search_repositories`, `get_search_tool_names`, `rebuild_search_index`,
`reindex_sessions`, `reindex_sessions_full`, `fts_integrity_check`, `fts_optimize`,
`fts_health`, `get_result_context`

### Analytics (3 commands)
`get_analytics`, `get_tool_analysis`, `get_code_impact`

### Config & Copilot (24 commands)
`check_config_exists`, `get_config`, `save_config`, `validate_session_dir`,
`factory_reset`, `get_agent_definitions`, `save_agent_definition`,
`get_copilot_config`, `save_copilot_config`, `create_config_backup`,
`list_config_backups`, `restore_config_backup`, `delete_config_backup`,
`preview_backup_restore`, `diff_config_files`, `discover_copilot_versions`,
`get_active_copilot_version`, `get_migration_diffs`, `migrate_agent_definition`,
`list_session_templates`, `save_session_template`, `delete_session_template`,
`restore_default_templates`, `increment_template_usage`

### Orchestration (20 commands)
`check_system_deps`, `list_worktrees`, `create_worktree`, `remove_worktree`,
`prune_worktrees`, `list_branches`, `get_worktree_disk_usage`, `is_git_repo`,
`lock_worktree`, `unlock_worktree`, `get_worktree_details`, `get_default_branch`,
`fetch_remote`, `list_registered_repos`, `add_registered_repo`,
`remove_registered_repo`, `toggle_repo_favourite`, `discover_repos_from_sessions`,
`launch_session`, `get_available_models`, `open_in_explorer`, `open_in_terminal`

### State (6 commands)
`get_db_size`, `get_session_count`, `is_session_running`, `get_install_type`,
`check_for_updates`, `get_git_info`

### Logging (2 commands)
`get_log_path`, `export_logs`

### Export/Import (5 commands)
`export_sessions`, `preview_export`, `get_session_sections`, `preview_import`,
`import_sessions`

**Total: 85 IPC commands**

---

## 14. Reviewer Feedback & Revisions

The report was reviewed by three independent AI models (Claude Opus 4.6, GPT 5.4,
GPT 5.3 Codex). Below is a consolidated summary of their feedback, organized by
consensus strength, followed by the revisions made to the plan.

### 14.1 Unanimous/Strong Consensus (all three flagged)

#### 🔴 CSP May Block `page.evaluate()` — CRITICAL TO VERIFY
**Opus (blocker)**: The existing CSP is `script-src 'self'` which blocks inline
script injection. Playwright's `page.evaluate()` works via CDP protocol commands
which typically bypass CSP, but this needs explicit verification. If it doesn't work
in release builds, we'd need to either relax CSP in test builds or rely solely on
CDP protocol commands.

**Status**: The PoC DID work with `page.evaluate()` in dev mode. This may be because
`tauri dev` has different CSP enforcement. **Action: Verify against a built binary
before relying on it.** CDP protocol commands (Performance.getMetrics, etc.) bypass
CSP entirely and should be the primary strategy.

#### 🔴 No Test Fixture / Deterministic Data Strategy
**All three**: How are sessions seeded/reset between runs? The app reads from
`~/.copilot/session-state/` — E2E tests need reproducible data. Options:
1. Use the existing `import_sessions` IPC command to seed fixtures
2. Point to a dedicated test data directory via config
3. Snapshot a known-good index.db for tests

**Revision**: Phase 1 now includes a fixture strategy step.

#### 🟡 Dynamic Port Selection (not hardcoded 9222)
**All three**: Port 9222 conflicts with Chrome DevTools, VS Code, other WebView2
apps. The plan should auto-select an available port.

**Revision**: Launch script will scan ports 9222-9232 and pass the chosen port to
both the app and the Playwright connection helper. Include `--remote-debugging-address=127.0.0.1`
to prevent external binding.

#### 🟡 Readiness Signal — "App Loaded" vs "Window Exists"
**All three**: Need a deterministic signal that the app is fully loaded and indexed,
not just that a window appeared.

**Revision**: The connection helper will poll for the Vue app mount (`#root` present)
AND check that the session store has loaded (via `page.evaluate`). Add a
`window.__TRACEPILOT_READY__` flag that `main.ts` sets after initial data load.

#### 🟡 Use `playwright-core` not `playwright`
**Opus**: Full Playwright installs ~400MB of browsers. Since we're connecting to an
existing WebView2 via CDP, we only need `playwright-core` (the client library, no
browser download).

**Revision**: Use `playwright-core` as the dependency.

#### 🟡 Scope `data-testid` to Minimum Viable Set
**All three**: Don't blanket-add testids to every component. Scope to the flows
the skill actually drives.

**Revision**: Phase 1 scopes testids to: session cards, session detail tab bar,
search input, nav sidebar links, and key action buttons. ~20-30 attributes, not
hundreds.

#### 🟡 Cleanup/Teardown Protocol
**All three**: What happens when a skill crashes mid-run? Stale processes, bound
ports.

**Revision**: Launch script records PID. Connection helper checks for stale
processes. Skills instruct agent to clean up on failure.

### 14.2 Divergent Opinions — Skill Architecture

The three reviewers disagreed on skill count:

| Reviewer | Recommendation | Rationale |
|----------|---------------|-----------|
| **Opus 4.6** | **2 skills, redraw boundary** | Split by "live app" vs "offline analysis" — not by interaction vs diagnostics |
| **GPT 5.4** | **1 skill first** | Diagnostics always requires interaction; start monolithic, split when reuse patterns emerge |
| **Codex 5.3** | **3 skills** | Lifecycle, scenarios, diagnostics — keeps diagnostics independent |

**Resolution: Start with ONE skill, plan to split later.**

GPT 5.4's pragmatic argument is strongest: diagnostics collection *requires*
interaction (you can't profile session detail load without navigating there). Splitting
prematurely creates duplication or fragile cross-skill dependencies. One skill with
well-structured sections is cleaner for now.

When real usage patterns emerge, Opus's boundary (live-app vs offline-analysis) is the
right split point — not the original interaction-vs-diagnostics boundary.

**Revised skill architecture:**
- **Phase 2**: One skill: `tracepilot-app-automation`
  - Section 1: Launch & connect
  - Section 2: Navigate & interact
  - Section 3: Collect telemetry (live)
  - Section 4: Analyze & report
- **Future**: Split into `tracepilot-app-automation` (live) + `tracepilot-perf-analysis`
  (offline) when we have enough offline-only analysis to justify it.

### 14.3 Additional Concerns Raised

#### Dev Mode vs Built Binary (Opus)
The plan conflates `tauri dev` (Vite HMR + dev server) with built binaries. These
behave differently: dev mode connects to localhost:1420, built binary serves from
disk. HMR can break CDP connections mid-test.

**Revision**: Skills target `tauri dev` initially (simpler, agent is already in dev
context). Document that `--no-watch` or `pnpm tauri build` should be used for stable
test runs. Add this as a troubleshooting note in the skill.

#### CI Runs on Linux; E2E Needs Windows (Opus)
Current CI uses `ubuntu-latest` and skips the desktop crate. E2E tests need a Windows
runner with WebView2.

**Revision**: Phase 4 explicitly notes this requires a `windows-latest` GitHub runner
and is a non-trivial CI design project. Not blocking for skill creation.

#### Rust `std::env::set_var` Soundness (Opus)
Since Rust 1.83+, `set_var` is unsafe in multi-threaded contexts. Must be called
before any thread spawning.

**Revision**: Option B notes this constraint. Option A (shell env var) remains the
primary recommendation.

#### Single Orchestrator vs Six Scripts (Opus)
Six scripts in `scripts/e2e/` is a maintenance surface.

**Revision**: Consolidate to three scripts:
1. `scripts/e2e/launch.ps1` — Launch app with CDP + port discovery + PID tracking
2. `scripts/e2e/connect.mjs` — Playwright connection helper (reusable module)
3. `scripts/e2e/smoke-test.mjs` — Basic E2E smoke that also collects telemetry

### 14.4 Revised Implementation Roadmap

Based on reviewer feedback, the phases are reordered:

#### Phase 1: Harness Foundation
1. CDP launch script with dynamic port, localhost binding, PID tracking
2. Install `playwright-core` as dev dependency
3. Connection helper with readiness polling
4. Verify connectivity + screenshot (already proven in PoC)
5. Test fixture strategy (seeded session data directory)
6. Cleanup/teardown protocol

#### Phase 2: Skill + Telemetry (interleaved, not sequential)
7. Add `window.__TRACEPILOT_READY__` flag to `main.ts`
8. Expose `__TRACEPILOT_IPC_PERF__` on window
9. Add minimum viable `data-testid` attributes (~20-30)
10. Create `.github/skills/tracepilot-app-automation/SKILL.md`
11. Create smoke test script

#### Phase 3: Hardening
12. CSP verification against built binary
13. Release-build CDP guardrail
14. Document dev-mode vs built-binary differences

#### Phase 4: CI Integration (Future, non-trivial)
15. Windows runner E2E job design
16. Automated performance regression detection
17. Evaluate splitting into two skills based on usage patterns

### 14.5 Summary Verdict from Reviewers

All three reviewers agreed the plan is **directionally correct and well-researched**.
The CDP approach is validated and the existing instrumentation is genuine leverage.
The critical gaps were around **reliability engineering** (determinism, cleanup, port
management) and **security hardening** (CSP, localhost binding, release guardrails) —
treating this as a proper test harness project rather than just "add Playwright."

---

## 15. Route Map (for agent navigation)

| Route | Page | Key elements |
|-------|------|-------------|
| `/#/` | Session List | Session cards, filters, sort, search bar |
| `/#/session/:id` | Session Detail | Tab navigation (7 tabs) |
| `/#/session/:id/overview` | Overview | Stat cards, metadata, plan, checkpoints |
| `/#/session/:id/conversation` | Conversation | Turn-by-turn chat, tool calls, subagents |
| `/#/session/:id/events` | Events | Raw event log, type filters, pagination |
| `/#/session/:id/todos` | Todos | Task list, dependency graph |
| `/#/session/:id/metrics` | Metrics | Token breakdown, cost estimates |
| `/#/session/:id/token-flow` | Token Flow | Model distribution, cost comparison |
| `/#/session/:id/timeline` | Timeline | Agent tree, swimlanes, waterfall |
| `/#/search` | Deep Search | FTS search, facets, grouped results |
| `/#/analytics` | Analytics | Usage charts, trends, model distribution |
| `/#/health` | Health | Session health scoring |
| `/#/tools` | Tool Analysis | Invocation frequency, success rates |
| `/#/code` | Code Impact | File changes, churn visualization |
| `/#/models` | Model Comparison | Cross-model analytics |
| `/#/compare` | Session Compare | Side-by-side session comparison |
| `/#/replay/:id?` | Session Replay | Animated session playback |
| `/#/export` | Export/Import | Session archive management |
| `/#/settings` | Settings | App configuration |
| `/#/orchestration` | Orchestration Home | Dashboard |
| `/#/orchestration/worktrees` | Worktrees | Git worktree management |
| `/#/orchestration/launcher` | Launcher | Session launch, templates |
| `/#/orchestration/config` | Config Injector | Copilot config management |
