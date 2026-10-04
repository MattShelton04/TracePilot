# TracePilot Testing Guide

This document is the canonical reference for how TracePilot is tested. It
covers the three distinct layers in the test pyramid and points at the
tooling, scripts, and CI status for each.

## TL;DR

| Layer | Tool | Location | Runs by default? |
| --- | --- | --- | --- |
| Unit / integration (JS/TS) | Vitest | `apps/**`, `packages/**` (`*.spec.ts`, `*.test.ts`) | ✅ `pnpm test` |
| Unit / integration (Rust) | `cargo test` | `crates/**` | ✅ `cargo test --workspace --exclude tracepilot-desktop` |
| Copilot pricing sources and importer | Node test runner + offline drift check | `scripts/pricing/` | ✅ CI workspace test job; locally `pnpm pricing:check` and `pnpm test:pricing` |
| Copilot live pricing freshness | Network source comparison + trusted PR report | `scripts/pricing/`, `pricing-freshness.yml`, `pricing-report.yml` | ✅ Advisory on every PR; locally `pnpm pricing:freshness`. Never blocks merging; see [pricing CI behavior](pricing-model.md#ci-consistency-and-live-freshness-checks). |
| Component visual regression | Playwright CT | `packages/ui/src/__vrt__/*.vrt.spec.ts` | ❌ on-demand only |
| Desktop frontend visual comparison | Chromium + synthetic backend fixtures | `scripts/visual/`, `visual-*.yml` workflows | ✅ relevant PRs and main pushes |
| Desktop integration (installed Tauri app) | Playwright Test + native WebView2/CDP | `tests/e2e/`, `scripts/e2e/test.ps1` | ✅ Windows installer job on PRs and main |
| macOS bundle smoke (disk image install + launch) | Shell + `codesign`/`hdiutil` | `scripts/macos/bundle-smoke.sh` | ✅ Non-blocking macOS job on PRs and main; also gates the release's macOS job |
| Interactive desktop diagnostics | Playwright agent CLI | `scripts/automation/`, `scripts/e2e/` | ❌ on-demand |

The JS/TS and Rust unit suites are the primary regression gate. Component VRT
is opt-in; native integration tests run in CI. [Desktop frontend visual comparisons](visual-regression.md)
run in CI with synthetic backend data and report PR base/head changes; they do
not verify Rust or native behavior. VRT needs a Chromium download;
desktop automation attaches to the installed WebView2 runtime and needs a live
Tauri build, with no separate browser download.

Required CI also enforces Biome, rustfmt, Clippy, repository policies, regenerated
IPC contract freshness, and dependency audits. RustSec vulnerability findings and
high/critical npm advisories in both the production and full pnpm graph fail the
security job, as do high/critical findings in the isolated `scripts/visual` npm
lockfile. Informational RustSec notices remain visible without failing it.
See the [dependency security reference](dependencies/security.md) for scanner
scopes, remaining notices, and the separate cargo-deny policy findings.

CI runs its full application coverage on every main push. PRs use the complete
base-to-merge diff: documentation-only changes skip application builds/tests;
changes confined to `site/` and documentation retain frontend builds and
workspace tests but skip desktop tests, Rust, Windows automation/installer and
the macOS bundle. Shared package, lockfile, workflow, script and unknown-path
changes run all jobs. Repository policy and live dependency audits always run.
The single `required` check verifies that selected jobs succeeded and that
only unselected jobs were skipped; missing classification, cancellation or
an unexpected skip fails it. Selection and gate contracts live in
`scripts/ci/classify-changes.mjs` and its Node test suite.

Linux, Windows and macOS each have one main-branch pnpm cache writer. PRs
restore main caches without saving branch-local entries. Filtered dependency
installs use distinct keys and can fall back to the full workspace store.
Rust caches retain dependencies per workload; CI tests use `line-tables-only`
debug information, retaining file:line backtraces and debug assertions without
full variable/type information. The release profile remains the shipping
profile; installer/bundle CI disables LTO and uses 16 codegen units to check
native packaging without paying its shipping optimization cost. Rust commands
use `--locked`, and example contracts use the same workspace feature set as
the unit suites to avoid recompiling core dependencies between steps.

The security job verifies the checksum of RustSec's pinned cargo-audit binary
before installation and still refreshes the advisory database on every run.
The existing audit reporter preserves vulnerability failures and visible
informational notices, including its log fallback on fork PRs.

The policy job checks workflow syntax, expressions and embedded Bash with
checksum-pinned actionlint 1.7.12 and the runner's ShellCheck, in addition to
remote action-pin verification. That actionlint release predates GitHub's
`concurrency.queue` field; only its unknown-key diagnostic for that field is
ignored. Remove the narrow exception when updating to a supporting release.

### Pinned CI binaries

Dependabot updates action references and package lockfiles, but cannot update
the cargo-audit and actionlint release archives downloaded in
[`ci.yml`](../.github/workflows/ci.yml). Maintainers should review these two
pins alongside the weekly Dependabot updates and promptly when the advisory
database reports a scanner-format incompatibility. Keep the version and
checksum pinned; fetching a floating latest binary would execute an
unreviewed tool in CI.

1. Check the official [RustSec cargo-audit releases](https://github.com/rustsec/rustsec/releases?q=cargo-audit)
   and [actionlint releases](https://github.com/rhysd/actionlint/releases), including
   compatibility notes. RustSec publishes multiple tools; select a `cargo-audit/`
   tag rather than its repository's generic latest release. Distinguish
   scanner/database-format errors from actual
   vulnerabilities; both must remain visible and failing until addressed.
2. Download the chosen Linux amd64 archive from that official release. Verify
   an upstream checksum or release attestation when provided; calculate its
   SHA256 (`sha256sum <archive>` on Linux or `Get-FileHash -Algorithm SHA256`
   on Windows) and review the source URL and digest together.
3. Update the release URL, versioned archive filename and committed SHA256 in
   the corresponding CI step and update the version references in this guide.
   Verify `cargo audit --version` or `actionlint --version`. Scanner
   installation must still pass checksum validation before execution.
4. Run the policy lint and remote action-pin checks, then confirm the PR's
   live security job can read the current advisory database and still uses
   the RustSec reporting wrapper. Check notices as well as the exit status.
   For actionlint, test whether the new release accepts `concurrency.queue`
   and remove its narrow diagnostic exception only when supported.

The current pins are cargo-audit 0.22.2 and actionlint 1.7.12. New scanner
releases require this review even if their wrapper action has not changed.

## 1. Unit & integration (Vitest)

- **Run all:** `pnpm test`; the runner reports the current test inventory.
- **Run one package:** `pnpm --filter @tracepilot/desktop test`.
- Desktop tests cap workers at four; use `--maxWorkers=2` while another native build runs. Tests must await store hydration and deferred imports instead of relying on arbitrary delays.
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

The [native integration suite](../tests/e2e/README.md) runs first-time setup,
indexing, browsing/session tabs, full-text search, file refresh, settings, restart,
and an empty-library arrival flow against synthetic files and a real Rust backend.
Run `pnpm test:e2e` locally; use `-SkipBuild` for repeat runs or `-Install` to
exercise NSIS installation and uninstall as CI does. No private data is used.

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
budgets. It exits non-zero on assertion failures and reports budget overruns as
diagnostic warnings. It also verifies keyboard access to Settings and visibility
of the sidebar brand/footer at 1440×960, 960×640, and 2560×1440. It writes its report
and screenshots under the ignored `scripts/e2e/screenshots/` directory.
Native README-style capture uses your real local sessions, so it writes candidates
and final-viewport images only under the ignored `screenshots/readme-candidates/`.
Tracked README images come from the synthetic showcase described in
[visual regression](visual-regression.md#readme-screenshots).

`pnpm test:automation` verifies lifecycle reuse, process-tree cleanup, stale PID
protection, startup timeouts, and occupied ports using isolated local fixtures
(Windows; skipped elsewhere). Readiness tests use installed Edge to reject mock
pages and failed IPC, and accept setup without a database. These tests do not read
the user's sessions or build Rust.

Use CLI commands for investigations instead of adding one-off scripts. For
regressions, extend existing component/store tests, `smoke-test.mjs`, or
`perf-profile.mjs` as appropriate. Prefer accessible names and stable test IDs;
wait for visible results or assertions. The older performance flows retain
sampling windows and are diagnostic, not a substitute for user-flow assertions.
Clear IPC timing buffers before measuring. Disconnect Playwright in `finally`
and stop owned processes with `pnpm app:stop` when finished.

Local desktop E2E is opt-in; the Windows installer job runs `pnpm test:e2e -Install`
on PRs and main in CI. The suite requires Windows, WebView2, the Rust toolchain,
Node 22, and pnpm 10. Frontend-only exploration is portable via `pnpm dev` and
the CLI. WebView2 CDP does not apply to macOS/Linux.

The macOS job builds the ad-hoc signed app and disk image, verifies the
signature, bundle identity and arm64 architecture, copies the app out of the
disk image and checks that it logs startup against an isolated data root and
keeps running. WKWebView exposes no CDP endpoint, so it runs no Playwright
journeys. The job is not part of `required` (macOS is tier 2 in
[ADR 0010](adr/0010-supported-platforms.md)) and uploads the disk image as a
`tracepilot-macos-dmg-*` artifact for manual testing on a Mac.

## Rich-tool fixtures

Generate deterministic files for the real backend, then start the native app
against that isolated root:

```powershell
node scripts/fixtures/session-fixtures.mjs
pnpm app:start -DataRoot "$PWD/.tracepilot/rich-tool-fixtures"
# Attach with the command printed by startup, finish setup, then Refresh data.
```

The library contains **SYNTHETIC · Rich tool renderer gallery** with 63 scenarios
and **SYNTHETIC · Report intent renderer** with the remaining `report_intent` case.
Keeping that call separate prevents its session objective banner from appearing
over unrelated renderer scenarios. All 64 cases cover registered renderers, all
six argument renderers, fallback, error, pending/empty output, long responses
and expansion/page states. These
reconstruct tool contracts with synthetic content, without private recordings.
PowerShell includes successful asynchronous invocation while its process is
running and the native `<shellId: 0 completed with exit code 0>` footer. This
static corpus supplements actual incremental-output interaction checks.

The JSONL stores complete results. Native reconstruction and frontend previews
use the 1024-byte UTF-8 limit for tools other than `web_search`. Load the full
response before testing local Show all controls, raw disclosures or later pages.
Paired browser cases perform those interactions automatically; native gallery
turns retain the same scenario labels and payloads for manual inspection.

`--root=PATH` selects another profile. The generator verifies its ownership and
content hashes on repeated runs, preserves config/index files, and refuses
edited sessions or changed fixture contracts. Use a fresh root in those cases.
Stop the tracked app before switching roots. The shared fixture modules also
feed the [frontend visual captures](visual-regression.md#rich-tool-iteration).
Run `node --test scripts/fixtures/*.test.mjs` for corpus/renderer coverage checks.

Generated JSONL, indexes and screenshots stay in ignored `.tracepilot/` directories.

### Reset and recovery validation

Use an explicit synthetic `-DataRoot` for destructive settings tests. For a
concurrent checkout, also choose distinct `-Port`, `-UiPort`, and
`-StateDirectory` values. A separate WebView profile alone does not isolate data.

1. Finish setup and verify sessions, search results, and analytics.
2. Change a preference and immediately use **Reset Everything**. Confirm setup
   returns, config and the active index/WAL/SHM files are absent, and original
   session files retain their hashes. Factory reset removes configuration and
   the active index; it does not delete source sessions or saved captures.
3. Finish setup again, rebuild both indexes, and verify the same session/search
   and analytics totals. Add, edit, and remove a disposable synthetic session;
   incremental refresh must add/update/remove its search hits and analytics.
4. Restart the owned app and verify configuration and rebuilt data persist.

Unit regressions separately control races that are hard to schedule through the
UI: pending preference hydration/saves, reset versus queued indexing, delayed
search-phase handoff, and source-root changes. SDK tests with a local protocol
peer cover stalled handshakes/requests, responsive status, deadlines, and
disconnect cleanup; they do not establish provider-backed conversation behavior.

## Cross-references

- `packages/ui/src/__vrt__/README.md` — VRT contract + baseline workflow
- `.github/skills/tracepilot-app-automation/SKILL.md` — E2E skill API
- `docs/performance-playbook.md` — Criterion, flamegraphs, trace analysis
- `perf-budget.json` — IPC timing budgets consumed by `validateBudgets()`
- `scripts/README.md` — index of all helper scripts (including `e2e/`)
