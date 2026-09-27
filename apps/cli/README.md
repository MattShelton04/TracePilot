# @tracepilot/cli

Pure-TypeScript CLI for inspecting Copilot CLI sessions without the Rust
backend. Useful for quick terminal lookups, scripting, and CI.

## Commands

```
tracepilot list                    # List recent sessions
tracepilot show <session-id>       # Show session details, turns, metrics
tracepilot search <query>          # Scan session metadata and event text
tracepilot index                   # Unsupported; exits nonzero with guidance
tracepilot resume <session-id>     # Print the resume command for a session
tracepilot versions                # Show Copilot CLI version history
tracepilot versions report --from 1.0.24 --to 1.0.40 --output docs\reports\versions\report.md
```

Run `tracepilot <command> --help` for per-command flags.

## Configuration

- `TRACEPILOT_SESSION_STATE_DIR` (or `COPILOT_SESSION_STATE_DIR`) — override
  the Copilot session-state directory. Defaults to `~/.copilot/session-state`.
- `TRACEPILOT_COPILOT_PKG_DIR` — optional directory containing version folders
  such as `1.0.71/schemas/`. Use it to compare archived official packages without
  modifying Copilot's rolling installation cache.

## Workspace dependencies

- `@tracepilot/types` — shared DTOs and event coverage list, bundled into the built CLI.

Runtime deps are kept minimal: `commander`, `chalk`, `better-sqlite3`, and
`yaml`. The CLI reads Copilot session files directly. `search` scans each
session's `workspace.yaml` and `events.jsonl`, returning at most one hit per
session. It does not query the desktop SQLite index. The `index` command is
reserved for future integration and exits with status 1; rebuild the index in
TracePilot desktop.

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
node apps/cli/dist/index.js --help           # smoke-test the built entry
```
