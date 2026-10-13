# TracePilot

<p align="center">
  <img src="assets/logo.svg" width="80" alt="TracePilot logo" />
</p>

<p align="center">
  <strong>A desktop app for inspecting, searching, and launching GitHub Copilot CLI and Claude Code sessions.</strong>
</p>

<p align="center">
  <a href="https://mattshelton04.github.io/TracePilot/"><strong>Website and live demo</strong></a> ·
  <a href="https://github.com/MattShelton04/TracePilot/releases/latest"><strong>Download</strong></a>
</p>

TracePilot is built for developers who lean on coding agents and want a clearer view of what happened across their sessions: prompts, assistant turns, subagents and the messages they exchange, tool calls, todos, checkpoints, context growth, prompt-cache state, token usage, cost, search, and orchestration.

It reads the sessions Copilot CLI writes under `~/.copilot/session-state/` and Claude Code writes under `~/.claude/projects/`, indexes them locally, and shows them side by side in a Tauri desktop app backed by Rust, SQLite, and Vue. Your session data stays on your machine.

![TracePilot session library with Copilot CLI and Claude Code sessions](docs/images/readme-session-list.png)

> **Project status:** TracePilot is early-stage software. It is useful today, but the UI and internal data model still change quickly.
>
> **Platform status:** TracePilot is tested on Windows. Apple Silicon Macs get a preview build; Intel Macs and Linux are not yet release targets.

<p align="center">
  <a href="#what-you-can-do">What you can do</a> |
  <a href="#screenshots">Screenshots</a> |
  <a href="https://mattshelton04.github.io/TracePilot/visual/">Visual history</a> |
  <a href="#install-and-run">Install and run</a> |
  <a href="#architecture">Architecture</a> |
  <a href="#development">Development</a> |
  <a href="#license">License</a>
</p>

---

## What you can do

### Inspect sessions

Browse your session history as a searchable library, filter it by source, repository, or folder, and see which sessions are **Busy** or **Waiting** right now. Open any session for a tabbed deep-dive:

| Area | What it helps with |
| --- | --- |
| **Overview** | Headline numbers, how the session ended, incidents, changes, plan and checkpoints, and turn activity over time. |
| **Conversation** | User/assistant turns, reasoning, model switches, parallel subagents, skill invocations, tool calls, and rich tool-result renderers. |
| **Events** | Raw session events with filtering and pagination for debugging parser or CLI behavior. |
| **Todos** | Copilot's task state as a list or dependency graph. |
| **Metrics** | Cost, token and cache usage per model or per agent, duration, code changes, and prompt-cache timing. |
| **Context** | How the context window grows by turn or over time (system prompt, tool definitions, conversation), where compactions happened, and which tools contribute most. |
| **Explorer** | Files inside the session state directory, with viewers for Markdown, JSON/JSONL, CSV, SQLite, images, and more. |
| **Timeline** | Swimlane, waterfall, and agent-tree views, plus a **Messages** view of how agents launched, messaged, and read back from each other. |

The session header shows the model, reasoning effort, and whether the prompt cache is warm, expiring, or expired, with a live countdown. **Resume in Terminal** reopens a session in its folder. Sessions can open in pop-out windows and auto-refresh while they run. Rich renderers cover common tool output such as diffs, patches, shell output, search and web-search results, SQL, file trees, `ask_user` prompts, and the agent-control tools (`read_agent`, `write_agent`, `list_agents`).

| Conversation | Agent timeline |
| --- | --- |
| ![Conversation with three agents launched in parallel](docs/images/readme-conversation.png) | ![Agent tree timeline](docs/images/readme-timeline.png) |

| Inter-agent messages | Todos |
| --- | --- |
| ![Sequence diagram of messages between agents](docs/images/readme-agent-messages.png) | ![Todo dependency graph](docs/images/readme-todos.png) |

| Overview | Context |
| --- | --- |
| ![Session overview with headline numbers and turn activity](docs/images/readme-session-overview.png) | ![Context window growth with a compaction](docs/images/readme-context.png) |

### Copilot CLI and Claude Code

