# ADR 0002 — Tauri capability scoping: main vs viewer

- **Status:** Accepted
- **Date:** 2026-04
- **Phase:** 1A.1 (tech-debt plan)

## Context

TracePilot runs two kinds of Tauri webview windows:

- **Main window** (`main`) — the full application: orchestration, settings, MCP, SDK bridge, skills, reindex, launcher, factory reset.
- **Viewer windows** (`viewer-<session-id>`) — a pop-out, single-session detail view (`ChildApp.vue` mounted when `isViewer()` is true in `apps/desktop/src/main.ts`).

Before this ADR, a single capability file (`capabilities/default.json`) applied to `["main", "viewer-*"]` and granted `tracepilot:default` — which, combined with `build.rs` declaring the plugin via `InlinedPlugin::default_permission(AllowAllCommands)`, exposed **every** tracepilot IPC command to viewer windows.

That surface included destructive commands with no read-only use case:

- Config writes: `save_config`, `factory_reset`
- Orchestration / launchers: `launch_session`, `resume_session_in_terminal`, `open_in_explorer`, `open_in_terminal`, `open_session_window`
- Indexing and templates: `reindex_sessions*`, `save_session_template`, `delete_session_template`
- Agent / skills mutations: `save_agent_definition`, all `skills_create|update|delete|rename|duplicate|import_*|remove_asset`
- MCP mutations: `mcp_add_server|update_server|remove_server|toggle_server|import_*`
- SDK writes: `sdk_send_message`, `sdk_create_session`, `sdk_abort_session`, `sdk_destroy_session`, `sdk_unlink_session`, `sdk_set_session_mode`, `sdk_set_session_model`, `sdk_set_foreground_session`, `sdk_launch_ui_server`, `sdk_connect`, `sdk_disconnect`
- Export / import: `export_sessions`, `import_sessions`, `export_logs`
- Config backups: `create_config_backup`, `restore_config_backup`, `delete_config_backup`, `save_copilot_config`
- Repo registry / worktrees mutations: `add_registered_repo`, `remove_registered_repo`, `toggle_repo_favourite`, `create_worktree`, `remove_worktree`, `prune_worktrees`, `lock_worktree`, `unlock_worktree`

A misbehaving or hijacked viewer context could therefore factory-reset the install, overwrite config, mutate app integrations, or send arbitrary SDK messages.

## Decision

Split the capabilities into two files, each scoped by window label:

- **`apps/desktop/src-tauri/capabilities/main.json`** — `windows: ["main"]`. Keeps today's broad surface (`tracepilot:default` plus `core`, `dialog`, `opener`, `process`, `updater`, `notification`, `log`).
- **`apps/desktop/src-tauri/capabilities/viewer.json`** — `windows: ["viewer-*"]`. Explicit per-command `tracepilot:allow-<cmd>` identifiers for the **read-only session-viewing surface only**, plus `core:default`, a minimal window-management subset, and `log:default`.

`capabilities/default.json` is deleted so there is no blanket capability overlapping both window kinds.

`build.rs` keeps `DefaultPermissionRule::AllowAllCommands`. With that rule Tauri's inlined-plugin macro emits both `tracepilot:default` (covering every command — used by `main.json`) *and* per-command `tracepilot:allow-<cmd>` identifiers (used by `viewer.json`). Switching to `NoCommands` would force us to enumerate all ~160 commands on `main.json` as well, with no additional safety benefit over the current split.

## Viewer allow-list (and why each entry is there)

Audited by tracing the viewer mount path:
`ChildApp.vue` → `SessionDetailTabView.vue` → `SessionDetailPanel.vue` + tab components (`OverviewTab`, `ConversationTab`, `EventsTab`, `TodosTab`, `MetricsTab`, `TokenFlowTab`, `SessionTimelineView`).

| Command | Reached from | Read-only? |
| --- | --- | --- |
| `list_sessions` | `stores/sessions.ts` → `fetchSessions()` in `ChildApp.onMounted` | yes |
| `get_session_detail` | `composables/useSessionDetail.ts` → `loadDetail` | yes |
| `get_session_turns` | `useSessionDetail.loadTurns` (Conversation / Token Flow) | yes |
| `get_session_events` | `useSessionDetail.loadEvents` (Events tab) | yes |
| `get_session_incidents` | `useSessionDetail` incidents section | yes |
| `get_session_todos` | `useSessionDetail` todos section (Todos tab) | yes |
| `get_session_checkpoints` | `useSessionDetail` checkpoints (Overview) | yes |
| `get_session_plan` | `useSessionDetail` plan (Overview) | yes |
| `get_shutdown_metrics` | `useSessionDetail` metrics (Metrics / Token Flow) | yes |
| `check_session_freshness` | `useSessionDetail` auto-refresh gate | yes |
| `is_session_running` | `SessionDetailPanel.checkRunning` (active-badge) | yes |
| `get_tool_result` | `composables/useToolResultLoader` (Conversation expand-tool) | yes |
| `check_config_exists` | `stores/preferences.hydrate` | yes |
| `get_config` | `stores/preferences.hydrate` | yes |
| `close_session_window` | Currently unused from viewer code (ChildApp uses `getCurrentWindow().close()` directly). Included defensively so a future viewer-initiated close IPC keeps working. Safe: closes a window by its own label. | yes |

