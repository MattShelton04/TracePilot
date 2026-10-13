---
name: tracepilot-app-automation
description: Inspect, interact with, and capture the running TracePilot desktop app through the Playwright agent CLI and real Tauri/Rust IPC. Also supports frontend-only Vite exploration with mock data.
---

# TracePilot app automation

Drive the real Windows Tauri app (WebView2 over CDP) with the pinned Playwright
CLI. Run commands from the repository root after `pnpm install`.

## Start an isolated instance

Agents always use a named instance. When `CLAUDECODE`, `CODEX_*` or `AI_AGENT` is
set, a bare `pnpm app:start` refuses and prints these commands:

```powershell
pnpm app:start -Instance <slug> -Fixtures   # synthetic sessions (the default choice)
pnpm app:start -Instance <slug> -RealData   # the maintainer's real sessions, when asked
pnpm app:status -All                        # every live instance on this machine
pnpm app:stop -Instance <slug>
```

- Both get their own ports, data root (`.tracepilot/instances/<slug>/data`), config,
  index and WebView profile. Setup is already complete.
- `-Fixtures` generates synthetic Copilot and Claude Code sessions. Add `-FirstRun`
  with a fresh name to test the setup wizard.
- `-RealData` mirrors the real Copilot `session-state` and Claude Code `projects`,
  `plans` and `file-history` into the data root at each start, using hard links
  (copies for SQLite sidecars). The real TracePilot config and index are never
  opened. Use it for local checks only: never commit, publish or paste what it shows.
- Startup waits for the rendered app and a read-only Rust IPC call. The first Rust
  build in a worktree takes minutes; let it finish. Logs are in
  `.tracepilot/instances/<slug>/`.
- Only one development desktop instance runs per checkout. Use another worktree for a second one.
- A human's bare `pnpm app:start` uses their configured data, with real effects.

## Drive it with `pnpm pw`

```powershell
pnpm pw <slug> snapshot --filename=.playwright-cli/current.yml
pnpm pw <slug> click e12
pnpm pw <slug> fill e24 "search terms"
pnpm pw <slug> press Enter
pnpm pw <slug> resize 960x640
pnpm pw <slug> screenshot --filename=.playwright-cli/before.png
pnpm pw <slug> console error
pnpm pw <slug> eval-file .playwright-cli/probe.js   # file: () => document.title
pnpm pw <slug> run-file .playwright-cli/flow.js     # file: async page => { ... }
```

- The wrapper (`scripts/automation/pw.mjs`) finds the instance's session and endpoint,
  attaches on first use, and passes arguments to the CLI without a shell.
- Use `<slug>:ui` for `pnpm app:ui -Instance <slug>`. Use `default` for an unnamed instance.
- Put JavaScript in a file under `.playwright-cli/` (ignored by Git). Inline JS
  passed through the pnpm/cmd shims loses its quotes.
- Every other command is the upstream CLI: `pnpm pw <slug> --help`.

## Observe, act, verify

- Read the snapshot file and use refs from the **current** snapshot. `e12` above is illustrative.
- Re-snapshot after navigation or layout changes. `find 'text'` returns a focused excerpt.
- Wait on a visible result, or use a locator in `run-file`. Don't use fixed sleeps.
- TracePilot uses hash routing. Follow sidebar links, and don't open or close
  webview tabs. For detached windows use `tab-list` and `tab-select`.
- Open screenshots with your image viewer: writing a file is not visual verification.
- Keep route, viewport, theme and data the same for before/after captures.
- Viewports: 1440×960 (default), then 960×640 (minimum) and 2560×1440.
- `eval` can read `window.__TRACEPILOT_IPC_PERF__?.getIpcPerfLog()`. See the
  [automation guide](../../../docs/app-automation.md) for IPC, MCP and diagnostics.

## UI verification checklist

- Tooltips, menus and popovers are not clipped by scroll containers or panel edges.
- Every clickable element shows a pointer cursor; static text does not.
- No layout jitter while loading: reserve space for async content.
- Ordering is deterministic: lists keep a stable order across reloads and refreshes.
- Text and icons have enough contrast in both light and dark themes.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `The browser '…' is not open` | Attach first. `pnpm pw` does this for you. |
| Session lost after a Rust rebuild | `pnpm pw <slug> attach`, then take a new snapshot. |
| `resize` rejects its arguments | Pass two numbers, `resize 1440 960`. `pnpm pw` also accepts `1440x960`. |
| `strict mode violation … resolved to N elements` | Use a ref from the current snapshot, or narrow the locator (`getByRole('button', { name: 'Save', exact: true })`, or scope it to a container). |
| `No free loopback port` or a port in use | Omit `-Port`/`-UiPort`. `pnpm app:status -All` lists who holds each port. |
| Stale app process or locked `tracepilot-desktop.exe` | `pnpm app:stop -Instance <slug>`. It also ends app processes that use the instance's WebView profile. Never `taskkill` by name or use `kill-all`. |
| Startup fails | Read the printed log paths (`desktop-tauri.err.log` for Rust). Fix the error and retry. |

## Frontend only

`pnpm app:ui -Instance <slug>` starts Vite with client mocks. Drive it with
`pnpm pw <slug>:ui …`. It checks layout and interaction, **not** Rust IPC,
persistence, indexing or native dialogs. Verify desktop fixes in desktop mode.
On macOS/Linux, run `pnpm dev` and open its URL with the CLI.

## Release runtime

`pnpm app:start -Instance <slug> -Fixtures -Runtime production` builds and runs the
release executable against built assets. Add `-SkipBuild` to reuse an existing build.
See [the automation guide](../../../docs/app-automation.md#lifecycle-contract).
