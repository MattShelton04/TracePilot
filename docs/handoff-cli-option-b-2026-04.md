# Hand-off — CLI "Option B" Rewrite (Rust-backed CLI)

**Status:** Deferred from the April-2026 tech-debt cycle (was planned as waves
w118–w120). Not started. This document captures the intent, scope, and
acceptance criteria so a future engineer can pick it up cleanly.

## Why

Today the `tracepilot` CLI (`apps/cli` / `packages/cli`) duplicates session
discovery, event reconstruction, and search logic in TypeScript that already
exists in `crates/tracepilot-core` and `crates/tracepilot-indexer`. The two
implementations drift, and the TS copy is the one most likely to regress
silently because the desktop app doesn't exercise it.

Option B eliminates the duplication by promoting the Rust crates to a
public JSON-emitting binary and rewriting the CLI as a thin spawner.

## Goal

- CLI commands that currently walk the filesystem / parse JSONL / build search
  indexes in TypeScript instead shell out to a Rust binary and consume its
  JSON output.
- Single source of truth for session semantics lives in Rust.
- The TypeScript CLI package becomes small: argument parsing, formatting,
  spawning. No domain logic.

## Proposed scope

### w118 — `tracepilot-core --json` subcommand(s)
- New binary target (or extend `tracepilot-indexer`) exposing:
  - `sessions list [--project <id>]` → JSON array
  - `sessions show <id>` → JSON object (summary + metadata)
  - `search --query <q> [...filters]` → JSON result page
  - `events <session-id>` → JSON stream (one line per event)
- Stable JSON schema committed to the repo (e.g. `crates/<crate>/schemas/`)
  so future breakage is caught by tests.
- All paths validated via existing validators (`SessionId`, path-jail).
- Respect `TRACEPILOT_HOME` / config discovery identical to desktop.

### w119 — CLI TS wrapper rewrite
- Replace TS discovery/reconstruction/search with `spawnSync(binary, args)`
  wrappers under `packages/cli/src/rust/`.
- Delete duplicate TS modules once every caller migrated.
- Fix the path-separator assumptions that currently break Windows tests.
- Consume `TracePilotConfig` from `session-path.ts` directly (instead of
  reading env vars).
- Delete the `index` stub and the shell-echo `resume` command.
- Remove any checked-in `dist/` directories.

### w120 — Test parity
- Port existing CLI tests to the new spawning layer, or mock the Rust binary
  via a fake executable.
- Add golden-file tests for each JSON command to lock the schema.
- Cross-platform CI pass (Windows/macOS/Linux) so we don't regress path handling.

## Acceptance criteria

- `packages/cli/src/**` has no session discovery / reconstruction / search
  logic remaining; `rg "readdir|JSONL|walk"` returns zero non-test hits in
  that tree.
- `tracepilot-core --json sessions list | jq` works on a fresh clone.
- CLI tests pass on Windows, macOS, Linux.
- Existing CLI users see the same command surface and human-readable output.

## Open questions

1. Distribute the Rust binary *with* the npm package (`optionalDependencies`
   per-arch, like esbuild) or expect the desktop app to provide it?
2. Should the JSON subcommand live on `tracepilot-core` or a dedicated
   `tracepilot-cli-core` binary to keep startup time low?
3. Streaming vs buffered output for `events` / `search` — pick one.

## References

- Original plan bullet: `docs/tech-debt-master-plan-2026-04.md` (w118-w120)
- Existing TS duplicates to delete: `packages/cli/src/sessions/`, `packages/cli/src/search/`
- Rust counterparts: `crates/tracepilot-core/src/session/`, `crates/tracepilot-indexer/`
