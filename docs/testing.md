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

## 3. Desktop end-to-end (Tauri app over CDP)

The canonical E2E layer for TracePilot is **not** a `playwright.config.ts`
with `*.spec.ts` files. Instead, it is driven by the
`tracepilot-app-automation` skill, which launches the real Tauri 2 + WebView2
app with Chrome DevTools Protocol enabled and connects `playwright-core` to
the running webview.

This gives tests access to the real Rust backend, real IPC, real SQLite
index, and real session data — which is what we actually want to regress
against for flow-level coverage.

### Layout

```
scripts/e2e/
├── launch.ps1          # Start TracePilot with CDP on an auto-selected port
├── stop.ps1            # Stop a tracked instance (or all of them)
├── connect.mjs         # Shared helpers: connect, navigateTo, collectTelemetry, ipc, shutdown
├── smoke-test.mjs      # Canonical flow: session list → detail → search → analytics → settings
├── perf-profile.mjs    # Optional performance diagnostic: hot paths, IPC, heap, mounts
├── capture-readme-media.mjs # README screenshot/storyboard capture utility
└── readme-media/       # Helper modules for README media capture
```

`.github/skills/tracepilot-app-automation/SKILL.md` is the authoritative
API reference: route map, `data-testid` catalogue, telemetry recipes, IPC
command surface, and Windows-specific gotchas.

### Running the canonical smoke flow

```powershell
# Terminal 1 — launch the app with CDP enabled
.\scripts\e2e\launch.ps1

# Terminal 2 — run the smoke test once "TracePilot CDP Ready" is printed
node scripts/e2e/smoke-test.mjs

# When finished
.\scripts\e2e\stop.ps1
```

The smoke test exits non-zero on any failed assertion or budget violation.
It writes a JSON report plus screenshots under `scripts/e2e/screenshots/`,
which is generated output and remains git-ignored.

For performance-focused local diagnostics, launch the app the same way and run:

```powershell
node scripts/e2e/perf-profile.mjs
```

For README/product screenshots, launch with CDP and run:

```powershell
node scripts/e2e/capture-readme-media.mjs
```

This writes candidate screenshots and review assets under
`scripts/e2e/screenshots/readme-candidates/` and copies the final selected
viewport to `docs/images/readme-*.png`.

### Extending E2E coverage

Do not add one-off `test-*.mjs` scripts for individual fixes. Prefer extending
`smoke-test.mjs` when a flow should become part of the reusable local gate, or
`perf-profile.mjs` when the scenario is specifically a performance diagnostic.
`capture-readme-media.mjs` is intentionally documentation/media automation, not
a regression gate.

If a short-lived investigation needs custom automation, keep it out of the
repository or delete it after the investigation. Reusable additions should:

1. Import helpers from `./connect.mjs` (`connect`, `navigateTo`,
   `collectTelemetry`, `startConsoleCapture`, `validateBudgets`, `ipc`,
   `shutdown`).
2. Prefer `[data-testid="…"]` selectors over CSS classes — the catalogue
   lives in the skill doc.
3. Always clear the IPC perf log before measuring
   (`window.__TRACEPILOT_IPC_PERF__?.clearIpcPerfLog()`).
4. Call `shutdown(browser, port)` (or `stop.ps1`) in a `finally` block so a
   failed run does not leave an orphaned WebView2 process.

### CI

E2E is **not** wired into CI in this repository. Running these scripts
requires a desktop WebView2 runtime, a Tauri build, and is single-instance
per host (WebView2 locks the user-data directory). Treat them as a local
pre-release gate and for reproducing flow-level bugs reported against the
built app.

## Cross-references

- `packages/ui/src/__vrt__/README.md` — VRT contract + baseline workflow
- `.github/skills/tracepilot-app-automation/SKILL.md` — E2E skill API
- `docs/performance-playbook.md` — Criterion, flamegraphs, trace analysis
- `perf-budget.json` — IPC timing budgets consumed by `validateBudgets()`
- `scripts/README.md` — index of all helper scripts (including `e2e/`)
