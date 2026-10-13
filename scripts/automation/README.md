# App automation scripts

The native lifecycle behind `pnpm app:start`, `app:ui`, `app:stop` and
`app:status`. See the [automation guide](../../docs/app-automation.md) and the
[testing guide](../../docs/testing.md).

- `app.ps1` — launcher for desktop and UI-only instances, named isolated instances and fixtures. Writes launch state under ignored `.tracepilot/automation/` or `.tracepilot/instances/<name>/` and starts owned processes.
- `ready.mjs` — readiness probe that confirms the attached webview is the exact instance that was launched.
- `registry.ps1` — machine-wide instance and port registry in `%LOCALAPPDATA%`, dot-sourced by `app.ps1`.
- `test-process.mjs` — bounded subprocess runner and failure snapshots for the contract tests.

Tests: `pnpm test:automation` runs the `*.test.mjs` contracts sequentially, with
synthetic diagnostics under ignored `.tracepilot/automation-test-results/`.
