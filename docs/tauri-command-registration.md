# Tauri Command Registration Guide

TracePilot's IPC commands live in the `tracepilot` Tauri plugin
(`crates/tracepilot-tauri-bindings`). One Rust list,
`with_ipc_commands!` in
[`ipc_command_names.rs`](../crates/tracepilot-tauri-bindings/src/ipc_command_names.rs),
drives every registry:

- `tauri::generate_handler![]` in `lib.rs` (the invoke router).
- `IPC_COMMAND_NAMES`, which `apps/desktop/src-tauri/build.rs` `include!`s
  and passes to `tauri_build::InlinedPlugin::commands()`. Tauri 2 only
  generates ACL permissions for listed commands; an unlisted one fails at
  runtime with `tracepilot.<command> not allowed. Command not found`.
- `packages/client/src/generated/ipc-commands.ts` (`IPC_COMMANDS`, re-exported
  by `packages/client/src/commands.ts` with the `CommandName` type) and
  `ipc-commands.json`, both written by `pnpm gen:bindings`.

## Adding a command

1. Write the `#[tauri::command]` function in its module under
   `crates/tracepilot-tauri-bindings/src/commands/`. A new submodule needs a
   `pub use <submod>::*;` in its parent so the macro and Tauri can resolve it.
2. Add its name to that module's group in `with_ipc_commands!`
   (`ipc_command_names.rs`).
3. If the command is specta-typed (`#[specta::specta]`), also add it to
   `collect_commands![]` in `specta_exports.rs`. See the
   [specta migration guide](specta-migration-guide.md).
4. Run `pnpm gen:bindings` and commit the regenerated
   `packages/client/src/generated/` and `packages/types/src/generated/`.
   CI fails if they are stale.
5. Add the client wrapper (`invoke<T>("my_command", args)`) in the matching
   `packages/client/src/<domain>.ts` and a mock response in the client's mock
   routes, so `pnpm app:ui` works.
6. If pop-out windows call it, grant it in `capabilities/viewer.json` (below).

Removing or renaming a command is the same edit in reverse. Tests catch drift:
`cargo test -p tracepilot-tauri-bindings ipc_manifest` checks for duplicates,
specta exports that aren't registered and capabilities that name unknown
commands; `packages/client/src/__tests__/commandContract.test.ts` checks the
generated TS and JSON agree.

## Capabilities

The main window's capability (`apps/desktop/src-tauri/capabilities/main.json`)
uses `"tracepilot:default"`. With `DefaultPermissionRule::AllowAllCommands`,
every registered command is allowed there.

Pop-out session windows (`viewer-*`) use `capabilities/viewer.json`, which grants
commands one by one ([ADR 0011](adr/0011-tauri-capability-scoping.md)). If a
session view calls the new command, add `"tracepilot:allow-<command-with-dashes>"`
there, or hide the trigger in pop-outs when the command writes, launches or spawns.
`apps/desktop/src/__tests__/config/viewerCapabilities.test.ts` fails until you do
one or the other.

## Merge conflicts in generated files

On a conflict in `bindings.ts`, `ipc-commands.ts`, `ipc-commands.json` or
`contracts.ts`, take either side and re-run `pnpm gen:bindings`. Never resolve
them by hand. Resolve conflicts in `ipc_command_names.rs` by keeping both
sides' names.

## Debugging "not allowed. Command not found"

- Is the function annotated with `#[tauri::command]`?
- Is it in `with_ipc_commands!`?
- Did you rebuild the desktop app? `build.rs` reads the list at build time.
- Does it fail only in a pop-out window? Grant it in `capabilities/viewer.json`.
