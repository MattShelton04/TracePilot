# TracePilot: Visualize, audit, and inspect GitHub Copilot CLI sessions

TracePilot reads the session data stored by GitHub Copilot CLI at `~/.copilot/session-state/` and provides both a desktop GUI and a terminal CLI for exploring sessions, viewing conversation turns, analyzing tool usage, and reviewing cost metrics.

## Features

### Working Now (Phase 1 & 2 ✅)

#### CLI Tool
- 📋 **Session List** — browse all Copilot CLI sessions with summaries, repos, and timestamps
- 🔍 **Search** — search sessions by content, repo name, or branch (`tracepilot search`)
- 💬 **Conversation View** — see user ↔ assistant turns with tool calls inline (`tracepilot show <id>`)
- 📝 **JSON Output** — machine-readable output for all commands (`--json`)

#### Desktop App (Tauri)
- 🖥️ **Session Explorer** — sidebar-driven GUI with search, filters (repo/branch), and sorting
- 💬 **Conversation Viewer** — turn-by-turn display with collapsible tool calls
- 📊 **Metrics Dashboard** — model usage breakdown, token distribution bars, and cost estimates
- ⚡ **Events Browser** — raw event log with type filtering and pagination
- ✅ **Todo Tracker** — visual progress bar and dependency display
- 🔍 **Full-Text Search** — instant search across all sessions via SQLite FTS5 index
- 🎨 **GitHub Primer Design** — dark + light themes, 40+ CSS variables, responsive from 375px to 4K
- ♿ **Accessible** — ARIA attributes, keyboard navigation, screen reader support

#### Shared Core
- 📦 **UI Library** — reusable Vue 3 components (@tracepilot/ui): Badge, SessionCard, TabNav, StatCard, SearchInput, FilterSelect, StatusIcon
- 🦀 **Rust Core** — high-performance parsing, indexing, and analysis
- 🧪 **Test Suite** — 39 Rust tests + 34 Vue component tests

### Planned (Phase 3-7)
- 📊 **Analytics Dashboard** — visual metrics and usage patterns across time
- 🩺 **Health Scoring** — detect anomalies like missing shutdowns or high error rates
- 📤 **Export** — Markdown, JSON, or CSV with optional secret redaction
- 🔄 **Session Replay** — step-through conversation replay with timeline scrubber

## Architecture

TracePilot is a monorepo structured as follows:

```
tracepilot/
├── apps/
│   ├── cli/            # Node.js CLI tool (Commander.js + tsx)
│   └── desktop/        # Tauri 2 desktop app (Vue 3 + Tailwind CSS v4)
├── crates/
│   ├── tracepilot-core/          # Rust core parsing library (models, parsing, logic)
│   ├── tracepilot-indexer/       # SQLite FTS5 search index & migrations
│   └── tracepilot-tauri-bindings/# Tauri IPC command layer & state management
└── packages/
    ├── client/         # TypeScript client (Tauri invoke wrappers + mock fallback)
    ├── types/          # Shared TypeScript type definitions
    ├── ui/             # Shared Vue 3 component library
    └── config/         # Shared TS/ESLint config
```

## Getting Started

### Prerequisites
- [Rust](https://rustup.rs/) (1.85+)
- [Node.js](https://nodejs.org/) (22+)
- [pnpm](https://pnpm.io/) (9+)
- GitHub Copilot CLI with some session history in `~/.copilot/session-state/`

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/tracepilot.git
cd tracepilot

# Install dependencies
pnpm install

# Build Rust crates
cargo build
```

### Running the Apps

#### Desktop App
```bash
# Run in development mode (hot reload)
pnpm tauri dev

# Run frontend only (mock data, no Rust backend)
pnpm dev
```

#### CLI Tool
```bash
# Run via pnpm filter
pnpm --filter @tracepilot/cli dev -- list

# Build and run standalone
pnpm --filter @tracepilot/cli build
node apps/cli/dist/index.js list
```

## Development

This project uses **pnpm workspaces** for TypeScript and **Cargo workspaces** for Rust.

### Testing
```bash
# Run Rust tests (Core & Indexer)
cargo test

# Run Vue component tests
pnpm --filter @tracepilot/ui test
```

## Phase Status

- **Phase 1: Core Parsing & CLI MVP** — ✅ Complete
- **Phase 2: Desktop App — Session Explorer** — ✅ Complete
- **Phase 3: Analytics & Visualization** — 📅 Planned
- **Phase 4: Health Scoring** — 📅 Planned
- **Phase 5: Export & Sharing** — 📅 Planned
- **Phase 6: Advanced Features** — 📅 Planned
- **Phase 7: Distribution** — 📅 Planned

## License

MIT
