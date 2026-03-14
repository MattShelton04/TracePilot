# TracePilot

**Visualize, audit, and inspect GitHub Copilot CLI sessions.**

TracePilot reads the session data stored by GitHub Copilot CLI at `~/.copilot/session-state/` and provides both a desktop GUI and a terminal CLI for exploring sessions, viewing conversation turns, analyzing tool usage, and reviewing cost metrics.

## Features (Planned)

- 📋 **Session List** — browse all Copilot CLI sessions with summaries, repos, and timestamps
- 🔍 **Full-Text Search** — search sessions by content, repo name, or branch (FTS5-powered)
- 💬 **Conversation View** — see user ↔ assistant turns with tool calls inline
- 📊 **Analytics** — token usage, model distribution, session duration, code changes
- 🩺 **Health Scoring** — detect anomalies like missing shutdowns or high error rates
- 📤 **Export** — Markdown, JSON, or CSV with optional secret redaction
- 🔄 **Resume Helper** — quickly resume past sessions from the CLI

## Architecture

```
tracepilot/
├── apps/
│   ├── desktop/        # Tauri + React desktop app
│   └── cli/            # Node.js CLI (tracepilot list, show, search)
├── crates/
│   ├── tracepilot-core/          # Session parsing, models, health
│   ├── tracepilot-indexer/       # Local index DB with FTS5
│   ├── tracepilot-export/        # Export & redaction
│   └── tracepilot-tauri-bindings/  # Tauri IPC bridge
└── packages/
    ├── ui/             # Shared React components
    ├── types/          # Shared TypeScript types
    ├── client/         # Tauri invoke wrapper
    └── config/         # Shared TS/ESLint config
```

## Quick Start

### Prerequisites

- [Rust](https://rustup.rs/) (1.75+)
- [Node.js](https://nodejs.org/) (20+)
- [pnpm](https://pnpm.io/) (9+)
- GitHub Copilot CLI with some session history in `~/.copilot/session-state/`

### CLI (works now)

```bash
# Install dependencies
pnpm install

# List your sessions
pnpm --filter @tracepilot/cli dev -- list

# Show a specific session (partial ID match)
pnpm --filter @tracepilot/cli dev -- show c86fe369
```

### Desktop App (requires Tauri prerequisites)

```bash
# Install dependencies
pnpm install

# Development mode
pnpm --filter @tracepilot/desktop tauri dev
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