Claude Code sessions sit next to Copilot CLI sessions in the library, Conversation, Timeline, Metrics, Context, Search, Analytics, and Export. First-run setup turns them on when it finds Claude Code's folder (`CLAUDE_CONFIG_DIR`, else `~/.claude`); **Settings → Claude Code** changes the folder or turns them off.

- Sessions, Search, and the analytics pages switch between **All**, **Copilot**, and **Claude Code**. Search also takes `source:copilot` and `source:claude`.
- Copilot usage is priced in AI Credits and Claude Code usage in API-equivalent US dollars. With both sources, Analytics and Models total them in USD.
- Launching, the SDK bridge, the config injector, todos, and the skills and agents editors stay Copilot-only.

TracePilot only reads Claude Code's files. Claude Code deletes transcripts older than its `cleanupPeriodDays` setting (30 days by default), and **Settings → Claude Code** can raise it in one click. See [Claude Code sessions](docs/claude-code-sessions.md) for details.

### Search and analyze session history

TracePilot maintains a local SQLite/FTS5 index so you can search across session metadata and conversation content without sending data to a remote service.

Analytics, Tools, and Code share a dashboard of per-day charts, split by source. They help answer questions such as:

- Which repositories, models, and tools are consuming the most time, tokens, or cost?
- How well is the prompt cache working, and how often do sessions resume after it expired?
- How often do tool calls fail, and which tools dominate a session?
- Which files and file types are touched most often?
- How do two sessions compare after normalizing by turns or duration?

Available top-level analysis pages include Search, Analytics, Tools, Code Impact, Model Comparison, and Session Comparison.

| Search | Analytics | Tool analysis |
| --- | --- | --- |
| ![Full-text search across sessions](docs/images/readme-search.png) | ![Analytics dashboard](docs/images/readme-analytics.png) | ![Tool analysis dashboard](docs/images/readme-tool-analysis.png) |

### Understand Copilot CLI agents and skills

- **Agents** lists built-in, personal, and project Copilot CLI agents, plus agents seen only in sessions. Each has run counts, durations, and failure rates, a definition editor, its effective configuration, and `/subagents` model overrides.
- **Skills** creates, edits, and imports Copilot CLI skills (including from GitHub through the `gh` CLI) and shows how often each skill is invoked, by whom, and how many tokens it injects. Unused, dormant, drifted, and shadowed skills are flagged.

| Agents | Skills |
| --- | --- |
| ![Agents explorer with usage](docs/images/readme-agents.png) | ![Skills with usage analytics](docs/images/readme-skills.png) |

### Launch and manage Copilot CLI work

The orchestration pages are for starting and organizing Copilot CLI work from the desktop app:

- **Command Centre** shows repository/session status, recent activity, and system dependency health.
- **Session Launcher** builds Copilot CLI launch commands with repository, branch, model, reasoning effort, prompt, environment, and optional worktree settings.
- **Worktree Manager** discovers registered repositories, creates/removes/prunes worktrees, fetches remotes, opens folders, and launches sessions from worktrees.

| Session Launcher | Worktrees |
| --- | --- |
| ![Session launcher with a prepared launch](docs/images/readme-launcher.png) | ![Worktree manager](docs/images/readme-worktrees.png) |

### Additional features

Settings → Additional Features groups optional surfaces:

- **Recommended:** Skills, Agents, Export, and Prompt Cache Insights are on by default. **Exact Context Capture** is opt-in and adds a CLI Context page that records and compares the exact context a Copilot session sends to the model.
- **Experimental** (off by default, Copilot CLI only):
  - **Copilot SDK Bridge**: steer sessions from TracePilot through the official Copilot SDK, and follow terminal sessions live when they run with `copilot --ui-server` (sessions TracePilot launches get this flag by default).
  - **MCP Servers**: add, import, configure, toggle, and health-check MCP servers compatible with Copilot CLI configuration.
  - **Session Replay**: step through session event timelines using indexed session data.
  - **Config Injector**: edit Copilot CLI agent model assignments and user settings, compare installed CLI versions, and back up or restore config files.

### Export and share sessions

