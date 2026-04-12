# Copilot SDK Data Flow & Architecture Deep Dive

How data flows between TracePilot, the SDK, and the Copilot CLI — including
why "corruption" errors happen and when steering is safe.

> **Last updated:** 2026-04-12

---

## Table of Contents

- [Overview](#overview)
- [Connection Modes](#connection-modes)
- [Session Discovery](#session-discovery)
- [Session Resume](#session-resume)
- [Steering Data Flow](#steering-data-flow)
- [The "Corruption" Problem](#the-corruption-problem)
- [Concurrent Access & Safety](#concurrent-access--safety)
- [Lock File Mechanism](#lock-file-mechanism)
- [File Layout on Disk](#file-layout-on-disk)
- [Observation vs Steering](#observation-vs-steering)
- [Known Limitations](#known-limitations)

---

## Overview

TracePilot has **two independent paths** for interacting with Copilot sessions:

```
 Path 1: File-based Observation (always active)
 ┌───────────────────────────────────────────────────┐
 │ TracePilot Indexer reads events.jsonl from disk    │
 │ → parse line-by-line → tolerant of schema changes │
 │ → skip bad lines, Option<Vec<_>> for nullable     │
 │ → 5s polling refresh cycle                        │
 └───────────────────────────────────────────────────┘

 Path 2: SDK Steering (opt-in, experimental)
 ┌───────────────────────────────────────────────────┐
 │ SDK spawns a CLI subprocess (copilot --server)    │
 │ → JSON-RPC over stdio                             │
 │ → session.resume / session.send / session.list    │
 │ → CLI subprocess validates events.jsonl strictly  │
 │ → returns errors if schema doesn't match          │
 └───────────────────────────────────────────────────┘
```

**Path 1** is always safe and always works. **Path 2** adds steering capability
but depends on the CLI subprocess's schema validation.

---

## Connection Modes

### Stdio Mode (default)

```
TracePilot ──┬── BridgeManager ──── copilot-sdk crate
             │                            │
             │                    spawn: copilot --server --stdio
             │                            │
             │                    ┌───────┴──────────┐
             │                    │ CLI Subprocess    │
             │                    │ (private process) │
             │                    │ PID: new          │
             │                    └──────────────────┘
             │
             │   This subprocess is INDEPENDENT of any
             │   CLI instance the user has open in a terminal.
             │   It reads session data from the same disk files.
             └──────────────────────────────────────────────────
```

- The SDK spawns a **fresh** `copilot --server --stdio` subprocess
- This subprocess is NOT the same process as the user's terminal CLI
- It reads sessions from `~/.copilot/session-state/` on disk
- It validates events.jsonl with its own schema (Zod-based)
- **Two processes may now be operating on the same session files**

### TCP/URL Mode (--ui-server)

```
Terminal TUI ────┐
                 │
 TracePilot ─────┤──── TCP JSON-RPC ────┐
                 │                      │
                 │               ┌──────┴──────────────┐
                 │               │ CLI Instance         │
                 │               │ (shared server)      │
                 │               │ Handles: session.*   │
                 │               │ Broadcasts: events   │
                 │               └─────────────────────┘
                 │
                 └── Both clients connect to the SAME server
```

- The user starts CLI with `copilot --ui-server`
- This CLI instance has both a TUI and an embedded JSON-RPC server
- TracePilot connects to it via TCP (the `cli_url` setting)
- **Both TracePilot and the terminal share the SAME server** — no concurrent write risk
- After TracePilot resumes a session, it also calls `set_foreground_session` to
  notify the server (and any TUI clients) about the active session
- Events are broadcast to **all connected clients** via `session.event` notifications
- This is the **safest** mode for steering active sessions

#### --ui-server behavior (verified)

1. **What it does**: `copilot --ui-server` starts a CLI instance that runs both
   a terminal TUI **and** an embedded TCP JSON-RPC server. The server listens
   on `127.0.0.1:<port>` (port is printed on startup). Protocol is JSON-RPC v2
   with Content-Length framing over TCP.

2. **Simultaneous access**: Both the terminal TUI and TracePilot can connect to
   the **same** server simultaneously. Multiple clients are supported by
   protocol v3. Each client receives `session.event` broadcasts independently.

3. **Starting it**: Run `copilot --ui-server` in a terminal. The CLI will print
   the TCP address (e.g., `127.0.0.1:53076`). TracePilot can **auto-detect**
   running `--ui-server` instances via the "Detect UI Server" button in
   Settings → SDK Bridge. The detection scans for copilot processes with
   `--ui-server` or `--server` in their command line and resolves their
   listening TCP ports. Alternatively, set the address manually in the
   CLI URL field, or run `copilot --server --port 3333` for a fixed port.

4. **TracePilot steers alongside the terminal**: When TracePilot sends a message
   via the shared server, the server processes it identically to a TUI message.
   The server broadcasts `session.event` notifications to all connected clients.
   Whether the TUI terminal visually renders third-party messages depends on the
   CLI's TUI implementation — it receives the events but may not render them as
   its own prompt/response flow.

5. **Schema validation still applies**: Even in TCP mode, the shared server
   validates `events.jsonl` with its own CLI version. If the session was
   written by a different CLI version, resume will still fail with a
   "corruption" error.

6. **Foreground APIs**: `session.setForeground` and `session.getForeground` only
   work in `--ui-server` mode, not stdio mode.

---

## Session Discovery

When the SDK connects (either mode), `session.list` returns all sessions
from `~/.copilot/session-state/`:

```
JSON-RPC: session.list → { sessions: SessionMetadata[] }

SessionMetadata:
  sessionId:    string       # UUID
  startTime:    string|null  # ISO timestamp
  modifiedTime: string|null  # ISO timestamp
  summary:      string|null  # First user message (truncated)
  isRemote:     boolean      # Whether session is flagged as remote
```

**Important**: `session.list` does NOT report whether a session is currently
running in another process. The `is_remote` flag only indicates sessions
that were created in remote/external mode.

TracePilot maps these to `BridgeSessionInfo` and adds:
- `isActive: boolean` — true only if TracePilot has successfully resumed this session through the SDK
- `resumeError: string|null` — populated if resume was attempted and failed
- `isRemote: boolean` — passed through from CLI metadata

---

## Session Resume

When you open a session in TracePilot's Conversation view, the steering
panel calls `session.resume`:

```
SdkSteeringPanel.vue
  └─ ensureSessionResumed()
       └─ sdk.resumeSession(sessionId)
            └─ sdkResumeSession(sessionId)           [TS client]
                 └─ invoke("sdk_resume_session")      [Tauri IPC]
                      └─ BridgeManager::resume_session()  [Rust]
                           └─ client.resume_session(id, ResumeSessionConfig::default())
                                └─ JSON-RPC: session.resume { sessionId }
                                     └─ CLI subprocess validates events.jsonl
                                          └─ Returns: { sessionId, workspacePath }
                                             OR
                                          └─ Error: "Session file is corrupted at line N"
```

### What the CLI subprocess does on resume:

1. Reads `~/.copilot/session-state/{id}/events.jsonl`
2. Validates **every line** against its internal event schema
3. If any line fails validation → returns JSON-RPC error
4. If validation passes → loads session state into memory
5. Creates an advisory lock file: `inuse.{pid}.lock`
6. Returns session ID + workspace path

### Why resume fails with "corruption":

The error **"Session file is corrupted at line N"** does NOT mean the file
has bad bytes or broken JSON. It means:

**The CLI subprocess's Zod schema rejected the event data at that line.**

Common causes:
- **CLI version mismatch**: Session was written by CLI v1.0.20 but the SDK
  subprocess is running v1.0.24 (or vice versa). Schema evolves between versions.
- **Schema strictness**: The CLI uses Zod with strict validation (e.g., `null`
  vs `[]` for arrays). TracePilot's Rust parsers use `Option<Vec<_>>` which
  accepts both.
- **New event types**: Newer CLIs add event types that older CLIs don't recognize.

**TracePilot's own file-based observation (Path 1) is NOT affected** by these
schema mismatches. It reads the same files successfully.

---

## Steering Data Flow

When you send a message through the steering panel:

```
User types message in SdkSteeringPanel
  └─ handleSend()
       └─ ensureSessionResumed()  [idempotent — skipped if already linked]
       └─ sdk.sendMessage(sessionId, { prompt })
            └─ sdkSendMessage(sessionId, payload)    [TS client]
                 └─ invoke("sdk_send_message")         [Tauri IPC]
                      └─ BridgeManager::send_message() [Rust]
                           └─ session.send(MessageOptions { prompt, mode })
                                └─ JSON-RPC: session.send
                                     └─ CLI subprocess processes the message
                                          └─ Writes events to events.jsonl
                                          └─ Emits real-time events via subscription
```

After sending:
1. **Optimistic UI**: Message appears immediately in sent log with "sending…" status
2. **Turn ID returned**: SDK returns a `turnId` on success → status changes to "✓ sent"
3. **Auto-refresh**: TracePilot polls events.jsonl at 800ms and 3s to pick up new data
4. **Auto-dismiss**: Sent message fades out after 4s (success) or 8s (error)

### Important: Where messages go

#### Stdio mode (default)
The steering message goes to **the SDK's private CLI subprocess**, NOT to the user's
terminal. The subprocess:
- Processes the message independently
- Writes the result to `events.jsonl`
- TracePilot's file watcher picks up the changes

If the user is watching the session in their terminal (a different process),
they will NOT see the steering message appear in their terminal UI. But the
results will be written to the shared session files.

#### TCP mode (--ui-server)
The steering message goes to the **shared server** that the user's terminal also
connects to. The server:
- Processes the message
- Broadcasts `session.event` notifications to ALL connected clients
- Writes results to `events.jsonl`

The user's terminal TUI **receives** the events. Whether it renders them visually
depends on the CLI's TUI implementation.

### Restart behavior

SDK steering state is **entirely in-memory** and does NOT survive TracePilot restarts:

| State | Persisted? | What happens on restart |
|-------|-----------|------------------------|
| SDK connection | ❌ | `autoConnect()` reconnects ~500ms after launch |
| Session list | ❌ | Re-fetched via `session.list` after reconnect |
| Resumed sessions | ❌ | Must be re-resumed (auto-resumes when panel opens) |
| `resolvedSessionId` | ❌ | Reset; re-resolved on next panel open |
| Sent messages log | ❌ | Lost; ephemeral UI state only |
| Messages written to disk | ✅ | SDK subprocess wrote to `events.jsonl` — TracePilot's file indexer picks these up on next scan |

**No conversation data is lost** — only UI steering state. The steering panel
automatically re-links when you navigate to a session after restart.

---

## The "Corruption" Problem

### Error chain

```
events.jsonl (valid JSON, every line parses)
  ↓
CLI subprocess reads line N
  ↓
Zod schema validation rejects data at line N
  (e.g., field has `null` where schema expects `[]`)
  ↓
CLI subprocess returns JSON-RPC error:
  "Session file is corrupted at line N: Expected array, received null"
  ↓
copilot-sdk crate wraps as CopilotError
  ↓
BridgeManager wraps as BridgeError::Sdk(msg)
  ↓
Tauri IPC returns error to frontend
  ↓
SDK store captures lastError
  ↓
SdkSteeringPanel.friendlyError() rewrites to:
  "Session schema mismatch at line N — the CLI version that wrote
   this session differs from the SDK's CLI."
```

### This is NOT actual corruption

- The JSON is syntactically valid
- TracePilot's own parsers read it fine
- The issue is a **schema version mismatch** between the CLI that wrote the
  session and the CLI that's trying to resume it

### What users should do

1. **Observation still works** — TracePilot shows the session data normally
2. **Steering won't work** for this specific session
3. **Update your CLI** — if your installed CLI version matches the SDK's version,
   resume will succeed
4. **Start a new session** — freshly created sessions always work with the
   current CLI version

---

## Concurrent Access & Safety

### File locking mechanism

The Copilot CLI uses **advisory lock files** only:

```
~/.copilot/session-state/{sessionId}/
  ├── events.jsonl         # append-only event log
  ├── inuse.{pid}.lock     # advisory lock (contains PID)
  ├── session.db            # SQLite database
  └── workspace.yaml        # session metadata
```

- `inuse.{pid}.lock` is created when a process resumes a session
- It's checked by other processes to detect concurrent use
- It is **NOT** an OS-level file lock — it's just a marker file
- Writes to `events.jsonl` use an **in-process mutex** (`runExclusive`),
  NOT a cross-process lock

### What this means

| Scenario | Safety | Notes |
|---|---|---|
| TracePilot observes (file watch) + CLI writes | ✅ Safe | TracePilot only reads |
| SDK subprocess resumes idle session | ✅ Safe | Single writer |
| SDK subprocess resumes session running in terminal | ⚠️ Risky | Two processes may write events.jsonl |
| Two TracePilot instances observe same session | ✅ Safe | Both only read |
| `--ui-server` mode + TracePilot steers | ✅ Safe | Single server, single writer |

### Recommendation

For **safe steering** of sessions that are actively running in a terminal:
- Use `--ui-server` mode: `copilot --ui-server`
- Set the CLI URL in TracePilot settings to the server's address
- Both the terminal and TracePilot share the same server process

For stdio mode (default): only steer sessions that are **not currently running**
in another terminal.

---

## Lock File Mechanism

### How locks work

1. When a CLI process (or SDK subprocess) resumes a session, it creates:
   `~/.copilot/session-state/{id}/inuse.{pid}.lock`

2. The lock file contains the PID of the process that created it

3. When the session is closed/destroyed, the lock file is removed

4. Other processes can check for lock files to detect concurrent use:
   - If `inuse.*.lock` exists AND the PID is still running → session is in use
   - If the PID is not running → stale lock (process crashed)

### Stale locks

Lock files from crashed/killed processes are not automatically cleaned up.
This is normal. TracePilot should check if the PID is actually running before
treating a session as "in use".

---

## File Layout on Disk

```
~/.copilot/session-state/
  ├── {sessionId-1}/
  │   ├── events.jsonl          # append-only event log (main data source)
  │   ├── session.db            # SQLite for session metadata
  │   ├── workspace.yaml        # working directory, git info
  │   ├── vscode.metadata.json  # VS Code integration metadata
  │   ├── plan.md               # session plan (if any)
  │   ├── inuse.{pid}.lock      # advisory lock file
  │   ├── checkpoints/          # session checkpoints
  │   ├── files/                # persistent files
  │   └── research/             # research artifacts
  │
  ├── {sessionId-2}/
  │   └── ...
  └── ...
```

### events.jsonl format

Each line is a JSON object with at minimum:
```json
{"type": "event.type", "timestamp": "2026-04-12T...", "data": {...}}
```

Common event types in order of appearance:
1. `session.start`
2. `session.model_change`
3. `session.info`
4. `user.message`
5. `assistant.turn_start`
6. `assistant.message`
7. `assistant.turn_end`
8. `session.resume` (if session was resumed)
9. `session.shutdown` (if session ended cleanly)

---

## Observation vs Steering

| Aspect | Observation (Path 1) | Steering (Path 2) |
|---|---|---|
| How it works | Read events.jsonl from disk | JSON-RPC to CLI subprocess |
| Always available | ✅ Yes | Only when SDK connected |
| Schema tolerance | High (skip bad lines) | Low (CLI validates strictly) |
| Write access | None (read-only) | Can send messages, change mode/model |
| Latency | 5s polling cycle | Near real-time |
| Risk of corruption | None | Low (advisory locks only) |
| Works across CLI versions | ✅ Yes | May fail on version mismatch |
| Setup required | None | Enable experimental feature |

### When to use which

- **Observation**: Always on. Use for viewing session history, analytics, search.
  Works with any CLI version, any session state.
  
- **Steering**: Use when you want to actively guide a session. Best with:
  - Sessions you created after enabling the SDK
  - `--ui-server` mode for active terminal sessions
  - A CLI version that matches the SDK subprocess version

---

## Known Limitations

1. **Quota API**: `account.get_quota` is not implemented by any current CLI version.
   Returns JSON-RPC -32601. Silently ignored by TracePilot.

2. **CLI version mismatch**: Sessions written by a different CLI version may fail
   to resume with "corrupted" errors. This is a schema validation issue, not
   actual file corruption.

3. **No cross-process file locking**: The CLI uses advisory lock files only.
   Two processes CAN write to the same events.jsonl, though this is detected
   and surfaced.

4. **Foreground session APIs**: `getForegroundSession` / `setForegroundSession`
   only work in `--ui-server` mode, not stdio mode.

5. **Image support**: The SDK supports attachments in `session.send`, but
   TracePilot does not yet expose this in the UI.

6. **`cli_url` mode**: Connecting to an existing ACP server is supported but
   less tested than stdio mode.

---

## Critical Safety Rule: No Auto-Resume

**Session linking (resume) must ALWAYS be an explicit user action.**

When the SDK calls `session.resume`, it makes the SDK subprocess (or shared
server) load and take ownership of the session. In stdio mode, this means a
**second CLI process** begins writing to the same `events.jsonl` that the
user's terminal CLI is writing to. This dual-writer scenario causes:

1. **Schema validation failures** — the second process writes events that the
   first process's Zod schema rejects, producing "Session data is corrupted" errors.
2. **Session becomes unusable** — the CLI terminal stops being able to read
   the session because it sees unexpected events from the SDK subprocess.
3. **Data loss** — events from both processes interleave unpredictably.

### Why TracePilot DOES NOT auto-resume:

- The user may be actively working in the terminal with that session
- The session may have been created by a different CLI version
- Even in TCP mode, the shared server validates session data and rejects
  events from incompatible schema versions

### What TracePilot DOES instead:

- Shows a **"Link for Steering"** button with a clear explanation of what it does
- In stdio mode: warns that a separate subprocess will be created
- In TCP mode: explains that it attaches to the shared server
- User explicitly clicks to link — they accept the risk
- **"Unlink"** button available to detach without destroying the session
