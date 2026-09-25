# Developer commands and script index

Run commands from the repository root. The root `package.json` and `justfile`
are the supported entry points for common work; scripts below cover narrower
manual tasks and CI contracts. `pnpm start` runs `pnpm install` before launching
Tauri. Direct script invocations generally expect dependencies to be present.

## Common commands

| Purpose | Command | Platform and status | Prerequisites / effects |
| --- | --- | --- | --- |
| Install workspace dependencies | `pnpm install` or `just install` | All; manual | Node 22, pnpm 10; changes local dependency installation. |
| Launch the real desktop app | `pnpm app:start` | Windows; manual diagnostic | Rust, Tauri/WebView2, pnpm dependencies; starts owned processes and uses the configured session/index data unless an isolated data root is supplied. See [automation](../docs/app-automation.md). |
| Launch frontend mock UI | `pnpm app:ui` | Windows launcher; manual diagnostic | Starts Vite with mock IPC; cannot verify native behavior. |
| Stop or inspect owned app process | `pnpm app:stop`, `pnpm app:status` | Windows; manual | Uses the automation launcher's recorded process identity. |
| Run workspace checks | `just ci`, `just check-docs`, `pnpm typecheck`, `pnpm test` | All; manual/CI | `just ci` mirrors local gates; see [testing](../docs/testing.md) for hosted differences. |
| Run native integration | `pnpm test:e2e` locally; `pnpm test:e2e -Install` in CI | Windows; manual and installer CI | Builds and tests against synthetic isolated data; `-Install` also exercises the installer. See [E2E README](../tests/e2e/README.md). |

`just --list` shows the maintained recipes. It wraps existing pnpm, cargo, and
Node commands; it is not a second implementation of those tasks.

## Repository policy checks

| Entry point | Purpose | Status / effects |
| --- | --- | --- |
| `node scripts/check-doc-links.mjs` | Check relative Markdown file targets across repository docs; accepts explicit paths for staged checks. | Local `just check-docs` and lefthook; CI policy. Read-only. It does not validate anchors or paths written only in code spans. |
| `node scripts/check-adr.mjs` | Check ADR headings, dates, status, and index membership. | Local `just check-docs` and lefthook; CI policy. Read-only. |
| `node scripts/check-workflow-actions.mjs` | Check pinned action SHAs and comments. | CI policy; `--verify-remote` uses GitHub API in CI. Read-only without that flag. |
| `node scripts/check-file-sizes.mjs` | Enforce source line budgets. | CI and lefthook. Read-only. |
| `node scripts/check-catalog-drift.mjs` | Check pnpm catalogue references. | `just ci`; read-only. |
| `node scripts/check-csp.mjs` | Guard Tauri CSP. | `just ci` and lefthook; read-only. |
| `node scripts/check-public-api.mjs` | Compare orchestrator exports with its checked-in API baseline. | `just ci` and lefthook; read-only unless explicitly passed `--update`. |
| `node scripts/check-no-hex-colors.mjs`, `check-no-emoji-in-templates.mjs`, `check-no-backdrop-filter.mjs`, `check-z-index-tokens.mjs` | Guard desktop design tokens and component rules. | Lefthook and package scripts; read-only. Each supports `--staged`. |
| `node scripts/check-spacing-grid.mjs` | Report off-grid spacing. | Advisory pre-push check; exits successfully while issues are reported. |
| `node scripts/check-commit-msg.mjs <message-file>` | Validate Conventional Commit subject. | Lefthook `commit-msg`; read-only. |

## Manual build and analysis helpers

| Entry point | Purpose | Platform / prerequisites / effects |
| --- | --- | --- |
| `pwsh -File scripts/dev.ps1` | Print a quick command menu. | PowerShell; read-only. |
| `pwsh -File scripts/build.ps1` | Run `cargo build --workspace` and `pnpm -r build`. | PowerShell; writes build outputs. It is not a release installer command. |
| `pwsh -File scripts/clean.ps1` | Remove selected build caches or outputs. | PowerShell; destructive to generated files. Review `-Frontend`, `-Full`, and `-Deep` before use. |
| `pwsh -File scripts/bump-version.ps1 -Version X.Y.Z` | Synchronise workspace versions and lockfiles. | PowerShell; requires pnpm and cargo-edit; modifies manifests and lockfiles. See [release guidance](../docs/versioning-updates-release-strategy.md). |
| `pwsh -File scripts/bench.ps1` | Run Criterion benchmarks, optionally saving/comparing a baseline. | PowerShell, Rust; writes `target/criterion/`. Use synthetic fixtures. |
| `just bench-flamegraph <bench>` or `pwsh -File scripts/bench-flamegraph.ps1 <bench>` | Profile a selected benchmark. | Opt-in profiler (`cargo flamegraph` and platform support); writes profiling output. |
| `pwsh -File scripts/pgo-build.ps1` or `bash scripts/pgo-build.sh` | Profile-guided Rust build. | PowerShell/POSIX; Rust LLVM tools; runs benchmarks and writes profiles/build outputs. |
| `python scripts/validate-session-versions.py --session-dir <isolated-dir>` | Heuristic report of event fields/anomalies in session JSONL by Copilot version. | Manual; defaults to the user's live Copilot session directory when `--session-dir` is omitted. It is distinct from `pnpm cli versions ...` schema analysis, and does not enforce a fixture support manifest. |

## Grouped tooling and tests

| Group | Role / invocation | Effects and output |
| --- | --- | --- |
| `scripts/automation/` | Native lifecycle and readiness behind `pnpm app:*`; `pnpm test:automation` runs isolated contract tests. | Launch state and owned processes; see [automation guide](../docs/app-automation.md). |
| `scripts/e2e/` | `test.ps1` is the native integration entry point; `launch.ps1`/`stop.ps1` are compatibility wrappers; `connect.mjs`, smoke/perf diagnostics, README capture, and fixture helpers are internal or opt-in. | Diagnostics/screenshots under ignored `scripts/e2e/screenshots/`; README capture deliberately updates selected `docs/images/`. See [testing guide](../docs/testing.md). |
| `scripts/visual/` | Synthetic frontend capture, report, policy tests, and trusted publisher. Run focused tests with `node --test scripts/visual/*.test.mjs` and `python scripts/visual/extract_test.py`. | Own npm lockfile/dependencies via `npm ci --prefix scripts/visual --ignore-scripts`; local captures under `.tracepilot/visual/`. Publishing is a CI workflow action, not a local diagnostic. See [visual regression](../docs/visual-regression.md). |
| `scripts/perf/` | Performance/bundle probes and comparison contracts. Focused tests: `node --test scripts/perf/*.test.mjs`. | Some probes launch a native app or read selected data and write ignored `.tracepilot/perf/`; review the particular command first. See [performance playbook](../docs/performance-playbook.md). |
| `scripts/ci/` | Imported PR reference/comment helpers for visual and bundle workflows, with `*.test.mjs` contract tests. | `node --test scripts/ci/*.test.mjs` is read-only; workflow callers may post comments. |

The tests and imported helpers in these groups are not standalone user commands.
Keep externally documented wrapper paths and the visual publisher's isolated
dependency/trust boundary when changing this directory.
