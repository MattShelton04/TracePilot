# Running-app automation

TracePilot uses Microsoft's **Playwright agent CLI** for interactive development.
The default target is the real Windows Tauri app, attached over WebView2 CDP.
The same CLI opens the Vite frontend in a browser with the client's mock data.

## Quick start

Install workspace dependencies with `pnpm install`, then from the repo root:

```powershell
pnpm app:start
# Use the attach command printed by startup:
pnpm exec playwright-cli -s=tracepilot-desktop attach --cdp=http://127.0.0.1:9222
pnpm exec playwright-cli -s=tracepilot-desktop snapshot
```

Read the returned snapshot file, click an observed element reference, and inspect
the resulting snapshot or screenshot. Connections persist between commands.
The [agent skill](../.github/skills/tracepilot-app-automation/SKILL.md) documents
the complete short workflow. No handwritten script is needed for ordinary use.
The [validation report](reports/automation-skill-validation.md) records the
real-app proof of concept and before/after UI captures.

| Task | Command |
| --- | --- |
| Capture evidence | `pnpm exec playwright-cli -s=tracepilot-desktop screenshot --filename=.playwright-cli/before.png` |
| Inspect console errors | `pnpm exec playwright-cli -s=tracepilot-desktop console error` |
| Record a trace | `pnpm exec playwright-cli -s=tracepilot-desktop tracing-start` / `tracing-stop` |
| Check runtime/endpoint | `pnpm app:status` |
| Disconnect agent | `pnpm exec playwright-cli -s=tracepilot-desktop detach` |
| Stop desktop and its Vite server | `pnpm app:stop` |
| Start a built release runtime | `pnpm app:start -Runtime production` |
| Start frontend-only server | `pnpm app:ui` |
| Stop frontend-only server | `pnpm app:stop -Mode ui` |

`app:ui` prints an `open URL --browser=msedge` command for a separate
`tracepilot-ui` session. UI mode uses mocks and cannot prove Rust behavior.
On macOS/Linux use `pnpm dev` and open the printed URL with an installed browser.
The managed launcher is Windows-only, matching the desktop CDP target.

## Why this integration

Options evaluated against the goal of autonomous, exploratory development:

| Option | Fit |
| --- | --- |
| Playwright CLI + WebView2 CDP | Selected: standard snapshot/action loop, persistent sessions, screenshots, traces, console and Playwright escape hatch; no app-side bridge. |
| Playwright MCP + CDP | Same underlying model for agents with MCP tools; optional, no second repository automation API. |
| Tauri WebDriver / WebdriverIO | Appropriate for native platform E2E suites. Requires platform driver setup; unnecessary for this Windows browser-style exploration workflow. |
| Custom Tauri automation plugin or HTTP IPC proxy | Adds protocol/code/permissions to maintain when WebView2 already exposes the required surface. |
| Frontend browser only | Fast UI iteration with mock data, supplementary to real desktop verification. |

