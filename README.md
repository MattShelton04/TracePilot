# TracePilot

**Visualize, audit, and inspect GitHub Copilot CLI sessions.**

TracePilot reads the session data stored by GitHub Copilot CLI at `~/.copilot/session-state/` and provides both a desktop GUI and a terminal CLI for exploring sessions, viewing conversation turns, analyzing tool usage, and reviewing cost metrics.

## Features

### Working Now (Phase 1 ✅)
- 📋 **Session List** — browse all Copilot CLI sessions with summaries, repos, and timestamps
- 🔍 **Search** — search sessions by content, repo name, or branch
- 💬 **Conversation View** — see user ↔ assistant turns with tool calls inline (`show --turns`)
- 📊 **Metrics** — token usage, model distribution, code changes (`show --metrics`)
- ✅ **Todos** — view session todo items and dependencies (`show --todos`)
- 🔄 **Resume Helper** — quickly resume past sessions (`resume <id>`)
- 📝 **JSON Output** — machine-readable output for all commands (`--json`)

### In Progress (Phase 2)
- 🖥️ **Desktop App** — Tauri + Vue 3 session explorer with rich UI

### Planned
- 📊 **Analytics Dashboard** — visual metrics and usage patterns
- 🩺 **Health Scoring** — detect anomalies like missing shutdowns or high error rates
- 📤 **Export** — Markdown, JSON, or CSV with optional secret redaction
- 🔄 **Session Replay** — step-through conversation replay with timeline scrubber

## Architecture

```
tracepilot/
├── apps/
│   ├── desktop/        # Tauri + Vue 3 desktop app
│   └── cli/            # Node.js CLI (tracepilot list, show, search)
├── crates/
│   ├── tracepilot-core/          # Session parsing, models, health
│   ├── tracepilot-indexer/       # Local index DB with FTS5
│   ├── tracepilot-export/        # Export & redaction
│   └── tracepilot-tauri-bindings/  # Tauri IPC bridge
└── packages/
    ├── ui/             # Shared Vue components
    ├── types/          # Shared TypeScript types
    ├── client/         # Tauri invoke wrapper (framework-agnostic)
    └── config/         # Shared TS/ESLint config
```

## Quick Start

### Prerequisites

- [Rust](https://rustup.rs/) (1.85+)
- [Node.js](https://nodejs.org/) (20+)
- [pnpm](https://pnpm.io/) (9+)
- GitHub Copilot CLI with some session history in `~/.copilot/session-state/`

### CLI

```bash
# Install dependencies
pnpm install

# List your sessions
pnpm --filter @tracepilot/cli dev -- list
pnpm --filter @tracepilot/cli dev -- list --limit 5 --json
pnpm --filter @tracepilot/cli dev -- list --repo org/myrepo

# Show a specific session (partial ID match)
pnpm --filter @tracepilot/cli dev -- show c86fe369
pnpm --filter @tracepilot/cli dev -- show c86fe369 --turns
pnpm --filter @tracepilot/cli dev -- show c86fe369 --metrics
pnpm --filter @tracepilot/cli dev -- show c86fe369 --todos
pnpm --filter @tracepilot/cli dev -- show c86fe369 --json

# Search sessions
pnpm --filter @tracepilot/cli dev -- search "login feature"

# Resume a session
pnpm --filter @tracepilot/cli dev -- resume c86fe369

# Build for standalone use
pnpm --filter @tracepilot/cli build
node apps/cli/dist/index.js list
```

### Desktop App (requires Tauri prerequisites)

```bash
# Install dependencies
pnpm install

# Development mode (opens Tauri window + Vite HMR)
pnpm tauri dev

# Or just the Vite frontend (mock data, no Rust backend)
pnpm dev
```

### Rust Crates

```bash
# Build all Rust crates
cargo build

# Run tests
cargo test
```

## Session Data Format

TracePilot reads Copilot CLI session data from `~/.copilot/session-state/{UUID}/`:

| File | Description |
|------|-------------|
| `workspace.yaml` | Session metadata: id, repo, branch, summary, timestamps |
| `events.jsonl` | Line-delimited JSON event log (17 event types) |
| `session.db` | SQLite database with todos and custom tables |
| `plan.md` | Session plan in Markdown |
| `checkpoints/` | Compaction summaries |
| `rewind-snapshots/` | Git state snapshots per user message |

## Development

This is a monorepo managed with **pnpm workspaces** (TypeScript) and **Cargo workspaces** (Rust).

```bash
# Build order for first time:
cargo build                          # 1. Rust crates
pnpm install                         # 2. Node dependencies
pnpm --filter @tracepilot/cli dev    # 3. Test CLI
```

## License

MIT