Plus non-tracepilot essentials:

- `core:default` — Tauri core APIs (event listen, app metadata, path resolution) the webview needs.
- `core:window:allow-close` / `allow-destroy` — ChildApp's titlebar close button uses `getCurrentWindow().close()`.
- `core:window:allow-set-focus` / `allow-set-title` / `allow-unminimize` — viewer updates its own title with the session summary (`ChildApp.updateWindowTitle`) and re-focuses when activated.
- `log:default` — viewer uses `@tauri-apps/plugin-log` via `utils/logger.ts`.

## What the viewer explicitly does NOT get

- **`dialog`** (no file picker — viewer cannot export/import)
- **`opener`** (no external URL opens — viewer UI doesn't expose GitHub / link buttons)
- **`process:allow-restart`** (updater flow is main-window only)
- **`updater`** (auto-update is main-window only — see `useAutoUpdate.ts` gated on `isMain()`)
- **`notification`** (no OS notifications from viewer; `useAlertDispatcher` runs from main)
- **`tracepilot:default`** (would re-expose every command — the whole point of this ADR)

### Known UX regressions from the split

`SessionDetailPanel.vue` renders three action buttons that will fail when clicked inside a viewer window:

1. **📂 Open Folder** — calls `open_in_explorer`.
2. **▶ Resume in Terminal** — calls `resume_session_in_terminal`.
3. **SDK Steering Panel** (`SdkSteeringPanel.vue`, nested in `ChatViewMode`) — calls `sdk_send_message`, `sdk_set_session_model`, etc.

These are intentional. The viewer is a **read-only** session display; launching editors, opening terminals, or sending SDK steering messages are main-window operations. If user reports come in that a specific action is being blocked in the viewer, the resolution is one of:

- **Add the command to `viewer.json`** if it is genuinely read-only and there's a legitimate reason to expose it in the pop-out (e.g. a hypothetical `get_log_path` if the viewer ever shows its own log path).
- **Hide the button in the viewer UI** via `useWindowRole().isViewer()` — preferred for any mutation/launch action, to avoid silent capability-denied errors. (This is a follow-up task; out of scope for the capability change itself.)

Do **not** grant any `*_send`, `*_create`, `*_update`, `*_delete`, `*_import`, `save_*`, `launch_*`, `open_in_*`, `resume_*`, `reindex_*`, `factory_reset`, or `rebuild_*` command on the viewer without explicit review — that would undo the security boundary this ADR establishes.

## Consequences

- **Positive:** A compromised or bugged viewer window can no longer factory-reset, write config, mutate MCP/skills, send SDK messages, or launch processes. The attack surface drops from ~160 commands to 15.
- **Positive:** The allow-list is declarative JSON — easy to audit in code review.
- **Negative:** Any new read-only command needed by the viewer must be added in two places: the Rust command registration *and* `capabilities/viewer.json`. The CI test proposed in Phase 1A.1 (`test_viewer_disallows_destructive`) will help keep this honest.
- **Negative:** The three UX regressions in `SessionDetailPanel` listed above. Tracked as follow-up: hide those buttons when `isViewer()`.

## Alternatives considered

- **Keep the unified capability, add runtime checks inside each tracepilot command.** Rejected: duplicates logic across ~160 commands, error-prone, and Tauri's capability system exists precisely to avoid this.
- **Switch `build.rs` to `DefaultPermissionRule::NoCommands` and enumerate all commands on `main.json`.** Rejected for minimal surface area now; no additional safety over the current split. Can revisit if we want `main.json` to be explicit for audit reasons.
- **One capability per window role with shared-permissions includes.** Tauri v2 doesn't support capability-composition includes; `permissions` is a flat list.

## References

- `apps/desktop/src-tauri/capabilities/main.json`
- `apps/desktop/src-tauri/capabilities/viewer.json`
- `apps/desktop/src-tauri/build.rs`
- `apps/desktop/src-tauri/gen/schemas/capabilities.json` (generated)
- `apps/desktop/src/main.ts:28-50` (viewer dispatch)
- `apps/desktop/src/ChildApp.vue` (viewer entry point)
- `docs/archive/2026-04/tech-debt-plan-revised-2026-04.md` §1A.1
