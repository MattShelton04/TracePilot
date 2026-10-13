# Native integration and diagnostics

`test.ps1` is the native integration entry point (`pnpm test:e2e`); the rest
are compatibility wrappers, opt-in diagnostics and fixture helpers. See the
[testing guide](../../docs/testing.md) and the [E2E README](../../tests/e2e/README.md).
Diagnostics write screenshots under ignored `scripts/e2e/screenshots/`.

- `capture-readme-media.mjs` — captures README-style media from a running app for native review; it deliberately updates selected `docs/images/`. Helpers live in `readme-media/`.
- `connect.mjs` — optional repeatable diagnostics against a running app; `--instance <name>` selects a named instance. Interactive work uses playwright-cli.
- `launch.ps1`, `stop.ps1` — compatibility wrappers; use `pnpm app:start` and `pnpm app:stop`.
- `perf-profile.mjs` — hot-path profiler collecting IPC timings, mount times, heap and long tasks.
- `smoke-test.mjs` — smoke test of key user flows over CDP, with a diagnostic report.
- `test.ps1` — repeatable native integration suite against synthetic isolated data; `-Install` also exercises the installer.

Audit-only helpers are listed in the [script index](../README.md#audit-only-helpers).
