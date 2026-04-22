# Specta / tauri-specta migration guide

> Phase 1B.1 pilot status: **🟡 PARTIAL (wave 98)** — codegen infrastructure
> landed in wave 8; additional session-listing DTOs were migrated in wave
> 21; wave 98 added the state/system subsystem (update + git + DB-size +
> session-count + install-type + validate-session-dir). The bulk of the
> Rust ↔ TS contract is still hand-maintained in `packages/types/` and
> `packages/client/src/commands.ts`. This guide is the playbook for
> expanding coverage in subsequent waves.

## What landed in this wave

### Infrastructure

- **Workspace deps** (`Cargo.toml`): `specta =2.0.0-rc.24`,
  `tauri-specta =2.0.0-rc.24`, `specta-typescript =0.0.11`. Pinned to an
  exact trio per upstream release notes — bump all three together.
- **`tracepilot-tauri-bindings`** now depends on `specta` (derive),
  `tauri-specta` (derive + typescript) and `specta-typescript`, plus a
  `build.rs` that embeds a Windows Common-Controls v6 manifest
  (`embed-manifest` build-dep) so the codegen binary can launch against
  tauri's comctl32 imports.
- **`tracepilot-orchestrator`** picks up `specta = { workspace = true, features = ["derive"] }`
  so the pilot DTO living there can derive `specta::Type`.
- **Codegen binary** at
  `crates/tracepilot-tauri-bindings/src/bin/gen-bindings.rs` (thin shim)
  + `crates/tracepilot-tauri-bindings/src/specta_exports.rs` (holds the
  `tauri_specta::Builder`). The actual `collect_commands!` invocation
  lives **inside the lib crate** because `#[specta::specta]` generates
  hidden per-command macros that can only be resolved from within the
  defining crate.
- **npm script**: `pnpm gen:bindings` wraps
  `cargo run -p tracepilot-tauri-bindings --bin gen-bindings`.
- **Generated output**: checked in at
  `packages/client/src/generated/bindings.ts` (with a `DO NOT EDIT`
  header). CI should fail if the file is stale — see the CI
  recommendation at the bottom.

### Pilot allow-list

Three Rust surfaces are emitted to `bindings.ts`:

| Rust symbol | Location | Annotation |
| --- | --- | --- |
| `ErrorCode` enum | `crates/tracepilot-tauri-bindings/src/error.rs` | `#[derive(serde::Serialize, specta::Type)]` + `#[serde(rename_all = "SCREAMING_SNAKE_CASE")]` |
| `BridgeMetricsSnapshot` struct | `crates/tracepilot-orchestrator/src/bridge/manager.rs` | `#[derive(..., specta::Type)]` (keeps existing `#[serde(rename_all = "camelCase")]`) |
| `sdk_bridge_metrics` command | `crates/tracepilot-tauri-bindings/src/commands/sdk.rs` | `#[tauri::command]` + `#[specta::specta]` |

### Generated as of wave 21 (session-listing batch)

Annotated additively without touching the runtime `tauri::generate_handler!`
registry. These DTOs + commands now round-trip through specta:

| Rust symbol | Location | Notes |
| --- | --- | --- |
| `SessionListItem` struct | `crates/tracepilot-tauri-bindings/src/types.rs` | `#[derive(..., specta::Type)]`; hand-written mirror in `packages/types/src/session.ts` was fixed to include `cwd?: string \| null` (the Rust wire format always emitted it) |
| `FreshnessResponse` struct | `crates/tracepilot-tauri-bindings/src/types.rs` | `#[derive(..., specta::Type)]`; mirror at `packages/types/src/conversation.ts` |
| `list_sessions` command | `crates/tracepilot-tauri-bindings/src/commands/session.rs` | `#[specta::specta]` |
| `check_session_freshness` command | `crates/tracepilot-tauri-bindings/src/commands/session.rs` | `#[specta::specta]` |

Drift between generated + hand-written is caught at compile-time by
`packages/client/src/__tests__/generated.drift.test.ts`.

**Running totals:** 3 types + 3 commands in the allow-list (was 2 + 1).

### Generated as of wave 98 (state/system batch)