Export sessions as Markdown, TracePilot JSON, or raw session archives, with configurable sections and redaction. Claude Code sessions export as Markdown or JSON, always without account details. Export from a session's header, or use the Export page for bulk export and import.

---

## Screenshots

The README screenshots are generated rather than captured by hand. The
[visual harness](docs/visual-regression.md#readme-screenshots) renders the real
frontend at 1440×960 against a synthetic showcase workspace of fictional
`acme/*` repositories with both Copilot CLI and Claude Code sessions, so the
images contain no personal session data and can be refreshed after any UI change:

```powershell
node scripts/visual/capture.mjs --suite=readme --channel=msedge --docs
```

More views are captured than this page embeds, including
[session metrics](docs/images/readme-metrics.png),
[session files](docs/images/readme-session-explorer.png),
[code impact](docs/images/readme-code-impact.png),
[model comparison](docs/images/readme-model-comparison.png),
[Command Centre](docs/images/readme-orchestration.png), and
[Config Injector](docs/images/readme-config-injector.png).

Browse the [interactive screenshot history](https://mattshelton04.github.io/TracePilot/visual/)
for automated before/after comparisons of PRs and merges, with side-by-side,
wipe, overlay, and highlighted pixel differences. See
[how visual CI works](docs/visual-regression.md).

---

## Install and run

### Prerequisites

- Windows with the WebView2 runtime, or macOS 12+ on Apple Silicon.
- Session history from GitHub Copilot CLI, Claude Code, or both.
- For source builds: Rust, Node.js 22, pnpm 10, and the Tauri 2 prerequisites.
  The exact known-good versions are recorded in `.node-version` and the root
  `packageManager` field.

### Option A: install a Windows build (recommended)

Download the latest build from [GitHub Releases](https://github.com/MattShelton04/TracePilot/releases/latest).

The current release assets include:

| Asset | Use it for |
| --- | --- |
| `TracePilot_<version>_x64-setup.exe` | Recommended installer for most Windows users. |
| `TracePilot_<version>_x64_en-US.msi` | MSI installer for environments that prefer MSI packages. |
| `tracepilot-desktop.exe` | Standalone executable if you do not want to run an installer. |
| `latest.json` and `*.sig` files | Updater metadata and signatures used by the release pipeline. |

The app is not code-signed yet. Windows SmartScreen may warn on first launch; choose **More info** -> **Run anyway** if you trust the build, or build from source instead.

### Option B: install a macOS build (Apple Silicon preview)

Download `TracePilot_<version>_aarch64.dmg` from [GitHub Releases](https://github.com/MattShelton04/TracePilot/releases/latest), open it and drag **TracePilot** into **Applications**. Intel Macs are not supported yet.

The app is not notarized by Apple, so the first time you open it macOS shows **"TracePilot" Not Opened**. Click **Done**, open **System Settings** -> **Privacy & Security**, scroll to the TracePilot message under **Security**, click **Open Anyway** and confirm. This is needed only once: later versions install from inside the app in one click without that prompt. Run TracePilot from Applications rather than from the disk image, or it cannot update itself.

### Option C: run from source

```powershell
git clone https://github.com/MattShelton04/TracePilot.git
cd TracePilot
pnpm start
```

Use this path if you want to develop TracePilot, inspect the code before running it, or avoid unsigned release binaries. `pnpm start` installs workspace dependencies and launches the Tauri desktop app. On first launch, TracePilot guides you through setup and indexes your sessions.

> The terminal may print a Vite localhost URL during development. Use the desktop window for the real app; a normal browser tab does not have access to the Tauri backend.

---

## Architecture

TracePilot is a Rust/TypeScript monorepo:

```text
TracePilot/
├── apps/
│   ├── desktop/                    # Tauri 2 desktop app, Vue 3 frontend
│   └── cli/                        # Experimental TypeScript CLI utilities
├── crates/
│   ├── tracepilot-core/            # Copilot CLI and Claude Code parsing, analytics
│   ├── tracepilot-indexer/         # SQLite + FTS5 indexing and queries
│   ├── tracepilot-export/          # Markdown/JSON/raw exports and imports
│   ├── tracepilot-orchestrator/    # Worktrees, launcher, config injection
│   ├── tracepilot-tauri-bindings/  # Tauri IPC commands and app state
│   ├── tracepilot-bench/           # Criterion benchmarks
│   └── tracepilot-test-support/    # Rust test support utilities
├── packages/
│   ├── client/                     # Typed TypeScript client for Tauri IPC
│   ├── types/                      # Shared TypeScript models/config
│   ├── ui/                         # Shared Vue components and renderers
│   ├── test-utils/                 # Shared frontend test helpers
│   └── config/                     # Shared TS config presets
├── docs/                           # Architecture, design, and developer docs
└── scripts/                        # Build, release, validation, and E2E helpers
```

The main data flow is:

```text
Copilot CLI and Claude Code session files
  -> tracepilot-core parses each source's JSONL/YAML/SQLite session data
  -> tracepilot-indexer stores searchable metadata/content in SQLite FTS5
  -> tracepilot-tauri-bindings exposes typed Tauri commands
  -> @tracepilot/client calls those commands from Vue/Pinia views
```

Useful deeper docs:

- [Architecture overview](docs/architecture/overview.md)
- [Data integration guide](docs/data-integration-guide.md)
- [Claude Code sessions](docs/claude-code-sessions.md)
- [Testing guide](docs/testing.md)
- [On-disk paths](docs/on-disk-paths.md)
- [Performance playbook](docs/performance-playbook.md)
- [Tauri command registration](docs/tauri-command-registration.md)

---

## Development

Install dependencies:

```powershell
pnpm install
```

Common commands:

| Task | Command |
| --- | --- |
| Launch desktop dev app | `pnpm --filter @tracepilot/desktop tauri dev` |
| Launch via convenience script | `pnpm start` |
| Launch real app for agent inspection | `pnpm app:start -Instance <slug> -Fixtures` (or `-RealData`), then `pnpm pw <slug> snapshot` |
| Launch frontend-only automation server | `pnpm app:ui -Instance <slug>` |
| Frontend build/typecheck | `pnpm build` |
| Workspace typecheck | `pnpm typecheck` |
| JS/TS tests | `pnpm test` |
| Rust tests | `cargo test --workspace --exclude tracepilot-desktop` |
| Biome lint | `pnpm lint` |
| Regenerate IPC bindings | `pnpm gen:bindings` |
| Regenerate README screenshots | `node scripts/visual/capture.mjs --suite=readme --channel=msedge --docs` |
| Check docs links | `node scripts/check-doc-links.mjs` |
| Check file-size budgets | `node scripts/check-file-sizes.mjs` |

If you use [`just`](https://github.com/casey/just), `just --list` shows wrappers for the same tasks. `just ci` mirrors the main local CI gate.

See [running-app automation](docs/app-automation.md) for browser-style interaction
with the real Tauri backend, screenshots, traces, and frontend-only exploration.
The [documentation index](docs/README.md) and [script command index](scripts/README.md)
cover the remaining guides and supported developer commands.

### Versioning and releases

The workspace version lives in the root `Cargo.toml`, and `.\scripts\bump-version.ps1 -Version <version>` mirrors it into the package manifests. A release is tagged `v<version>` after its PR merges; the [release guide](docs/releasing.md) has the full checklist.

---

## Roadmap

Current near-term areas:

- Make the Copilot SDK bridge reliable enough to graduate from experimental.
- Improve live-session monitoring and alerting.
- Continue hardening parser coverage as Copilot CLI and Claude Code evolve.
- Bring more Copilot-only tools to Claude Code, and make room for other agent CLIs.
- Polish export/import workflows and team-shareable reports.
- Expand platform validation beyond Windows.

Historical design notes and implementation plans live in [`docs/`](docs/README.md).

---

## License

TracePilot is licensed under the [GNU General Public License v3.0](LICENSE).

You are free to use, modify, and distribute this software under the GPL-3.0. Derivative works and modifications must preserve the same license terms.

---

<p align="center">
  <sub>Built with Rust, Vue, SQLite, and Tauri.</sub>
</p>
