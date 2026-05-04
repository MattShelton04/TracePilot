# @tracepilot/cli

Pure-TypeScript CLI for inspecting Copilot CLI sessions without the Rust
backend. Useful for quick terminal lookups, scripting, and CI.

## Commands

```
tracepilot list                    # List recent sessions
tracepilot show <session-id>       # Show session details, turns, metrics
tracepilot search <query>          # FTS search across indexed sessions
tracepilot index                   # Build / refresh the local search index
tracepilot resume <session-id>     # Print the resume command for a session
tracepilot versions                # Show Copilot CLI version history
tracepilot versions report --from 1.0.24 --to 1.0.40 --output docs\reports\versions\report.md
```

Run `tracepilot <command> --help` for per-command flags.

## Configuration

- `TRACEPILOT_SESSION_STATE_DIR` (or `COPILOT_SESSION_STATE_DIR`) — override
  the Copilot session-state directory. Defaults to `~/.copilot/session-state`.

## Workspace dependencies

- `@tracepilot/types` — shared DTO types.

Runtime deps are kept minimal: `commander`, `chalk`, `better-sqlite3`,
`js-yaml`. The CLI reads Copilot session files directly and queries the same
SQLite index the desktop app uses (see ADR
[0003 — SQLite WAL, per-feature databases](../../docs/adr/0003-sqlite-wal-per-feature-databases.md)).

## Layout

- `src/index.ts` — Commander root; registers every command module.
- `src/commands/` — one file per command (`list`, `show`, `search`,
  `index-cmd`, `resume`, `versions`, shared `utils.ts`).
- `src/lib/session-path.ts` — resolves the session-state directory.
- `src/lib/version-analyzer.ts` — Copilot CLI version detection.
- `src/utils/errorHandler.ts` — top-level error reporting.
- `src/__tests__/` — Vitest suites.

## Development

```bash
pnpm --filter @tracepilot/cli dev -- list
pnpm --filter @tracepilot/cli dev -- show c86fe369
pnpm --filter @tracepilot/cli test
pnpm --filter @tracepilot/cli build          # emits dist/ for the npm bin
```