Annotated additively without touching the runtime `tauri::generate_handler!`
registry. These DTOs + commands now round-trip through specta, and the
hand-written mirrors in `packages/types/src/config.ts` have been deleted
outright (consumers import the generated shapes from `@tracepilot/client`):

| Rust symbol | Location | Notes |
| --- | --- | --- |
| `UpdateCheckResult` struct | `crates/tracepilot-tauri-bindings/src/types.rs` | `#[derive(..., specta::Type)]` |
| `GitInfo` struct | `crates/tracepilot-tauri-bindings/src/types.rs` | `#[derive(..., specta::Type)]` |
| `ValidateSessionDirResult` struct | `crates/tracepilot-tauri-bindings/src/types.rs` | `#[derive(..., specta::Type)]`; hand-written mirror's `error?: string` is now `error: string \| null` (generated form). The `if (result.error)` truthy check in `SetupWizard.vue` works identically with either shape. |
| `get_db_size` command | `crates/tracepilot-tauri-bindings/src/commands/state.rs` | `#[specta::specta]` |
| `get_session_count` command | same | `#[specta::specta]` |
| `is_session_running` command | same | `#[specta::specta]` (attribute **after** `#[tracing::instrument(..., fields(%session_id))]` — see troubleshooting) |
| `get_install_type` command | same | `#[specta::specta]` on a sync fn |
| `check_for_updates` command | same | `#[specta::specta]` |
| `get_git_info` command | same | `#[specta::specta]` |
| `validate_session_dir` command | `crates/tracepilot-tauri-bindings/src/commands/config_cmds.rs` | `#[specta::specta]` (co-located DTO lives in `types.rs`) |

Wire-format check: `git diff packages/client/src/generated/bindings.ts`
before committing. For this wave, no existing generated line changed —
commands + types were appended only.

**Running totals:** 6 types + 10 commands in the allow-list (was 3 + 3).

#### DTOs needing per-field overrides (deferred)

| DTO | Reason deferred |
| --- | --- |
| `SessionIncidentItem` | `detail_json: Option<serde_json::Value>`. Enabling the `specta` `serde_json` feature emits a tagged `Value` union (`{ Null } \| { Bool: bool } \| …`), which does not match the wire format (arbitrary JSON) nor the hand-written `unknown`. Needs a forwarding `impl specta::Type` (similar to `BindingsError`) that maps `serde_json::Value` to TS `unknown` / `any`. Tackle in a follow-up wave alongside `EventItem` (same shape concern). |
| `TurnsResponse`, `EventsResponse`, `TodosResponse`, `SessionSummary`, `ConversationTurn` | Transitively pull in large graphs from `tracepilot-core` (`ConversationTurn`, `TypedEvent`, `TodoItem`, `TodoDep`, `SessionSummary`, …). Cascading specta annotation on `tracepilot-core` is its own wave. |

The generated `ErrorCode` union matches the strings consumed by
`apps/desktop/src/utils/backendErrors.ts` exactly (`"IO" | "TAURI" | … |
"ALREADY_INDEXING" | "VALIDATION"`), which is the main purpose of
including it: it's now a structural contract rather than an ad-hoc
string match.

### What is deliberately NOT changed

- `tauri::generate_handler![...]` in `lib.rs::init()` remains the runtime
  command registry. The `tauri_specta::Builder` is **only** used to drive
  codegen; it is not wired into plugin init.
- Every hand-maintained mirror in `packages/types/src/*.ts` stays as-is.
- Every hand-maintained entry in `packages/client/src/commands.ts` stays
  as-is.
- No other commands or DTOs have been annotated. The pilot is a
  foothold, not a sweep.

### API deviations worth noting

The original plan sketch assumed `#[specta(rename_all = "...")]` on
enums, but specta 2.0.0-rc.24 has removed the attribute from
container-level in favour of piggy-backing on `#[serde(rename_all)]`.
We therefore had to add a `serde::Serialize` derive to `ErrorCode` so
the attribute actually does something; the derived `Serialize` is
*never* called at runtime (the manual `impl Serialize for BindingsError`
in the same file only reads `ErrorCode::as_str()`), so the wire format
is unchanged.

