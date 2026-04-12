# TracePilot CLI - Development Readme

A pure TypeScript CLI for inspecting Copilot CLI sessions, runnable without the Rust backend.

## Commands

```
tracepilot list                  # List all sessions
tracepilot show <session-id>     # Show session details  
tracepilot search <query>        # Search sessions (coming soon)
```

## Configuration

- Set `TRACEPILOT_SESSION_STATE_DIR` (or `COPILOT_SESSION_STATE_DIR`) to override the Copilot session-state directory. Defaults to `~/.copilot/session-state`.

## Development

```bash
pnpm --filter @tracepilot/cli dev -- list
pnpm --filter @tracepilot/cli dev -- show c86fe369
```
