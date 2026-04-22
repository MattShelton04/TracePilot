# TracePilot Architecture Overview

TracePilot is a desktop application for visualising, searching, and analysing GitHub Copilot CLI sessions. It is built with **Tauri 2** (Rust backend) and **Vue 3 + TypeScript** (frontend).

## Repository Structure

```
TracePilot/
├── apps/
│   ├── desktop/          # Tauri desktop app (Vue 3 SPA + Rust backend)
│   └── cli/              # CLI tool for terminal-based session inspection
├── crates/
│   ├── tracepilot-core/          # Session parsing, modelling, analytics
│   ├── tracepilot-indexer/       # FTS search index (SQLite + FTS5)
│   ├── tracepilot-orchestrator/  # Worktree orchestration, launcher, config
│   ├── tracepilot-export/        # Session export (Markdown/JSON/CSV)
│   ├── tracepilot-tauri-bindings/# Tauri IPC command bridge
│   └── tracepilot-bench/         # Benchmarks and synthetic data generators
├── packages/
│   ├── ui/               # Shared Vue component library
│   ├── client/           # TypeScript client for Tauri commands
│   ├── types/            # Shared TypeScript types
│   └── config/           # Shared configuration presets
├── docs/                 # Documentation (see docs/README.md)
└── scripts/              # Build and release scripts
```

## Rust Crates

### tracepilot-core

The foundational crate. Parses Copilot session JSONL files into a structured turn-based model. Provides:

- **Session model**: `Turn`, `Event`, `ToolCall`, `ToolResult`, `Message` types
- **Analytics**: Token counts, tool usage stats, timing analysis, code impact metrics
- **Utilities**: Path helpers (`home_dir`, `home_dir_opt`), formatting, schema version detection

### tracepilot-indexer

Maintains a local SQLite database with FTS5 full-text search across all indexed sessions. Features:

- **Two-phase indexing**: Phase 1 upserts session metadata, Phase 2 extracts searchable content
- **WAL mode** with busy timeout for concurrent read/write safety
- **Search semaphore** to prevent overlapping index rebuilds

### tracepilot-orchestrator

Manages the lifecycle of Copilot CLI sessions:

- **Launcher**: Starts Copilot CLI processes with correct environment and config injection
- **Repo registry**: Discovers and tracks git repositories
- **Templates**: Pre-built session templates with customisable prompts
- **Version management**: Copilot CLI version detection and schema analysis

### tracepilot-export

Exports sessions to portable formats (Markdown, JSON, CSV) with optional secret redaction. Currently scaffolded.

### tracepilot-tauri-bindings

The IPC bridge layer. Exposes 78 Tauri commands that the frontend calls. Responsibilities:

- Translates frontend requests into core/indexer/orchestrator calls
- Manages shared application state (`AppState` with `Mutex`-protected fields)
- Handles configuration (load, save, migrate) via `TracePilotConfig`
- Provides lock-poison recovery on all `Mutex` accesses

### tracepilot-bench

Criterion benchmarks and synthetic session generators for performance testing.

## Frontend Packages

### @tracepilot/desktop

The Tauri desktop app. Key directories:

```
apps/desktop/
├── src/
│   ├── views/            # Route-level views (SessionList, SessionDetail, Analytics, etc.)
│   ├── components/       # App-specific components (SearchPalette, AgentTree, etc.)
│   ├── stores/           # Pinia stores (sessions, sessionDetail, search, analytics)
│   ├── router/           # Vue Router configuration
│   └── styles/           # Global CSS (themes, chart styles)
├── src-tauri/
│   ├── src/              # Rust entry point (main.rs)
│   ├── capabilities/     # Tauri permission capabilities
│   └── tauri.conf.json   # Tauri config (CSP, window, updater)
```

### @tracepilot/ui

Shared Vue component library used by the desktop app. Contains:

- **Components**: `TabNav`, `ErrorState`, `FormInput`, `MarkdownContent`, etc.
- **Composables**: `useChartTooltip`, `useFormValidation`, `useExportSession`
- **Utilities**: `formatters.ts` (dates, durations, sizes), `contentTypes.ts`, `pathUtils.ts`

### @tracepilot/client

TypeScript wrapper around `@tauri-apps/api/core.invoke()` that provides typed function signatures for all 78 Tauri commands.

### @tracepilot/types

Shared TypeScript interfaces and types mirroring the Rust data model.

### @tracepilot/config

Shared configuration presets (Vite, TypeScript, Vitest base configs).

## Data Flow

```
 Disk (JSONL files)
       │
       ▼
 tracepilot-core          ← Parses sessions into Turn/Event model
       │
       ├──► tracepilot-indexer    ← Indexes into SQLite FTS5 for search
       │
       └──► tracepilot-export    ← Exports to MD/JSON/CSV
       │
 tracepilot-orchestrator  ← Launches sessions, manages repos/worktrees
       │
       ▼
 tracepilot-tauri-bindings ← IPC bridge (78 commands)
       │
       ▼
 @tracepilot/client        ← TypeScript invoke wrappers
       │
       ▼
 @tracepilot/desktop       ← Vue 3 SPA (Pinia stores → Views → Components)
```

## Key Design Decisions

### Lock-Poison Recovery
All `Mutex` accesses in Tauri bindings use `lock().unwrap_or_else(|e| e.into_inner())` to recover from poisoned locks rather than panicking.

### Two-Phase Indexing
Session indexing is split into metadata upsert (fast, synchronous) and content extraction (heavier, semaphore-gated) to avoid blocking the UI during bulk operations.

### Centralised Home Directory
A single `home_dir_opt()` helper in `tracepilot-core::utils` resolves `USERPROFILE` (Windows) or `HOME` (Unix), used by all crates that need the Copilot home path.

### Content Security Policy
The Tauri webview runs with a restrictive CSP:

- `default-src 'self'` — only app-bundled resources by default.
- `script-src 'self'` — no inline scripts, no `eval`; Vite emits module scripts only.
- `script-src-attr 'none'` — blocks inline event handlers (`onclick=`, etc.).
- `style-src 'self' 'unsafe-inline'` — `'unsafe-inline'` retained because Vue's reactive `:style` bindings emit inline `style=` attributes at runtime. Tracked for removal by w91 (inline-style sweep) + w108 follow-up.
- `img-src 'self' data:`, `font-src 'self' data:` — local assets + base64 data URIs.
- `connect-src 'self' https://github.com https://api.github.com` — Tauri IPC + GitHub API for the updater.
- `object-src 'none'`, `frame-src 'none'`, `frame-ancestors 'none'` — no plugins, no embedded frames, and the app cannot be framed by other origins.
- `base-uri 'self'`, `form-action 'self'`, `worker-src 'self'` — pin base URL, restrict form submissions, and scope worker sources.

### Capability Trimming
Tauri plugin permissions are set to minimum required (e.g., `dialog:allow-open`, `dialog:allow-save`) rather than using broad defaults.

## Testing

| Layer | Command | Tests |
|-------|---------|-------|
| Rust (all crates) | `cargo test --workspace --exclude tracepilot-desktop --exclude tracepilot-bench` | ~250 |
| Desktop (Vitest) | `pnpm --filter @tracepilot/desktop test` | ~245 |
| UI (Vitest) | `pnpm --filter @tracepilot/ui test` | ~450 |
| Typecheck | `pnpm typecheck` | — |

## Build

```bash
# Development
pnpm install
cargo tauri dev

# Production
cargo tauri build
```
