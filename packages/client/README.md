# @tracepilot/client

TypeScript wrapper over the TracePilot Tauri IPC surface. Every frontend Rust
command is fronted by a typed async function here; call sites in `apps/desktop`
and `apps/cli` import from this package instead of calling `invoke()` directly.

See ADR [0002 — IPC contract via specta-generated bindings](../../docs/adr/0002-ipc-contract-specta-bindings.md)
for the contract and drift-detection strategy.

## Public API

The barrel at `src/index.ts` re-exports every public symbol. Major groups:

| Module                    | Purpose                                                   |
| ------------------------- | --------------------------------------------------------- |
| `sessions`                | `listSessions`, `getSessionDetail`, turns, events, todos  |
| `search`                  | FTS search, indexing progress, facets, stats              |
| `analytics`               | Analytics data, tool usage, code impact                   |
| `config`                  | App-config read/write, agent definitions, backups         |
| `orchestration`           | Worktrees, repo registry, launcher, system deps           |
| `mcp`                     | MCP server config, health, diffs                          |
| `skills` / `tasks`        | Skill imports, task orchestrator state                    |
| `sdk`                     | Copilot SDK bridge connect / status / quota               |
| `export` / `maint`        | Export session archives, maintenance (prune, vacuum)      |
| `events`                  | `IPC_EVENTS` event-name constants and `IpcEventName` type |
| `commands`                | `IPC_COMMANDS` command-name constants, `CommandName`      |
| `invoke`                  | `isTauri`, perf-tracing helpers, `InvokeFn` type          |
| `generated/bindings`      | Specta-generated DTO re-exports (do not edit by hand)     |

## Usage

```ts
import { listSessions, getSessionDetail } from "@tracepilot/client";

const sessions = await listSessions({ limit: 50, hideEmpty: true });
const detail = await getSessionDetail(sessions[0].id);
```

In non-Tauri contexts (unit tests, `pnpm --filter @tracepilot/cli dev`) each
module falls back to the mock data in `src/mock/` so call sites work without a
backend.

## Workspace dependencies

- `@tracepilot/types` — shared DTO and enum types.
- `@tauri-apps/api` (runtime) — only loaded when `isTauri()` is true.

## Layout

- `src/index.ts` — public barrel; every exported name must remain stable.
- `src/<domain>.ts` — one file per IPC domain (sessions, search, …).
- `src/internal/` — `core.ts` (invoke wrapper + error mapping), `mockData.ts`,
  `optional.ts` (Rust `Option<T>` mapping helpers).
- `src/generated/bindings.ts` — DO NOT EDIT. Regenerated from
  `tracepilot-tauri-bindings` via specta.
- `src/generated/ipc-commands.json` — canonical command-name list; drift-checked
  against `commands.ts` in `__tests__/generated.drift.test.ts`.
- `src/mock/` — mock-mode payloads used when running outside Tauri.

## Scripts

```bash
pnpm --filter @tracepilot/client typecheck
pnpm --filter @tracepilot/client test
```
