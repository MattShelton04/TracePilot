---
name: tracepilot-app-automation
description: Inspect, interact with, and capture the running TracePilot desktop app through the Playwright agent CLI and real Tauri/Rust IPC. Also supports frontend-only Vite exploration with mock data.
---

# TracePilot app automation

Use the **upstream Playwright CLI** for the observe → act → verify loop.
It keeps the connection between shell commands; routine exploration needs no
custom `.mjs` file, browser download, MCP installation, or Rust automation plugin.
Run commands from the repository root after `pnpm install`.

## Real desktop app (primary, Windows + WebView2)

```powershell
pnpm app:start
# Run the attach command printed by startup (the port may differ):
pnpm exec playwright-cli -s=tracepilot-desktop attach --cdp=http://127.0.0.1:9222
pnpm exec playwright-cli -s=tracepilot-desktop snapshot --filename=.playwright-cli/current.yml
```

Startup builds/runs Tauri with frontend HMR, waits for the rendered app and a
successful **read-only Rust IPC call**, and prints the verified endpoint and log
directory. It reuses this checkout's healthy instance on repeated starts.
For a long first build, let the command finish; inspect
`.tracepilot/automation/desktop-tauri.err.log` for compiler progress.

This is the actual desktop webview with your configured sessions, SQLite index,
and settings. The WebView profile is isolated; **application data is shared**.
Settings, files, sessions, and orchestration actions have real effects. Use
the task's authorized scope and review captures for private content before publishing.

## Observe, act, verify

Read the snapshot file named in each response. Use references from the **current**
snapshot; the following `e12`/`e24` are illustrative, not fixed selectors:

```powershell
pnpm exec playwright-cli -s=tracepilot-desktop click e12
pnpm exec playwright-cli -s=tracepilot-desktop fill e24 'search terms'
pnpm exec playwright-cli -s=tracepilot-desktop press Enter
pnpm exec playwright-cli -s=tracepilot-desktop snapshot --filename=.playwright-cli/current.yml
pnpm exec playwright-cli -s=tracepilot-desktop screenshot --filename=.playwright-cli/before.png
pnpm exec playwright-cli -s=tracepilot-desktop console error
```

Open screenshots with the agent's image-viewing tool: writing a file is not
visual verification. For before/after evidence, keep the route, viewport,
theme, data, and interaction state consistent.
Focus on desktop sizes: 1440×960 (default), 960×640 (minimum), and 2560×1440
(larger workspace). These are CSS viewport sizes; monitor DPI scaling can differ.
Use `find 'text'` for focused snapshot excerpts; saving snapshots to a file avoids
flooding the conversation with large session lists or search results.

Prefer visible controls and their accessible names. Re-snapshot after navigation
or layout changes. For a durable assertion or data-dependent wait, the CLI also
accepts normal Playwright code (PowerShell single quotes avoid shell expansion):

```powershell
pnpm exec playwright-cli -s=tracepilot-desktop run-code 'async page => { await page.getByTestId("session-grid").waitFor(); }'
pnpm exec playwright-cli -s=tracepilot-desktop eval '() => window.__TRACEPILOT_IPC_PERF__?.getIpcPerfLog()'
```

Wait for the relevant visible result/loading indicator or a web-first assertion;
do not use fixed sleeps to decide that a route is ready. TracePilot uses hash
routing. Follow sidebar links; do not navigate the native webview to another
origin or create/close its tabs. For detached app windows, use `tab-list` and
`tab-select` to select the observed window.

Use `pnpm exec playwright-cli --help` or `<command> --help` for more operations,
including `resize`, `tracing-start`, `tracing-stop`, and `run-code --filename`.
For IPC/performance investigation and optional MCP attachment, see
[the automation guide](../../../docs/app-automation.md).

## Frontend only

On Windows, `pnpm app:ui` starts a separately tracked Vite server and prints:

```powershell
pnpm exec playwright-cli -s=tracepilot-ui open http://127.0.0.1:1420 --browser=msedge
pnpm exec playwright-cli -s=tracepilot-ui snapshot
```

Use the actual URL printed by startup. On other platforms run `pnpm dev` and
open its URL with the CLI (choose an installed browser or use `install-browser`).
This mode uses existing client mocks; it can validate frontend layout and
interaction, **not** Rust IPC, persistence, indexing, or native dialogs. Verify
desktop fixes in desktop mode before claiming end-to-end success.

## Lifecycle and recovery

```powershell
pnpm app:status
pnpm exec playwright-cli -s=tracepilot-desktop detach
pnpm app:stop
# Frontend session/server:
pnpm exec playwright-cli -s=tracepilot-ui close
pnpm app:stop -Mode ui
```

Detach leaves the desktop running. `app:stop` stops only recorded process trees
whose PID, start time, and executable still match. It preserves logs and profile
data. Never use `kill-all`, process-name cleanup, or a port scan to select an
unverified app. For a lost CLI session after a Rust restart, detach and reattach
using the endpoint from `app:status`, then take a new snapshot.

If startup fails, read the printed log paths; fix the concrete error and retry.
`pnpm app:start -Port 9230 -TimeoutSeconds 900` overrides CDP port/build timeout.
No CDP endpoint on macOS/Linux: this desktop workflow relies on Windows WebView2;
use frontend mode there or a separate Tauri WebDriver test setup.