Specta cannot auto-derive `Type` for `BindingsError` because several
`#[from]`-wrapped variants reference foreign error types that don't
implement `specta::Type`. We therefore added a small forwarding
`impl specta::Type for BindingsError` that delegates to a
`BindingsErrorIpc { code: ErrorCode, message: String }` struct in
`error.rs`. This is what appears in `bindings.ts` as `BindingsErrorIpc`
and matches the JSON envelope produced by the manual `Serialize` impl.

## Playbook: adopting specta on a new DTO

1. **Add the derive** on the Rust type. Keep any existing `#[serde(...)]`
   attributes — specta reads serde attrs natively:

   ```rust
   #[derive(Debug, Serialize, specta::Type)]
   #[serde(rename_all = "camelCase")]
   pub struct MyDto { ... }
   ```

2. **If the DTO lives in a crate that doesn't yet depend on specta**,
   add `specta = { workspace = true, features = ["derive"] }` to that
   crate's `Cargo.toml`. `tracepilot-core`, `tracepilot-indexer`,
   `tracepilot-export`, and `tracepilot-orchestrator` are the likely
   candidates.

3. **Register it with the pilot builder**. Open
   `crates/tracepilot-tauri-bindings/src/specta_exports.rs` and add:

   ```rust
   .typ::<path::to::MyDto>()
   ```

   to the `Builder::<tauri::Wry>::new()` chain. Note: a DTO only needs
   an explicit `.typ::<T>()` call if it isn't referenced transitively
   by a command already in `collect_commands![…]`. If a command returns
   it, specta picks it up automatically.

4. **Regenerate**: `pnpm gen:bindings`.

5. **Verify the TS shape** in
   `packages/client/src/generated/bindings.ts`.

6. **Consume it**: import from `@tracepilot/client/src/generated/bindings`.
   Delete the hand-mirrored type in `packages/types/` **in the same PR**
   and fix up callers. Keep the commit focused — one DTO per PR makes
   the diff reviewable.

## Playbook: migrating a whole command

1. **Annotate the command handler** with `#[specta::specta]` alongside
   `#[tauri::command]`:

   ```rust
   #[tauri::command]
   #[specta::specta]
   pub async fn my_cmd(...) -> CmdResult<MyDto> { ... }
   ```

2. **Ensure every input and output type derives `specta::Type`.** This
   includes nested types — the derive won't compile if any leaf is
   missing. If a type wraps a foreign error that can't derive `Type`,
   use the forwarding `impl Type` pattern from `BindingsError`.

3. **Expose the command to the pilot builder.** In
   `crates/tracepilot-tauri-bindings/src/lib.rs`, add a re-export to
   the hidden `specta_exports` module (if following the current pattern)
   or — once every command is annotated — just flip
   `mod commands;` → `pub mod commands;` and drop the shim. Then add
   the command to `collect_commands![...]` in
   `specta_exports::export()`.

4. **Regenerate** and **verify** as above.

5. **Delete the hand-mirrored TS wrapper** in
   `packages/client/src/commands.ts` and the hand-mirrored input/output
   types in `packages/types/`. Switch callers to the generated
   `commands.myCmd(...)` API.

6. **Leave `tauri::generate_handler![...]` alone** until the final
   cutover — see next section.

## Plan: replacing `tauri::generate_handler!` with `Builder::invoke_handler()`

Once **every** IPC command is `#[specta::specta]`-annotated:

1. In `lib.rs::init()`, replace
   ```rust
   .invoke_handler(tauri::generate_handler![...])
   ```
   with
   ```rust
   let (invoke_handler, register) = builder.build().expect("specta builder");
   // …
   .invoke_handler(invoke_handler)
   .setup(move |app, api| { register(app); setup_inner(app, api) })
   ```
   (API shape per `tauri-specta` 2.0.0-rc.24 —
   `Builder::invoke_handler()` + `Builder::mount_events()`; double-check
   the exact names at cutover time because specta is still in rc.)
2. Drop the `commands` list in `apps/desktop/src-tauri/build.rs` that
   feeds `InlinedPlugin::commands(&[…])`, or derive it from the same
   specta registry if the API permits.
3. Delete `packages/client/src/commands.ts` and
   `apps/desktop/src/__tests__/commandContract.test.ts`.

**Do this in one atomic PR** once all commands are migrated — a partial
switchover is worse than either end state because it duplicates the
registry surface.

## Hand-maintained TS mirrors awaiting migration

