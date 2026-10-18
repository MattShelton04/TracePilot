# Developer commands and script index

Run commands from the repository root. The root `package.json` and `justfile`
are the supported entry points for common work; scripts below cover narrower
manual tasks and CI contracts. `pnpm start` runs `pnpm install` before launching
Tauri. Direct script invocations generally expect dependencies to be present.

## Common commands

| Purpose | Command | Platform and status | Prerequisites / effects |
| --- | --- | --- | --- |
| Install workspace dependencies | `pnpm install` or `just install` | All; manual | Node 22, pnpm 10; changes local dependency installation. |
| Install repository Git hooks | `pnpm hooks:install` | All; explicit opt-in | Points `core.hooksPath` at the tracked shims in `scripts/git-hooks/`, so every worktree runs Lefthook from its own `node_modules` and prints a SKIPPED warning when it isn't installed. Dependency installation does not install or replace Git hooks. |
| Develop the landing page | `pnpm site:dev` | All; manual | Generates showcase/release data and starts Vite on port 5180. See [landing-page guide](../docs/landing-page.md). |
| Build the landing page | `pnpm site:build` | All; local/CI | Generates data and writes `site/dist/`; fetches release information at build time. |
| Check the landing page | `pnpm site:check` | All; local/CI | Requires a built site and Playwright Chromium; runs all viewport/interaction/CSP and size checks, saving ignored `site/.check/` screenshots. Add `--viewport 1440x960` (repeatable) for focused checks; CI shards the five modes against one shared build. |
| Launch the real desktop app | `pnpm app:start` | Windows; manual diagnostic | Rust, Tauri/WebView2, pnpm dependencies; starts owned processes and uses the configured session/index data unless an isolated data root is supplied. See [automation](../docs/app-automation.md). |
| Drive an app instance with Playwright | `pnpm pw <instance>[:ui] <cmd…>` | Windows; manual | Quoting-safe wrapper around the pinned Playwright CLI that attaches to the named instance automatically. See [scripts/automation](automation/README.md). |
| Launch frontend mock UI | `pnpm app:ui` | Windows launcher; manual diagnostic | Starts Vite with mock IPC; cannot verify native behavior. |
| Stop or inspect owned app process | `pnpm app:stop`, `pnpm app:status` | Windows; manual | Uses the automation launcher's recorded process identity. |
| Run parallel or isolated app instances | `pnpm app:start -Instance <name> [-Fixtures [-FirstRun] \| -RealData]`, `pnpm app:status -All`, `pnpm app:stop -Instance <name>` | Windows; manual diagnostic | Named instances keep state, data and Playwright session under `.tracepilot/instances/<name>/`; ports come from a machine-wide registry in `%LOCALAPPDATA%`. See [parallel instances](../docs/app-automation.md#parallel-instances). |
| Run workspace checks | `just ci`, `just check-docs`, `pnpm typecheck`, `pnpm test` | All; manual/CI | `just ci` mirrors local gates; see [testing](../docs/testing.md) for hosted differences. |
| Run the checks for your change | `pnpm check:changed [--base <ref>] [--dry-run] [--max-workers <n>]` | All; manual | Maps files changed since the merge-base with `origin/main` (plus uncommitted and untracked files) to the [protocol's checks](../docs/agents/protocol.md#verify-proportionately) and prints one PASS/FAIL line per step, with the failing output's tail. Vitest runs with 2 workers by default. Crate and `packages/types` changes also run the `scripts/ci` tests, since the CI change classifier reads them. It then prints non-failing `HINT` lines (also in `--dry-run`): `tests/e2e` specs that reference UI text the diff removes, and `capture.mjs --case=…` commands for the visual cases of changed views or routes. The mapping is `RULES` in `check-changed.mjs`, the hints are in `check-changed-hints.mjs`; tests: `node --test scripts/check-changed.test.mjs scripts/check-changed-hints.test.mjs`. |
| Create an agent worktree | `pnpm worktree:new <slug> [--base origin/main] [--branch <type>/<slug>]` | All; manual | Creates `.agent/worktrees/<slug>` in the main checkout on a new branch (default `agent/<slug>`), runs `pnpm install --frozen-lockfile --prefer-offline` and prints the matching `pnpm app:start -Instance <slug> -Fixtures` command. Refuses an existing folder, saying whether it is a registered worktree to reuse or a leftover to clean. On success the last two lines are `worktree: <path>` and `branch: <branch>` (absent on failure, with a non-zero exit); warns when under 50 GB is free. |
| Clean up agent worktrees | `pnpm worktree:clean [--merged] [--include-recent] [--yes] [--force]` or `pnpm worktree:clean <slug>... [--yes] [--force]` | All; dry run unless `--yes` | Lists leftover folders git no longer tracks under `.agent/worktrees/` and `.claude/worktrees/`, stale registrations and, with `--merged`, merged `.agent/worktrees/*` and `.claude/worktrees/agent-<hex>` (Agent tool) worktrees, with the disk each frees. Merged means HEAD is in `origin/main` or in a merged PR's head (one `gh` call), so workers merged into a squash-merged integration branch count, reported as `merged via PR #N`. `--merged` keeps worktrees another run may still be using: any with a running app instance, or touched in the last 12 hours (`--include-recent` drops only the time check; `--force` overrides neither). Slugs limit it to those `.agent/worktrees/<slug>` folders (an `agent-<hex>` slug with no such folder names `.claude/worktrees/agent-<hex>`, so a lead can remove its own Agent tool workers), merged or not, without those two guards. Other `.claude/worktrees/` (desktop sessions) are only reported. `--yes` stops their recorded app instances and removes them. Never removes uncommitted changes or unpushed commits without `--force`; branches are kept. |
| Collect changelog fragments | `pnpm changelog:collect [--dry-run \| --check]` | All; release prep | Merges [`changelog.d/`](../changelog.d/README.md) fragments into `CHANGELOG.md` `[Unreleased]` and deletes them; `--check` only validates them. See the [release guide](../docs/releasing.md). |
| Run native integration | `pnpm test:e2e` locally; `pnpm test:e2e -Install` in CI | Windows; manual and installer CI | Builds and tests against synthetic isolated data; `-Install` also exercises the installer. See [E2E README](../tests/e2e/README.md). |
| Refresh Copilot pricing | `pnpm pricing:fetch`, `pnpm pricing:update`, `pnpm pricing:update --write` | All; manual | Fetch resolves/pins the latest source SHA and UTC date automatically (`--revision`/`--date` remain replay overrides); update previews changes, `--write` updates runtime prices/shared defaults. See the [pricing update workflow](../docs/pricing-model.md#reproducible-update-workflow). |
| Validate Copilot pricing | `pnpm pricing:check`, `pnpm test:pricing` | All; local/CI, offline | Verifies frozen sources, deterministic updates, history and shared defaults; no network or writes. |
| Check live Copilot pricing | `pnpm pricing:freshness [--report <path>]` | All; manual/advisory PR workflow | Compares current GitHub pricing with the saved source. No price changes; optional JSON report. CI posts/updates one comment when outdated, never blocks merging, and distinguishes verification failures. See [CI behavior](../docs/pricing-model.md#ci-consistency-and-live-freshness-checks). |
| Refresh Claude Code pricing | `pnpm pricing:claude [--report <path>]`, `pnpm pricing:claude --write [--date YYYY-MM-DD]` | All; manual | Parses Anthropic's published model price table. Preview lists added/changed/retained rows and exits 0 current, 1 outdated, 2 could not verify; `--write` updates `claude-code-pricing-data.json`. See [Claude Code API rates](../docs/pricing-model.md#claude-code-api-rates). |

`just --list` shows the maintained recipes. It wraps existing pnpm, cargo, and
Node commands; it is not a second implementation of those tasks.

## Listing a new script

- **In a group folder** (`scripts/<group>/`): add one line to that folder's
  `README.md`, in alphabetical order. If the group has no README yet, add the
  line to its row in [script groups](#script-groups) instead.
- **A new group:** add a row to [script groups](#script-groups); give it a
  `README.md` once it has more than two entry points.
- **At the top level** (`scripts/<name>.*`): add a row to the matching table below.
- **A new `pnpm` command:** also add a row to [common commands](#common-commands).
- Helpers imported or dot-sourced by another script, and tests, need no entry.

`node scripts/check-scripts-index.mjs` fails when a script isn't named in the
README of its folder or of a parent folder; `pnpm check:changed` runs it.

## Repository policy checks

| Entry point | Purpose | Status / effects |
| --- | --- | --- |
| `node scripts/check-doc-links.mjs` | Check relative Markdown file targets across repository docs; accepts explicit paths for staged checks. Contracts: `node --test scripts/check-doc-links.test.mjs`. | Local `just check-docs` and lefthook; CI policy. Read-only. Also checks backticked repository paths in current docs (archive, dated reports and CHANGELOG are skipped); it does not validate anchors. |
| `node scripts/check-adr.mjs` | Check ADR headings, dates, status, and index membership. | Local `just check-docs` and lefthook; CI policy. Read-only. |
| `node scripts/check-workflow-actions.mjs` | Check pinned action SHAs and comments. | CI policy; `--verify-remote` uses GitHub API in CI. Read-only without that flag. |
| `node scripts/ci/classify-changes.mjs`, `node scripts/ci/classify-changes.mjs --verify-required` | Select application checks (`frontend`, `desktop`, `rust`, `dependencies`) from the complete PR merge diff and strictly verify the required job results. | CI only; consumes GitHub event/output or `CI_NEEDS` environment data. Contracts: `node --test scripts/ci/classify-changes.test.mjs`. |
| `node scripts/check-file-sizes.mjs [--staged \| --since <ref> \| <paths...>]` | Enforce source line budgets, on the whole tree or only the given files. | CI and lefthook (`--staged` on commit, `--since` on push). Read-only. |
| `node scripts/check-catalog-drift.mjs` | Check pnpm catalogue references. | `just ci`; read-only. |
| `node scripts/check-csp.mjs` | Guard Tauri CSP. | `just ci` and lefthook; read-only. |
| `node scripts/check-public-api.mjs` | Compare orchestrator exports with its checked-in API baseline. | `just ci` and lefthook; read-only unless explicitly passed `--update`. |
| `node scripts/check-no-hex-colors.mjs`, `check-no-emoji-in-templates.mjs`, `check-no-backdrop-filter.mjs`, `check-z-index-tokens.mjs` | Guard desktop design tokens and component rules (`pnpm check:design-system`). A full run also fails on allow-list entries that are no longer needed. | CI, lefthook and package scripts; read-only. Each supports `--staged`. |
| `node scripts/check-spacing-grid.mjs` | Report off-grid spacing. | Advisory (`pnpm check:spacing`); exits successfully while issues are reported. |
| `node scripts/check-scripts-index.mjs` | Check that every script under `scripts/` is listed in a README (see [listing a new script](#listing-a-new-script)). Contracts: `node --test scripts/check-scripts-index.test.mjs`. | `pnpm check:changed` when `scripts/` changes; read-only. |
| `pnpm test:checks` | Contract tests for the check scripts, `scripts/lib/`, the Git hook, release and worktree scripts. | CI policy; read-only. |
| `node scripts/check-commit-msg.mjs <message-file>` | Validate Conventional Commit subject (types include `revert`); Git's default `Merge …` and `Revert "…"` subjects are accepted too, so amended merges pass. Contracts: `node --test scripts/check-commit-msg.test.mjs`. | Lefthook `commit-msg`; read-only. The hook also skips this validator while a merge is in progress. |

## Manual build and analysis helpers

| Entry point | Purpose | Platform / prerequisites / effects |
| --- | --- | --- |
| `pwsh -File scripts/build.ps1` | Run `cargo build --workspace` and `pnpm -r build`. | PowerShell; writes build outputs. It is not a release installer command. |
| `pwsh -File scripts/clean.ps1` | Remove selected build caches or outputs. | PowerShell; destructive to generated files. Review `-Frontend`, `-Full`, and `-Deep` before use. |
| `pwsh -File scripts/bump-version.ps1 -Version X.Y.Z` | Synchronise workspace versions and lockfiles. | PowerShell; requires pnpm and cargo-edit; modifies manifests and lockfiles. See the [release guide](../docs/releasing.md). |
| `pwsh -File scripts/bench.ps1` | Run Criterion benchmarks, optionally saving/comparing a baseline. | PowerShell, Rust; writes `target/criterion/`. Use synthetic fixtures. |
| `cargo run --release -p tracepilot-core --example parse_probe -- <events.jsonl>` | Time parsing a frozen event log and hash its parsed records and diagnostics for revision comparisons. | Read-only; prints counts, timing and SHA-256, with no event content or diagnostic strings. For measurements build separately first; see the [core probe guide](../crates/tracepilot-core/README.md#parser-performance-probe). |
| `just bench-flamegraph <bench>` or `pwsh -File scripts/bench-flamegraph.ps1 <bench>` | Profile a selected benchmark. | Opt-in profiler (`cargo flamegraph` and platform support); writes profiling output. |
| `pwsh -File scripts/pgo-build.ps1` or `bash scripts/pgo-build.sh` | Profile-guided Rust build. | PowerShell/POSIX; Rust LLVM tools; runs benchmarks and writes profiles/build outputs. |
| `node scripts/claude-census.mjs [claude-config-dir]` | Claude Code format census: unmapped record and attachment types and the Claude Code versions seen, with session and record counts, as Markdown that is safe to paste into an issue (counts, type names and versions only; no paths, ids or content). Contract: `cargo test -p tracepilot-core --test claude_census`. | Rust toolchain; runs `cargo run -p tracepilot-core --example claude_census`. Read-only. The folder defaults to `CLAUDE_CONFIG_DIR`, else `~/.claude`; it reads only `projects/**/*.jsonl` and their `subagents/`, never `sessions/`. |
| `python scripts/validate-session-versions.py --session-dir <isolated-dir>` | Heuristic report of event fields/anomalies in session JSONL by Copilot version. | Manual; defaults to the user's live Copilot session directory when `--session-dir` is omitted. It is distinct from `pnpm cli versions ...` schema analysis, and does not enforce a fixture support manifest. |
| `cargo run --release -p tracepilot-export --example export_probe -- measure <synthetic-session-dir> all-json` | Measure export build/render time, peak memory and output SHA-256. Also supports `sharing-md` and generating a fresh synthetic session. | Build separately before comparisons; see the [export probe guide](../crates/tracepilot-export/README.md#performance-probe). Generation writes a new directory; measurement reads it and emits only timings, counts and hashes. |
| `cargo run --release -p tracepilot-bench --example indexing_workloads -- <mode> <copilot-dir\|-> <claude-dir\|-> <index-db>` | Library-level timing of each indexing workload (first index, incremental, analytics bump, search/full rebuild, source purge/enable) over both sources. Method and baseline: [performance playbook](../docs/performance-playbook.md#measuring-the-whole-indexing-path). | Reads the given session folders; writes only the given scratch index DB. Prints one JSON line. |
| `cargo run --release -p tracepilot-bench --example search_query_probe -- generate <new-db> [sessions] [rows-per-session]` or `measure <db> [repeats]` | Frozen synthetic search corpus and repeatable result-page/count/facet timings, with output parity digests. See [search probe usage](../crates/tracepilot-bench/README.md#search-aggregate-probe). | Generation requires a new scratch DB; measurement is read-only and prints no session text. Library timing, without desktop IPC. |

## Script groups

Each group's README lists its entry points, effects and tests. Tests and
imported helpers are not standalone user commands. Keep externally documented
wrapper paths when changing these folders.

| Folder | What it holds | Details |
| --- | --- | --- |
| `scripts/automation/` | Native app lifecycle, instance registry and readiness behind `pnpm app:*`. | [README](automation/README.md) |
| `scripts/ci/` | CI job selection, required-gate verification and PR comparison/comment helpers. | [README](ci/README.md) |
| `scripts/cli/` | `pnpm build:cli`, then `node --test scripts/cli/cli-smoke.test.mjs` exercises the standalone CLI against the shared turn fixture. Required frontend build job; uses a temporary session directory. | This row |
| `scripts/dependencies/` | Locked resolver inputs, complete dependency graphs and graph invariants. Writes ignored output under `.agent/dependency-audit/`. | [README](dependencies/README.md), [dependency reference](../docs/dependencies/README.md) |
| `scripts/e2e/` | Native integration suite (`pnpm test:e2e`), compatibility wrappers and opt-in diagnostics. | [README](e2e/README.md) |
| `scripts/fixtures/` | Synthetic Copilot and Claude Code session fixtures and parser contracts. | [README](fixtures/README.md) |
| `scripts/git-hooks/` | Tracked Git hook shims (`pre-commit`, `pre-push`, `commit-msg`) and `scripts/git-hooks/run-lefthook.sh`, installed by `pnpm hooks:install`; `node scripts/git-hooks/pre-push-checks.mjs [--base <ref>] [--dry-run]` runs file sizes, rustfmt and typecheck scoped to the branch's changes. Tests: `pnpm test:checks`. | This row, [contributing](../CONTRIBUTING.md) |
| `scripts/lib/` | Shared helpers for scripts; `scripts/lib/list-tracked-files.mjs` lists tracked, staged or changed files and falls back to a filesystem walk when Git can't be spawned. | This row |
| `scripts/macos/` | `bash scripts/macos/bundle-smoke.sh [bundle-dir]` verifies a built app and disk image, installs from the image and launches it (CI macOS job and release workflow). macOS only; needs `pnpm tauri build --bundles app,dmg`; writes ignored `.tracepilot/macos-smoke/`. | This row, [testing guide](../docs/testing.md) |
| `scripts/perf/` | Performance and bundle probes and their comparison contracts. | [README](perf/README.md) |
| `scripts/pricing/` | Pricing parsers, importer and freshness comparator behind `pnpm pricing:*`. | [README](pricing/README.md) |
| `scripts/release/` | `scripts/release/collect-changelog.mjs` behind `pnpm changelog:collect`. Tests: `node --test scripts/release/*.test.mjs`. | This row, [release guide](../docs/releasing.md) |
| `scripts/site/` | `node scripts/site/publish.mjs --dist site/dist`: trusted Site workflow publisher, CI only. Writes only manifest-owned paths in the shared gh-pages root; `--no-api` is for scratch-remote testing. Tests: `node --test scripts/site/*.test.mjs`. | This row |
| `scripts/visual/` | Synthetic frontend capture, reports, policy tests and the trusted publisher. | [README](visual/README.md) |
| `scripts/worktree/` | `scripts/worktree/new.mjs` and `scripts/worktree/clean.mjs` behind `pnpm worktree:new` and `pnpm worktree:clean`. Tests: `node --test scripts/worktree/*.test.mjs`. | This row, [common commands](#common-commands) |
| `site/scripts/` | Landing-page data export and validation, release and HTML facts, browser checks. Tests: `pnpm --filter @tracepilot/site test`; social image: `pnpm --filter @tracepilot/site og` after a build (updates committed `site/public/og.png`). | [Landing-page guide](../docs/landing-page.md) |

## Audit-only helpers

These have recorded one-off use, but no current package, Just, or CI command
invokes them automatically:

| Helper | Evidence and current status |
| --- | --- |
| `scripts/e2e/native-dialog-gateway.mjs` | Used for picker-result substitution in the dated [usability audit](../docs/reports/usability-audit-2026-09-12/validation.md); it does not exercise the OS dialog. Its focused contract suite is `node --test scripts/e2e/native-dialog-gateway.test.mjs`. |
| `scripts/e2e/copilot-compat.mjs` and `scripts/e2e/usability-fixtures.mjs` | The former is cited as an isolated-session example; the latter generated the dated usability audit's synthetic corpus. Neither is a routine CI gate. The fixture generator has imported helpers and tests. |
| `scripts/perf/private-snapshot.mjs` | Used to select the private corpus described in the [performance mission](../docs/reports/performance-mission.md). It has no current workflow caller, writes ignored private copies, and does not itself create the fixture manifest required by `scripts/perf/indexing.mjs`. |
