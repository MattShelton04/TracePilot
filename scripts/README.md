# Developer commands and script index

Run commands from the repository root. The root `package.json` and `justfile`
are the supported entry points for common work; scripts below cover narrower
manual tasks and CI contracts. `pnpm start` runs `pnpm install` before launching
Tauri. Direct script invocations generally expect dependencies to be present.

## Common commands

| Purpose | Command | Platform and status | Prerequisites / effects |
| --- | --- | --- | --- |
| Install workspace dependencies | `pnpm install` or `just install` | All; manual | Node 22, pnpm 10; changes local dependency installation. |
| Install repository Git hooks | `pnpm hooks:install` | All; explicit opt-in | Uses the pinned local Lefthook. Dependency installation does not install or replace Git hooks. |
| Develop the landing page | `pnpm site:dev` | All; manual | Generates showcase/release data and starts Vite on port 5180. See [landing-page guide](../docs/landing-page.md). |
| Build the landing page | `pnpm site:build` | All; local/CI | Generates data and writes `site/dist/`; fetches release information at build time. |
| Check the landing page | `pnpm site:check` | All; local/CI | Requires a built site and Playwright Chromium; runs all viewport/interaction/CSP and size checks, saving ignored `site/.check/` screenshots. Add `--viewport 1440x960` (repeatable) for focused checks; CI shards the five modes against one shared build. |
| Launch the real desktop app | `pnpm app:start` | Windows; manual diagnostic | Rust, Tauri/WebView2, pnpm dependencies; starts owned processes and uses the configured session/index data unless an isolated data root is supplied. See [automation](../docs/app-automation.md). |
| Launch frontend mock UI | `pnpm app:ui` | Windows launcher; manual diagnostic | Starts Vite with mock IPC; cannot verify native behavior. |
| Stop or inspect owned app process | `pnpm app:stop`, `pnpm app:status` | Windows; manual | Uses the automation launcher's recorded process identity. |
| Run parallel or isolated app instances | `pnpm app:start -Instance <name> [-Fixtures [-FirstRun]]`, `pnpm app:status -All`, `pnpm app:stop -Instance <name>` | Windows; manual diagnostic | Named instances keep state, data and Playwright session under `.tracepilot/instances/<name>/`; ports come from a machine-wide registry in `%LOCALAPPDATA%`. See [parallel instances](../docs/app-automation.md#parallel-instances). |
| Run workspace checks | `just ci`, `just check-docs`, `pnpm typecheck`, `pnpm test` | All; manual/CI | `just ci` mirrors local gates; see [testing](../docs/testing.md) for hosted differences. |
| Run native integration | `pnpm test:e2e` locally; `pnpm test:e2e -Install` in CI | Windows; manual and installer CI | Builds and tests against synthetic isolated data; `-Install` also exercises the installer. See [E2E README](../tests/e2e/README.md). |
| Refresh Copilot pricing | `pnpm pricing:fetch`, `pnpm pricing:update`, `pnpm pricing:update --write` | All; manual | Fetch resolves/pins the latest source SHA and UTC date automatically (`--revision`/`--date` remain replay overrides); update previews changes, `--write` updates runtime prices/shared defaults. See the [pricing update workflow](../docs/pricing-model.md#reproducible-update-workflow). |
| Validate Copilot pricing | `pnpm pricing:check`, `pnpm test:pricing` | All; local/CI, offline | Verifies frozen sources, deterministic updates, history and shared defaults; no network or writes. |
| Check live Copilot pricing | `pnpm pricing:freshness [--report <path>]` | All; manual/advisory PR workflow | Compares current GitHub pricing with the saved source. No price changes; optional JSON report. CI posts/updates one comment when outdated, never blocks merging, and distinguishes verification failures. See [CI behavior](../docs/pricing-model.md#ci-consistency-and-live-freshness-checks). |

`just --list` shows the maintained recipes. It wraps existing pnpm, cargo, and
Node commands; it is not a second implementation of those tasks.

## Repository policy checks

| Entry point | Purpose | Status / effects |
| --- | --- | --- |
| `node scripts/check-doc-links.mjs` | Check relative Markdown file targets across repository docs; accepts explicit paths for staged checks. Contracts: `node --test scripts/check-doc-links.test.mjs`. | Local `just check-docs` and lefthook; CI policy. Read-only. It does not validate anchors or paths written only in code spans. |
| `node scripts/check-adr.mjs` | Check ADR headings, dates, status, and index membership. | Local `just check-docs` and lefthook; CI policy. Read-only. |
| `node scripts/check-workflow-actions.mjs` | Check pinned action SHAs and comments. | CI policy; `--verify-remote` uses GitHub API in CI. Read-only without that flag. |
| `node scripts/ci/classify-changes.mjs`, `node scripts/ci/classify-changes.mjs --verify-required` | Select application checks from the complete PR merge diff and strictly verify the required job results. | CI only; consumes GitHub event/output or `CI_NEEDS` environment data. Contracts: `node --test scripts/ci/classify-changes.test.mjs`. |
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
| `pwsh -File scripts/build.ps1` | Run `cargo build --workspace` and `pnpm -r build`. | PowerShell; writes build outputs. It is not a release installer command. |
| `pwsh -File scripts/clean.ps1` | Remove selected build caches or outputs. | PowerShell; destructive to generated files. Review `-Frontend`, `-Full`, and `-Deep` before use. |
| `pwsh -File scripts/bump-version.ps1 -Version X.Y.Z` | Synchronise workspace versions and lockfiles. | PowerShell; requires pnpm and cargo-edit; modifies manifests and lockfiles. See the [release guide](../docs/releasing.md). |
| `pwsh -File scripts/bench.ps1` | Run Criterion benchmarks, optionally saving/comparing a baseline. | PowerShell, Rust; writes `target/criterion/`. Use synthetic fixtures. |
| `just bench-flamegraph <bench>` or `pwsh -File scripts/bench-flamegraph.ps1 <bench>` | Profile a selected benchmark. | Opt-in profiler (`cargo flamegraph` and platform support); writes profiling output. |
| `pwsh -File scripts/pgo-build.ps1` or `bash scripts/pgo-build.sh` | Profile-guided Rust build. | PowerShell/POSIX; Rust LLVM tools; runs benchmarks and writes profiles/build outputs. |
| `python scripts/validate-session-versions.py --session-dir <isolated-dir>` | Heuristic report of event fields/anomalies in session JSONL by Copilot version. | Manual; defaults to the user's live Copilot session directory when `--session-dir` is omitted. It is distinct from `pnpm cli versions ...` schema analysis, and does not enforce a fixture support manifest. |

## Grouped tooling and tests

| Group | Role / invocation | Effects and output |
| --- | --- | --- |
| `scripts/automation/` | Native lifecycle, machine-wide instance registry and readiness behind `pnpm app:*`; `pnpm test:automation` runs isolated contract tests. | Launch state and owned processes; see [automation guide](../docs/app-automation.md). |
| `scripts/dependencies/` | Capture locked resolver inputs, generate complete dependency graphs, and test graph invariants. | Read-only package-manager queries; writes ignored inputs and generated graphs under `.agent/dependency-audit/`. See [rerun commands](dependencies/README.md) and [dependency reference](../docs/dependencies/README.md). |
| `scripts/pricing/` | Source parser, importer, live freshness comparator and CLI behind `pnpm pricing:*`; `pnpm test:pricing` runs update/freshness/reporting contracts. `publish.mjs` is the trusted CI comment entry point. | Versioned evidence under `packages/types/data/copilot-pricing/`; runtime JSON changes only with `--write`. Freshness writes only its optional report/CI summary; the report workflow maintains one advisory comment. |
| `scripts/macos/` | `bash scripts/macos/bundle-smoke.sh [bundle-dir]` verifies a built app and disk image, installs from the image and launches it. Run by the CI macOS job and the release workflow. | macOS only; needs a prior `pnpm tauri build --bundles app,dmg`. Writes ignored `.tracepilot/macos-smoke/`. See [testing guide](../docs/testing.md). |
| `scripts/e2e/` | `test.ps1` is the native integration entry point; `launch.ps1`/`stop.ps1` are compatibility wrappers; `connect.mjs`, smoke/perf diagnostics, README capture, and fixture helpers are internal or opt-in. | Diagnostics/screenshots under ignored `scripts/e2e/screenshots/`; README capture deliberately updates selected `docs/images/`. See [testing guide](../docs/testing.md). |
| `node scripts/fixtures/session-fixtures.mjs [--root=PATH]` | Generate a 63-case rich-tool gallery and a separate `report_intent` session for native inspection. Tests: `node --test scripts/fixtures/*.test.mjs`. | Defaults to ignored `.tracepilot/rich-tool-fixtures`; preserves app config/index and refuses modified/unowned sessions. See [testing](../docs/testing.md#rich-tool-fixtures). |
| `node scripts/fixtures/copilot-schema-fixture.mjs <version> <output.jsonl> [timestamp]` | Generate a synthetic parser contract with every persistable event of an installed Copilot CLI schema, optional fields populated. | Reads `~/.copilot/pkg/<platform>/<version>/schemas` (or `TRACEPILOT_COPILOT_PKG_DIR`); writes only the named file. See [version reports](../docs/reports/versions/README.md). |
| `pnpm build:cli` then `node --test scripts/cli/cli-smoke.test.mjs` | Build the standalone CLI and exercise help, list, show, search and unsupported index behavior against the shared Rust/TypeScript turn fixture. | Required frontend build job; creates and removes an isolated temporary session directory. |
| `scripts/visual/` | Synthetic frontend capture, report, policy tests, and trusted publisher. CI: 37 App views + 64 Rich tools, including explicit preview/full and local expansion/page interactions. README screenshots: `node scripts/visual/capture.mjs --suite=readme --docs` (synthetic `showcase/` workspace, not run in CI). Tests: `node --test scripts/visual/*.test.mjs` and `python scripts/visual/extract_test.py`. | Own npm lockfile/dependencies via `npm ci --prefix scripts/visual --ignore-scripts`; generated captures stay under ignored `.tracepilot/visual/`. Publishing is a CI workflow action, not a local diagnostic. See [visual regression](../docs/visual-regression.md). |
| `site/scripts/` | Data export/validation, release/HTML facts, browser checks and shared preview lifecycle. Tests: `pnpm --filter @tracepilot/site test`; social image: `pnpm --filter @tracepilot/site og` after a build. | Generated data and screenshots are ignored; OG generation updates committed `site/public/og.png`. See [landing-page guide](../docs/landing-page.md). |
| `node scripts/site/publish.mjs --dist site/dist` | Trusted Site workflow publisher; CI only. Tests: `node --test scripts/site/*.test.mjs` use a scratch Git remote. | Writes only manifest-owned paths in the shared gh-pages root, preserving visual history and benchmarks. `--no-api` is for scratch-remote testing. |
| `scripts/perf/` | Performance/bundle probes and comparison contracts. Focused tests: `node --test scripts/perf/*.test.mjs`. | Some probes launch a native app or read selected data and write ignored `.tracepilot/perf/`; review the particular command first. See [performance playbook](../docs/performance-playbook.md). |
| `node scripts/perf/summarize-benchmarks.mjs --criterion=target/criterion --budget=perf-budget.json` | Nightly CI aggregation: requires `BENCHMARK_SUITES` (JSON from Cargo targets), `BENCHMARK_RESULT`, `BENCHMARK_DOWNLOAD_RESULT` and `BENCHMARK_CONTRACT_RESULT`. | Preserves strict budget validation; verifies every suite outcome/compiler and writes `benchmark-output.json`, `benchmark-summary.md` and `benchmark-contract.log` even for incomplete runs, which exit nonzero. |
| `scripts/ci/` | CI job selection/required-gate verification and imported PR reference/comment helpers, with `*.test.mjs` contracts. | `node --test scripts/ci/*.test.mjs` uses isolated scratch repositories; workflow publishers may post comments. The CI policy job also runs checksum-pinned actionlint with the runner's ShellCheck to validate workflows, expressions, action inputs and embedded Bash. |

The tests and imported helpers in these groups are not standalone user commands.
Keep externally documented wrapper paths and the visual publisher's isolated
dependency/trust boundary when changing this directory.

## Audit-only helpers

These have recorded one-off use, but no current package, Just, or CI command
invokes them automatically:

| Helper | Evidence and current status |
| --- | --- |
| `scripts/e2e/native-dialog-gateway.mjs` | Used for picker-result substitution in the dated [usability audit](../docs/reports/usability-audit-2026-09-12/validation.md); it does not exercise the OS dialog. Its focused contract suite is `node --test scripts/e2e/native-dialog-gateway.test.mjs`. |
| `scripts/e2e/copilot-compat.mjs` and `usability-fixtures.mjs` | The former is cited as an isolated-session example; the latter generated the dated usability audit's synthetic corpus. Neither is a routine CI gate. The fixture generator has imported helpers and tests. |
| `scripts/perf/private-snapshot.mjs` | Used to select the private corpus described in the [performance mission](../docs/reports/performance-mission.md). It has no current workflow caller, writes ignored private copies, and does not itself create the fixture manifest required by `scripts/perf/indexing.mjs`. |
