# Interaction and microinteraction test matrix

| Surface | Pointer | Keyboard/focus | Edge and recovery states | Automated layer |
|---|---|---|---|---|
| App shell/navigation | activate, resize, collapse | skip link, tab order, active route | narrow window, deep link, unknown route | route capture + component tests |
| Search/command palette | open, select, disclose groups | shortcut, arrows, Enter, Escape, focus return | no results, loading, long query, provider error | component + Playwright |
| Dialogs/drawers | open, backdrop, close | initial focus, trap, Escape, focus restoration | nested trigger removal, long content, destructive confirm | shared primitive tests + policy |
| Session/conversation detail | tabs, rows, expand/collapse | tablist arrows, disclosure state | missing content, long tool payload, stale session | component + route capture |
| Timeline/replay | scrub, select event | slider keys, Home/End, inspect node | first/last event, empty timeline | component tests |
| File/SQLite exploration | select node/cell, resize | explicit controls, grid/splitter keys | unreadable file, empty table, long values | component + native integration |
| Import/export | choose source/preset, submit/cancel | labelled fields, combobox/listbox keys | invalid file, duplicate, partial failure, cancel | component + native integration |
| Repositories/worktrees | row actions, create/remove | visible focus actions, menu/dialog keys | dirty worktree, conflict, missing Git | component + native integration |
| Skills/MCP/configuration | select transport, edit/save | labels, pressed state, validation focus | malformed config, disconnected server | component + native integration |
| Charts/graphs/waterfalls | hover/select/inspect | focusable marks/nodes, Enter/Space | no data, dense data, reduced motion | component + Axe/browser audit |
| Toasts/errors/updater | dismiss/retry | announcement and dismiss focus | repeated errors, offline/update failure | component tests |

The browser visual suite validates rendered Vue behaviour with deterministic IPC. It does
not claim to validate operating-system dialogs, filesystem permissions, Git subprocesses,
SDK lifecycle, updater installation, or native window controls; those require packaged
Tauri tests on supported operating systems.
