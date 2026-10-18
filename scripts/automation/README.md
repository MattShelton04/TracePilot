# App automation scripts

The native lifecycle behind `pnpm app:start`, `app:ui`, `app:stop`,
`app:status` and `app:wait`. See the [automation guide](../../docs/app-automation.md) and the
[testing guide](../../docs/testing.md).

- `app.ps1` — launcher for desktop and UI-only instances, named isolated instances and fixtures. Writes launch state under ignored `.tracepilot/automation/` or `.tracepilot/instances/<name>/` and starts owned processes. `wait` is read-only: it blocks on a start running elsewhere without taking the lifecycle lock (exit 0 ready, 1 failed or not started, 2 still starting at `-TimeoutSeconds`, default 540).
- `pw.mjs` — `pnpm pw <instance>[:ui] <cmd…>`: quoting-safe Playwright CLI wrapper that reads the instance's state, attaches automatically and adds `eval-file`, `run-file` and `WxH` resize.
- `ready.mjs` — readiness probe that confirms the attached webview is the exact instance that was launched.
- `real-data.mjs` — used by `app:start -Instance <slug> -RealData`: hard-link mirror of the real Copilot and Claude Code session folders into the instance's data root.
- `registry.ps1` — machine-wide instance and port registry in `%LOCALAPPDATA%`, dot-sourced by `app.ps1`.
- `test-process.mjs` — bounded subprocess runner and failure snapshots for the contract tests.

Tests: `pnpm test:automation` runs the `*.test.mjs` contracts sequentially, with
synthetic diagnostics under ignored `.tracepilot/automation-test-results/`.