Primary references: [Playwright coding agents](https://playwright.dev/docs/getting-started-cli),
[WebView2 attachment and profile isolation](https://playwright.dev/docs/webview2),
[Playwright MCP](https://github.com/microsoft/playwright-mcp), and
[Tauri WebDriver](https://v2.tauri.app/develop/tests/webdriver/).

The workspace pins `@playwright/cli` and its transitive dependencies in the lockfile.
The tested CLI release (0.1.19) depends on a dated Playwright alpha; the exact
lockfile matters. Re-run desktop attach/action/screenshot/detach checks when
upgrading it. Existing `playwright-core` diagnostics keep their own version.
CDP is Chromium-specific and has lower fidelity than Playwright's own protocol;
this workflow does not claim to automate OS-owned file pickers or native chrome.

## Lifecycle contract

[app.ps1](../scripts/automation/app.ps1) owns **launching only**. Its default
development runtime starts the installed Vite and Tauri CLIs directly with logs
redirected to `.tracepilot/automation/`. Tauri uses a generated dev config for
the selected loopback Vite URL. Frontend HMR and Rust watching remain enabled.

For a production-equivalent runtime, run
`pnpm app:start -Runtime production -DataRoot C:\benchmarks\tracepilot-run`.
The data root must be an absolute, dedicated directory. It resolves to:

| State | Isolated path |
| --- | --- |
| Copilot home | `<data-root>/copilot` |
| Session state | `<data-root>/copilot/session-state` |
| TracePilot home | `<data-root>/tracepilot` |
| Config | `<data-root>/tracepilot/config.toml` |
| SQLite index | `<data-root>/tracepilot/index.db` |
| WebView profile | `<data-root>/webview-profile` |
| Rust/app logs | `<data-root>/logs` |

The launcher rejects relative paths, broad roots, reparse points, and configured
state paths outside that boundary. `TRACEPILOT_DATA_ROOT` controls the Rust
defaults and config bootstrap for the child process only. Omitting `-DataRoot`
keeps the normal product configuration and session/database behavior unchanged.

Production runtime first runs the normal Tauri release build with `--no-bundle`,
then launches the release executable against built frontend assets. The build is
complete before the launcher reports readiness, so attach-driven flow timing
does not include compilation. This automation executable enables Tauri's
`devtools` feature solely for WebView2 CDP; shipping builds do not enable it.
For repeat fresh-process runs of an already-built executable, add `-SkipBuild`.
That explicit opt-in fails when the release executable is absent and records its
SHA-256, file timestamp/size, current source revision, and dirty state. Default
production starts continue to build, avoiding accidental stale-binary reuse.

The launcher serializes lifecycle commands per mode, chooses unused ports,
records process IDs/start times/executables, and cleans up owned trees on failure.
It never kills an app merely because of its name or listening port. Repeated
starts validate runtime, data root, and requested CDP port before reusing the
current instance. Stop the tracked instance before changing those options. The
recorded state also identifies built versus HMR frontend, Rust profile, devtools
mode, release executable path, timestamp, and size so benchmark tooling can
reject an accidental development comparison. Without `-DataRoot`, desktop
interactions retain their usual real effects on configured application data.

Desktop readiness checks the existing rendered TracePilot webview and makes a
read-only `get_install_type` Rust IPC call, which also works before setup. A listening port, page title, mock
data, or performance hook alone cannot pass this check. Route-specific readiness
still belongs to the caller: wait for the result you need using Playwright
locators/assertions rather than sleeps. First-time setup is an inspectable state.

CDP is enabled only in the launched child environment and bound to loopback.
It gives local clients full access to that development app. Stop it when finished.
Runtime logs, profiles, snapshots, and traces are ignored by Git. Review evidence
for session text, paths, secrets, and other private content before publishing.

## Optional MCP connection

An MCP-capable agent can use the upstream server against the endpoint printed by
`app:start`. Configure it in that agent's MCP settings (not in the shipped app):

```json
{
  "mcpServers": {
    "tracepilot": {
      "command": "npx",
      "args": ["@playwright/mcp", "--cdp-endpoint", "http://127.0.0.1:9222"]
    }
  }
}
```

Use your client's supported package pinning for MCP. The repository's tested,
zero-extra-configuration path is the pinned CLI. The MCP server is an optional
adapter, not required for the skill; it does not launch TracePilot for you.

## Diagnostics and repeatable tests

`eval` can read `window.__TRACEPILOT_IPC_PERF__.getIpcPerfLog()` and
`window.__TRACEPILOT_PERF__.getPerfLog()`. Clear the IPC buffer before a measured
flow. Tauri IPC is not HTTP, so browser network logs do not measure Rust commands.
`run-code` exposes a normal Playwright `page` for assertions; `--filename` handles
larger reusable flows without shell quoting. Prefer the CLI for exploration and
existing test suites for durable regression coverage.

Existing smoke/performance/media scripts remain supported through
[connect.mjs](../scripts/e2e/connect.mjs), which attaches to the recorded desktop
endpoint (or an explicit port), verifies the native target, and disconnects on
failure. The old PowerShell entrypoints delegate to the new lifecycle owner.
They no longer support broad `-All` cleanup or launching a potentially stale
binary with `-Build`. See [testing](testing.md) and the
[performance playbook](performance-playbook.md) for those optional diagnostics.
