# IPC permissions (Tauri capability scoping)

TracePilot is a **single-user desktop app**. There is no server-side identity,
no role table, no per-user permission check in the Rust layer — the OS user
running the binary is implicitly the only principal.

The only authorization boundary that matters is therefore **which IPC commands
can each Tauri webview window invoke**. That boundary is enforced by Tauri's
capability system, not by Rust code.

For the design rationale and history of the split, see
[ADR-0011 — Tauri capability scoping](../adr/0011-tauri-capability-scoping.md).

## Files

- `apps/desktop/src-tauri/capabilities/main.json` — main application window.
- `apps/desktop/src-tauri/capabilities/viewer.json` — pop-out session viewer
  windows (label `viewer-*`).

There is intentionally **no** `default.json` — every window must match a
named, scoped capability or its IPC calls are denied.

## Main window (`main`)

Granted broad access:

- `tracepilot:default` — every `tracepilot:*` command.
- `core:default` plus a small allowlist of window operations.
- `dialog:allow-open`, `dialog:allow-save` — open/save file pickers.
- `log:default`, `notification:default`.
- `opener:allow-open-url` — **scoped to** `https://github.com/*` and
  `https://api.github.com/*` only. No `file://`, no arbitrary URLs.
- `process:allow-restart`, `updater:default`.

This is the full surface the orchestrator/launcher/MCP/skills UIs need.

## Viewer windows (`viewer-*`)

Granted a **per-command allowlist** — no `tracepilot:default`. Roughly:

- Read-only session inspection: `list_sessions`, `get_session_detail`,
  `get_session_turns`, `get_session_events`, `get_session_incidents`,
  `get_session_todos`, `get_session_checkpoints`, `get_session_plan`,
  `get_shutdown_metrics`, `check_session_freshness`, `is_session_running`,
  `get_tool_result`, `check_config_exists`, `get_config`,
  `close_session_window`.
- Session workspace browsing: `session_list_files`, `session_read_file`,
  `session_read_sqlite`.
- SDK steering commands (intended for the popout window's foreground session,
  but Tauri capabilities scope by command name only — the `session_id` argument
  is **not** validated against the calling window's identity at this layer):
  `sdk_status`, `sdk_hydrate`, `sdk_list_sessions`, `sdk_list_models`,
  `sdk_get_auth_status`, `sdk_get_quota`, `sdk_get_foreground_session`,
  `sdk_set_foreground_session`, `sdk_resume_session`, `sdk_send_message`,
  `sdk_abort_session`, `sdk_destroy_session`, `sdk_unlink_session`,
  `sdk_set_session_mode`, `sdk_set_session_model`.

Explicitly **not** granted to viewers:

- `factory_reset`, `save_config`, `save_copilot_config`, config backups.
- `launch_session`, `resume_session_in_terminal`, `open_in_*`,
  `open_session_window`.
- All `skills_*` and `mcp_*` mutations.
- `dialog:*`, `opener:*`, `process:*`, `updater:*`, `notification:*`.
- Reindex / template / agent / repo-registry / worktree mutations.

A compromised or buggy viewer cannot factory-reset the install, mutate config,
or trigger arbitrary remote URL openers.

## Why no Rust-layer auth check?

This codebase has no concept of "user" beyond the OS process owner:

- No login, no session token, no user_id column anywhere.
- Every Rust IPC handler trusts that, if the call reached it, Tauri's
  capability layer already verified the calling window is allowed to invoke
  it.
- Adding a `permission.rs` / role module would be cargo-cult security — there
  is no second principal to discriminate against.

The capability files **are** the permission system. Treat them as such in
review.

## Adding a new IPC command safely

1. Implement the `#[tauri::command]` in `crates/tracepilot-tauri-bindings/src/commands/`.
2. Register it in the `tauri::generate_handler![…]` block in
   `crates/tracepilot-tauri-bindings/src/lib.rs`. The handler-registration
   test in that file enforces the set is in sync with `ipc_command_names.rs`.
3. The command is now reachable from the **main** window automatically (it
   falls under `tracepilot:default`).
4. Decide whether viewer windows should also be able to call it:
   - **Default: no.** Leave `viewer.json` untouched.
   - If yes, add `tracepilot:allow-<command-name>` to the `permissions`
     array in `viewer.json`. Prefer the narrowest set that makes the viewer
     useful; favour read-only over mutating.
5. If the command opens external URLs, talks to a new remote host from the
   renderer, or shells out, also review `docs/security/csp.md` and
   `main.json`'s `opener:allow-open-url` scope.

## Verifying

- `cargo test -p tracepilot-tauri-bindings` runs the handler-set sync test.
- Tauri fails the build if a capability file references a permission identifier
  that does not exist (typo'd command name, removed command).
- Manual: launch a viewer window and confirm denied calls return the standard
  Tauri "permission denied" IPC error rather than executing.
