# TracePilot CLI - Development Readme

A pure TypeScript CLI for inspecting Copilot CLI sessions, runnable without the Rust backend.

## Commands

```
tracepilot list                   # List all sessions
tracepilot show <session-id>      # Show session details
tracepilot search <query>         # Search sessions by content, repo, branch
tracepilot resume <session-id>    # Print command to resume a session
tracepilot index                  # Rebuild the session search index
tracepilot versions list          # List installed Copilot CLI versions
tracepilot versions diff [v1] [v2]    # Show schema differences between versions
tracepilot versions coverage      # Show TracePilot event type coverage
tracepilot versions report        # Generate comprehensive version analysis report
tracepilot versions examples      # Find real session examples of event types
```

## Development

```bash
pnpm --filter @tracepilot/cli dev -- list
pnpm --filter @tracepilot/cli dev -- show c86fe369
pnpm --filter @tracepilot/cli dev -- search "authentication"
pnpm --filter @tracepilot/cli dev -- resume c86fe369
pnpm --filter @tracepilot/cli dev -- index --full
```
