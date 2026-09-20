# Native desktop integration tests

This Playwright Test project exercises the built Vue frontend, Tauri IPC, Rust
parsers, real filesystem, and SQLite/FTS index inside Windows WebView2.
It complements the [visual harness](../../docs/visual-regression.md), which checks
static frontend appearance against a mocked backend.

## Run

Windows, WebView2, Rust, Node 22, and pnpm 10 are required. No Copilot login or
Playwright browser download is needed.

```powershell
pnpm install
pnpm test:e2e             # Build release frontend/backend and run native journeys
pnpm test:e2e -SkipBuild  # Repeat using the existing app and fixture generator
pnpm test:e2e -Install    # Build NSIS, install, test the installed exe, uninstall
pnpm test:e2e -Install -SkipBuild # Repeat with the existing installer
```

`-Install` builds a separate **TracePilot E2E** package with a distinct application
identifier/executable name and updater artifact generation disabled. It retains the shipping NSIS
configuration and opts into the existing `automation-devtools` feature for CDP.
Normal release configuration is unchanged. The suite checks installer exit status,
the installed product identity/version, uninstall registration, and removal on uninstall.
It records installer and installed executable hashes for diagnostics (Tauri patches
bundle metadata, so the installed and unbundled executable hashes differ).
An existing E2E installation causes a refusal rather than an upgrade/removal.

Every test generates a fresh, owned data directory beneath
`.tracepilot/e2e-results/tests/`. No personal sessions, config, or index are copied.
The existing benchmark `SessionFixtureBuilder` supplies 128 sessions across five
repositories and three models, with 23,240 events and 2,881 turns. Three
named sessions anchor detailed checks; 125 bulk sessions exercise indexing and
aggregation. Dates span January 2025–January 2026; session lengths range from one
to 120 turns, with variable tool counts and durations, 18 interrupted sessions,
one empty session, and 11 tool failures. The E2E generator adds stable search
terms, plans, and real todo databases. Dates are fixed for reproducibility; tests
select All Time or explicit historical ranges rather than depending on today's date.
There is **no prebuilt app index or completed setup config**. One test begins
with an empty sessions directory and adds a session while the app is running.

The launcher uses separate lifecycle state, data roots, and webview profiles, so
it can coexist with an ordinary `pnpm app:start` instance. Cleanup uses the
existing PID/start-time/executable ownership checks. Restart retains the same
test's data root to verify persistence.

## Coverage and boundaries

| Journey | Regression coverage |
| --- | --- |
| Setup and first indexing | Default isolated paths, directory validation, saved setup, fresh SQLite creation, discovery and summary parsing |
| Library and session detail | Search filter and no-match state; overview plan; conversation and tool data; raw events; SQLite todos; metrics; file explorer; timeline |
| Full-text search | Automatic content indexing, sentinel found in message content, navigation back to the correct session |
| Bulk analytics | Exact session/tool/code-change totals, model distribution, repository filters, custom date bounds and recovery |
| Multiple session tabs | Ctrl-click two sessions, independent conversation state, switch and close |
| Data changes | Append to an open session and refresh; new session arriving after empty first run |
| Settings and restart | Empty-session visibility, theme saved to config, native process restart, persistent index and readable sessions |
| Desktop sizes | Full flow at 1440×960; navigation at 960×640 and 2560×1440 |
| NSIS package (CI) | Build, silent installation, installed executable launch, and uninstall |

The suite does not call a live Copilot service, launch paid sessions, modify real
repositories, automate native file dialogs, or validate signed updater/MSI flows.
Large corpus performance and pixel appearance remain with their existing harnesses.

## Maintenance and diagnostics

The Windows installer job runs on PRs and main pushes as part of CI's `required`
gate. It has one worker, bounded waits, and no automatic retries. Three independent
journeys each start fresh; named `test.step` sections identify the failing flow.
Use accessible roles/names and fixture outcomes when extending coverage. Use a
stable test ID only where the existing UI provides one. Avoid CSS structure,
screenshots as assertions, exact timings, and copying every UI unit test here.

CI restores a dedicated `e2e-release` Rust dependency cache and the shared pnpm
store cache. Main-branch runs save caches; PRs restore them. The app build and all
tests still run, and every journey generates a new corpus and index.

The launcher passes the loopback CDP port and isolated profile through Tauri's
WebView configuration in development/`automation-devtools` builds. This also
works on elevated Windows runners, where recent WebView2 versions ignore
`WEBVIEW2_*` environment overrides. Normal release builds exclude this code.
See [Microsoft's elevated-host guidance](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/security#for-an-elevated-host-app-use-appropriate-override-flags).

Reports, per-process traces/screenshots, console output, lifecycle logs, and app
logs are under `.tracepilot/e2e-results/`. CI uploads diagnostics for seven days,
including on failure, without uploading the WebView cache. Open the HTML report
or a trace with Playwright:

```powershell
pnpm exec playwright show-report .tracepilot/e2e-results/report
pnpm exec playwright show-trace <path-to-trace.zip>
```

For interactive diagnosis use the repository
[automation skill](../../.github/skills/tracepilot-app-automation/SKILL.md).
`pnpm app:start -Runtime production -SkipBuild -DataRoot <absolute-test-root>
-StateDirectory <absolute-lifecycle-directory>` prints the CLI attach command.
Stop using the same `-StateDirectory`; the normal `app:stop` intentionally owns
only the default instance. An installed executable can be selected with
`-Executable <absolute-exe>` (requires production, SkipBuild, and DataRoot).

## Repository map

- `apps/desktop`: Vue routes/stores and the Tauri executable/bundle configuration.
- `packages/client`: typed IPC; `packages/ui`: shared controls/renderers;
  `packages/types`: shared models and defaults.
- `crates/tracepilot-core`: discovery, session parsing, paths, and analytics.
- `crates/tracepilot-indexer`: SQLite metadata index and FTS content search.
- `crates/tracepilot-tauri-bindings`: commands, configuration, startup/indexing services.
- `crates/tracepilot-bench`: deterministic synthetic events reused by this suite.
- `scripts/automation`: native launch/readiness/owned-process lifecycle.
- `scripts/e2e/test.ps1`: release build and optional installer orchestration.
- `tests/e2e`: native fixtures, journeys, runner configuration, and package override.

References: [Playwright WebView2](https://playwright.dev/docs/webview2),
[Tauri Windows packaging](https://v2.tauri.app/distribute/windows-installer/),
[NSIS switches](https://nsis.sourceforge.io/Which_command_line_parameters_can_be_used_to_configure_installers).