The following files in `packages/types/src/` are still hand-mirrored
from Rust. In rough order of payoff (widest fan-out first):

| File | Mirrors (approx.) |
| --- | --- |
| `session.ts` | `tracepilot-core::SessionHeader`, `ConversationTurn`, `TypedEvent` and friends; `SessionListItem` ✅ migrated wave 21 |
| `search.ts` | `tracepilot-indexer::SearchHit`, facet DTOs, FTS health |
| `sdk.ts` | `tracepilot-orchestrator::bridge::{BridgeStatus, BridgeSessionInfo, BridgeModelInfo, BridgeQuota, BridgeAuthStatus, DetectedUiServer, BridgeConnectConfig, BridgeSessionConfig, BridgeSessionMode, BridgeMessagePayload}` + `BridgeMetricsSnapshot` (✅ migrated wave 21) |
| `tasks.ts` | `tracepilot-orchestrator::task_orchestrator::*` task/job/preset DTOs |
| `orchestration.ts` | Worktree, repo, launcher, system-dep DTOs |
| `analytics.ts` | `tracepilot-core` analytics rollups |
| `config.ts` | `TracePilotConfig`, agent defs, copilot config, backups, templates; `UpdateCheckResult` / `GitInfo` / `ValidateSessionDirResult` ✅ migrated wave 98 (now generated) |
| `export.ts` | Export/import preview + result DTOs |
| `mcp.ts` | MCP server DTOs |
| `skills.ts` | Skill definitions, asset descriptors |
| `conversation.ts`, `replay.ts`, `tool-args.ts`, `tool-rendering.ts` | Frontend-only derived shapes — **do NOT migrate**; these are view models, not Rust mirrors |
| `ipc-events.ts`, `known-events.ts` | Event name registries — migrate via `tauri_specta::collect_events!` in a separate sub-wave |
| `models.ts`, `defaults.ts` | Small constants — best done alongside `tauri_specta::Builder::constant(…)` or left as-is |

`packages/client/src/commands.ts` is **one** giant hand-maintained
command-name registry; it's the natural "last thing to delete" once
every command has been migrated.

`apps/desktop/src/__tests__/commandContract.test.ts` is a regex-based
safety net that cross-checks Rust vs TS command names. Keep it running
until codegen is authoritative, then delete it in the same PR that
removes `commands.ts`.

## CI recommendation

Add a fail-fast check that the generated file is never stale. Either as
a lefthook pre-push step or a dedicated CI job:

```yaml
# .github/workflows/ci.yml (or similar)
- name: Regenerate bindings
  run: cargo run -p tracepilot-tauri-bindings --bin gen-bindings
- name: Fail on stale bindings
  run: git diff --exit-code packages/client/src/generated/
```

Equivalent lefthook step:

```yaml
# lefthook.yml
pre-push:
  commands:
    gen-bindings-fresh:
      run: |
        cargo run -p tracepilot-tauri-bindings --bin gen-bindings
        git diff --exit-code packages/client/src/generated/
```

## Troubleshooting

- **`error: expected an expression` on a `#[tracing::instrument(..., fields(foo = %foo))]`-decorated command** when you add `#[specta::specta]`: place the specta attribute **after** `tracing::instrument` (i.e. below it in source order). Specta's macro re-reads the remaining attribute list and chokes on the `%` / `?` tracing sigils in `fields(...)`. Order in `state::is_session_running` for a concrete example.
- **`STATUS_ENTRYPOINT_NOT_FOUND` when running the bin on Windows**:
  the `embed-manifest` build-dep should prevent this. If it resurfaces
  (e.g. after a tauri major upgrade pulls in new comctl32 symbols),
  confirm `build.rs` still runs and the embedded manifest still
  includes Common-Controls v6.
- **`the trait FunctionResult<_> is not satisfied`**: the command's
  error type doesn't implement `specta::Type`. See the `BindingsError`
  forwarding-impl pattern in `error.rs` for foreign-error workarounds.
- **`#[specta(rename_all ...)]` is no longer supported on containers**:
  specta 2.0.0-rc.24 removed the attribute. Use `#[serde(rename_all)]`
  instead; specta reads it. You may need to also add a
  `serde::Serialize` derive so the attribute is valid at compile time.
