# TracePilot Testing Guide

This document is the canonical reference for how TracePilot is tested. It
covers the three distinct layers in the test pyramid and points at the
tooling, scripts, and CI status for each.

## TL;DR

| Layer | Tool | Location | Runs by default? |
| --- | --- | --- | --- |
| Unit / integration (JS/TS) | Vitest | `apps/**`, `packages/**` (`*.spec.ts`, `*.test.ts`) | ✅ `pnpm test` |
| Unit / integration (Rust) | `cargo test` | `crates/**` | ✅ `cargo test` |
| Component visual regression | Playwright CT | `packages/ui/src/__vrt__/*.vrt.spec.ts` | ❌ on-demand only |
| Desktop end-to-end (real Tauri app) | Playwright-over-CDP + canonical `scripts/e2e` harness | `scripts/e2e/` | ❌ on-demand only |

The JS/TS and Rust unit suites are the primary regression gate. VRT and E2E
are opt-in — they require extra tooling (Chromium download, a live Tauri
build, a WebView2 runtime) and are not wired into CI today.

## 1. Unit & integration (Vitest)

- **Run all:** `pnpm test` (≈1662 test cases at the time of writing).
- **Run one package:** `pnpm --filter @tracepilot/desktop test`.
- **Watch mode:** `pnpm --filter @tracepilot/desktop test -- --watch`.
- Tests live next to the code they cover (`*.spec.ts` / `*.test.ts`) or
  under `__tests__/` folders. Fixtures live in
  `packages/test-utils/fixtures/`.

Use this layer for everything that does **not** require a running webview:
pure functions, composables with mocked IPC, Vue components rendered into
jsdom, parsers, state machines, serde round-trips, etc.

## 2. Component visual regression (VRT)

See `packages/ui/src/__vrt__/README.md` for the full contract. Summary:

- **Config:** `packages/ui/playwright-ct.config.ts`
  (`@playwright/experimental-ct-vue`).
- **Run:** `pnpm --filter @tracepilot/ui vrt`.
- **Update baselines:** `pnpm --filter @tracepilot/ui vrt:update`.
- **First-run setup:** `pnpm --filter @tracepilot/ui exec playwright install chromium`.
- **Scope:** a deliberately small package-level baseline for `PageHeader` and
  `SegmentedControl`, where the visual styling lives in `@tracepilot/ui`.

VRT is **not** on default CI because baselines are OS-sensitive (Windows vs
Linux sub-pixel antialiasing). Baselines must be refreshed together on a
single OS.

## 3. Running-app exploration and desktop E2E

For interactive development, use the pinned **Playwright agent CLI** with the
[automation skill](../.github/skills/tracepilot-app-automation/SKILL.md). It drives
the real Tauri webview using snapshots, element references, screenshots, console
logs, and traces. The [automation guide](app-automation.md) explains the choice,
lifecycle, frontend-only mode, optional MCP connection, and platform limits.

```powershell
pnpm app:start
# Use the endpoint printed by startup:
pnpm exec playwright-cli -s=tracepilot-desktop attach --cdp=http://127.0.0.1:9222
pnpm exec playwright-cli -s=tracepilot-desktop snapshot
# Finish:
pnpm exec playwright-cli -s=tracepilot-desktop detach
pnpm app:stop
```

The launcher verifies real Rust IPC and uses the configured sessions and SQLite
index. A separate WebView profile avoids normal-profile locking; application data
is shared. Inspect settings and session content within the task's scope.
`pnpm app:ui` starts a separate Vite server with the existing client mocks for
frontend exploration. It cannot validate Rust behavior.

### Repeatable smoke, performance, and media flows

The existing `scripts/e2e` utilities remain available for repeatable diagnostics:

```powershell
pnpm app:start
node scripts/e2e/smoke-test.mjs
# Optional:
node scripts/e2e/perf-profile.mjs
node scripts/e2e/capture-readme-media.mjs
pnpm app:stop
```

`connect.mjs` discovers only this checkout's recorded desktop endpoint, or uses
an explicit `--port`; it verifies the native target and disconnects on failure.
`launch.ps1` and `stop.ps1` are compatibility shims for the new lifecycle owner.
The smoke flow checks sessions, detail, search, analytics, settings and timing
budgets. It exits non-zero on assertion/budget failures and writes its report
and screenshots under the ignored `scripts/e2e/screenshots/` directory.
README capture writes candidates under `screenshots/readme-candidates/` and
selected product images under `docs/images/`.

Use CLI commands for investigations instead of adding one-off scripts. For
regressions, extend existing component/store tests, `smoke-test.mjs`, or
`perf-profile.mjs` as appropriate. Prefer accessible names and stable test IDs;
wait for visible results or assertions. The older performance flows retain
sampling windows and are diagnostic, not a substitute for user-flow assertions.
Clear IPC timing buffers before measuring. Disconnect Playwright in `finally`
and stop owned processes with `pnpm app:stop` when finished.

Desktop E2E remains opt-in and is not wired into CI. It requires Windows,
WebView2, the Rust toolchain, Node 22, and pnpm 10. Frontend-only exploration is
portable via `pnpm dev` and the CLI. WebView2 CDP does not apply to macOS/Linux.

## Cross-references

- `packages/ui/src/__vrt__/README.md` — VRT contract + baseline workflow
- `.github/skills/tracepilot-app-automation/SKILL.md` — E2E skill API
- `docs/performance-playbook.md` — Criterion, flamegraphs, trace analysis
- `perf-budget.json` — IPC timing budgets consumed by `validateBudgets()`
- `scripts/README.md` — index of all helper scripts (including `e2e/`)
