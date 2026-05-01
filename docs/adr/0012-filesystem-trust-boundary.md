# ADR 0003 — Filesystem trust boundary for user-supplied paths

Status: Accepted
Date: 2026-04
Authors: TracePilot maintainers (wave 3, Phase 1A)

## Context

TracePilot accepts filesystem paths from the frontend across several IPC
commands. The shape of that input is varied:

| Source            | Command(s)                                    | Purpose                           |
|-------------------|-----------------------------------------------|-----------------------------------|
| User-entered      | `launch_session` (`repo_path`, worktree root) | Spawn Copilot CLI in a repo       |
| User-entered      | `open_in_explorer`, `open_in_terminal`        | Launch explorer.exe / terminal    |
| Pref-derived      | `resume_session_in_terminal`                  | `{sessionStateDir}/{id}`          |
| Config (on disk)  | Preferences import/export, snapshot dirs      | Load/save TracePilot config       |

Historically these paths were passed through to `std::process::Command`
or `std::fs` APIs with no normalisation. A user (or a user-controlled
config file, or a path fetched from a session's on-disk metadata) could
therefore:

1. Inject a UNC path (`\\attacker-smb\share`) and trigger an outbound
   SMB authentication handshake (credential leak surface).
2. Pass a path containing an embedded NUL byte that confuses downstream
   tooling.
3. Pass a non-canonical path with `..` segments that escape the
   directory the user thought they were operating in.
4. Pass a symlink into a sensitive filesystem location.

There is no Tauri-level sandbox preventing this — `allowed_paths` is
not wired up for these commands, and doing so retroactively would break
every valid repo path.

## Decision

We introduce a single helper, `canonicalize_user_path`, that all
user-supplied path inputs **must** flow through before touching the OS.
It lives in `crates/tracepilot-orchestrator/src/launcher.rs`. Its
contract:

1. Reject paths containing a NUL byte (defence in depth — most OS APIs
   already reject, but we want a typed error before we spawn a child).
2. Call `std::fs::canonicalize`, which:
   - Resolves `..` and `.` segments.
   - Follows symlinks (see "Symlink policy" below).
   - Fails loudly if the path does not exist.
   - On Windows, always returns a verbatim path (`\\?\C:\...` or
     `\\?\UNC\server\share`).
3. On Windows only: reject `\\?\UNC\...` results (network shares). The
   prefix is then stripped so downstream tools that don't speak
   verbatim form (explorer.exe, older PowerShell, git-for-windows) see
   a normal `C:\...` path.

What the helper **does not** do:

- It is **not a jail**. It does not constrain output to a configured
  root (e.g. a sessions directory). Callers that need that containment
  must do their own prefix check against the returned `PathBuf`.
- It does **not** protect against TOCTOU races: the path is canonical
  at the instant we call it, but could be rewritten (symlink swap,
  mount change) before the spawned child opens it. Spawning explorer
  or a terminal is not a security-critical operation, so this is
  accepted residual risk.
- It does **not** check that the path is inside the mounted filesystem
  namespace we expect — e.g. it will happily canonicalize
  `/proc/1/root/...` on Linux.

## Symlink policy

`std::fs::canonicalize` follows symlinks. We accept this because:

- The alternative (rejecting symlinks) would break users whose repos
  live behind junction points, `\Users` redirection, or enterprise
  home-directory symlinks.
- We only *spawn* against the resolved path — we don't read sensitive
  TracePilot config from user-supplied paths.
- A user supplying a malicious symlink would be attacking themselves
  (they provided the input).

The risk we monitor is a **config-on-disk** path being a symlink to a
sensitive location. All such config is currently written to
`{sessionStateDir}` (preferences-controlled), so the blast radius is
"where the user already trusts us to write".

## Which commands accept arbitrary paths today

This list is authoritative as of wave 3 (Phase 1A). Keep it in sync
when adding new commands.

| Command                           | Path source       | Flows through helper? |
|-----------------------------------|-------------------|-----------------------|
| `launch_session.repo_path`        | Frontend user     | ✅ Yes                 |
| `launch_session.worktree_root`    | Frontend user     | ✅ Yes                 |
| `open_in_explorer.path`           | Frontend user     | ✅ Yes                 |
| `open_in_terminal.path`           | Frontend user     | ✅ Yes                 |
| `resume_session_in_terminal.cwd`  | Pref + session id | ✅ Yes (via launcher)  |
| Preferences import/export         | Tauri dialog      | N/A (dialog-gated)    |
| Snapshot save/restore             | `sessionStateDir` | N/A (pref-rooted)     |

If you add a command that takes a path from the frontend, you **must**
either:

1. Pipe it through `canonicalize_user_path` before use, or
2. Restrict to paths rooted at a preferences-owned directory
   (`sessionStateDir`, `cacheDir`, …) with a prefix check *after*
   canonicalisation, or
3. Gate the path on a native Tauri dialog so the OS mediates the
   choice.

## Consequences

Positive:

- UNC/network paths can no longer trigger outbound SMB auth from any
  of the current user-facing path commands.
- `..` traversal is resolved before child-process spawn, making
  security review tractable.
- Errors for missing paths are uniform and actionable instead of
  leaking `io::Error` wording.

Negative / accepted:

- Users with repos on network shares must map them to a drive letter
  first. This is a deliberate policy decision.
- The helper is not a jail — future commands that need stricter
  containment (e.g. "must be under the sessions directory") must
  implement that check themselves against the helper's output.

## Future work

- Add a `path_within(root, candidate)` utility for the callers that
  need jailing, so we don't reinvent the prefix check each time.
- Consider an opt-in `deny_symlinks` mode for commands writing to
  pref-rooted directories.
- When Tauri v2 scope improvements allow per-command allowed_paths,
  revisit whether the helper can be replaced by a plugin-level
  primitive.

## References

- `crates/tracepilot-orchestrator/src/launcher.rs`
  (`canonicalize_user_path`, `launch_session`, `open_in_explorer`,
  `open_in_terminal`).
- ADR 0002 — Tauri capability scoping (main vs viewer).
- Historical filesystem trust-boundary plan notes are available in git history before the 2026-05-01 documentation cleanup.
