# Tauri 2 Command Registration Guide

## The Problem

When adding new `#[tauri::command]` functions in Tauri 2, you'll get a runtime error like:

```
tracepilot.<command_name> not allowed. Command not found.
```

This happens even if the command is properly defined and added to
`generate_handler![]` in `lib.rs`.

## Root Cause

Tauri 2 uses an **Access Control List (ACL)** system. Every IPC command must be
registered in **three** places — not just two:

| # | Where | File | What |
|---|-------|------|------|
| 1 | **`#[tauri::command]`** | `crates/tracepilot-tauri-bindings/src/lib.rs` | Define the Rust function |
| 2 | **`generate_handler![]`** | `crates/tracepilot-tauri-bindings/src/lib.rs` (bottom) | Register with Tauri's invoke router |
| 3 | **`.commands(&[...])`** | `apps/desktop/src-tauri/build.rs` | Declare for ACL permission generation |

Step 3 is the one that's easy to miss. The `build.rs` file uses
`tauri_build::InlinedPlugin` to list all commands. The build script generates
permission manifests in `apps/desktop/src-tauri/gen/` (gitignored). If a command
isn't in this list, Tauri's ACL layer blocks it at runtime — even when
`DefaultPermissionRule::AllowAllCommands` is set — because permissions are never
*generated* for unlisted commands.

## How to Add a New Command

1. **Define** the command in `lib.rs`:

   ```rust
   #[tauri::command]
   async fn my_new_command(state: State<'_, SharedConfig>) -> Result<String, String> {
       Ok("hello".into())
   }
   ```

2. **Register** it in the `generate_handler![]` macro at the bottom of `lib.rs`:

   ```rust
   generate_handler![
       // ... existing commands ...
       my_new_command,
   ]
   ```

3. **Declare** it in `apps/desktop/src-tauri/build.rs`:

   ```rust
   .commands(&[
       // ... existing commands ...
       "my_new_command",
   ])
   ```

4. **Rebuild** — `cargo build -p tracepilot-desktop` will regenerate the ACL
   manifests. The frontend can now call
   `invoke('plugin:tracepilot|my_new_command')`.

## Capabilities

The capabilities file at `apps/desktop/src-tauri/capabilities/default.json`
references `"tracepilot:default"`, which maps to the auto-generated default
permission. Since `DefaultPermissionRule::AllowAllCommands` is configured, adding
the command to `.commands()` is sufficient — no capability file changes needed.

## Debugging Checklist

If you see `"<plugin>.<command> not allowed. Command not found"`:

- [ ] Is the function annotated with `#[tauri::command]`?
- [ ] Is it listed in `generate_handler![]`?
- [ ] Is it listed in `build.rs` `.commands(&[...])`?
- [ ] Did you rebuild after editing `build.rs`? (It's a build script — changes
      require a full rebuild.)
