# ADR-0016: Live attach to Copilot CLI terminal sessions

Date: 2026-09-26
Status: Accepted

## Context

ADR-0015 moved the bridge to the official `github-copilot-sdk` and verified
that an SDK client can join a running `copilot --ui-server` over TCP and
resume its session as a handler-less observer. Before this ADR, a user had
to find that server manually (Settings → Detect → Connect), and the bridge
held a single client, so TracePilot could observe at most one terminal at a
time. Opening a session running in a terminal and pressing "Link" instead
resumed it through TracePilot's private stdio CLI, which gives an isolated
copy that sees none of the terminal's activity and forks history if a
message is sent (live attach plan, F9).

Further research against Copilot CLI 1.0.88 established:

- `--ui-server` is a startup flag. The CLI has no environment variable,
  config key, or slash command that starts the server in a running process.
  A running session becomes attachable only by exiting and running
  `copilot --resume <id> --ui-server`, which keeps its history.
- A plain `--ui-server` does not publish to the `~/.copilot/servers`
  registry, even with `--experimental`. The registry is written only by
  managed servers, so it cannot locate terminal sessions.
- A running CLI keeps `inuse.<pid>.lock` in the session directory and holds
  `inuse.<pid>.hold` open. The lock names the hosting PID. An exclusive open
  of the hold file fails with a sharing violation while that PID lives.
- The `session.resume` event written by an attach carries no client name,
  so the history cannot tell observers apart from other resumes.

## Decision

1. **Locate hosting per session from local state.** For each session,
   `bridge::live_host` reads the lock holder PIDs, and checks that a holder
   is alive:
   - Windows: probe the hold file. This opens it read-only and exclusively
     and never writes to it.
   - Other platforms: one `ps` listing.

   It then maps the PID to a loopback listening port, using `netstat -ano`
   on Windows or `lsof` elsewhere, cached for 2 s. It reports each session
   as:
   - `attachable`: a `--ui-server` with a port;
   - `running`: a live holder without a server;
   - `idle`: no live holder.

   Session IDs that are not plain directory names are reported idle without
   touching the filesystem.

2. **One SDK client per endpoint.** `BridgeManager` keeps a map from address
   to `github_copilot_sdk::Client` (`Transport::External`), separate from
   its main stdio/TCP client. The main bridge does not need to be connected
   to attach. An endpoint is closed when its last attached session detaches.
   `Client::stop()` on an external client only closes the connection.

3. **Attach is an observer resume, at most once.** `attach_session`
   resumes with no permission, input, or elicitation handlers, and forwards
   events through the same live-state reducer as the bridge. It is
   idempotent while the session stays tracked, because each resume appends
   one `session.resume` event. The history view collapses consecutive
   resumes into one row ("Session resumed 3×"). Detach is
   `Session::disconnect()`, which writes nothing.

4. **Route resume by hosting state.** `sdk_resume_session` attaches when the
   session is attachable. It refuses with `NotAttachable` when the session is
   running in a plain terminal, so TracePilot never forks a live session.
   It keeps the private-CLI resume only for idle sessions.

5. **Reconcile continuously.** `sdk_live_hosts` locates the requested
   sessions and drops any attachment whose host is no longer attachable or
   has moved to another address. Dropped sessions get a terminal
   `shutdown` snapshot with the reason, and the frontend marks them
   inactive. The open session is polled every 5 s and running rows in the
   session list every 10 s, and only while the window is visible.

6. **Make TracePilot's own terminals attachable by default.** When the
   Copilot SDK feature is on, new launches and "Resume in Terminal" add
   `--ui-server`. This is controlled by the `live.launchAttachable`
   preference, default on.

7. **Auto-attach behind a preference.** Opening an attachable session
   attaches automatically when `live.autoAttach` is on (the default). This
   happens at most once per hosting terminal (session, PID and address) per
   view, and never after the user pressed Detach in that view. A terminal
   that is closed and started again is a new host and is attached again. A
   freshly started terminal can hold the lock and serve its port before it
   has loaded the session, so "session not found" from a hosting endpoint is
   retried for a few seconds. Detach and every other teardown RPC to an
   endpoint are time-bounded, because a request written after the terminal
   died is never answered and teardown holds the manager's write lock.

8. **Live overlay versus persisted history.** Ephemeral data never reaches
   `events.jsonl`, so it is shown only from the live state:
   - assistant and reasoning deltas;
   - partial tool output;
   - usage and context-window size.

   Every durable event schedules a refresh of the persisted session. The
   refresh uses a 400 ms trailing debounce and runs at least every 2 s
   while events keep arriving. Durable events are `user.message`,
   `assistant.message`, turn end, tool start and complete, subagent
   lifecycle, idle, error, and compaction. Once the refresh runs:
   - the saved turn replaces the streamed overlay as soon as it contains
     the streamed text;
   - live tool output renders inside the persisted tool card until that
     card has its own result.

   Prompts typed in the terminal therefore appear within about 1.5 s.

## Consequences

**Good.**

- Opening a session that runs in a `--ui-server` terminal streams it with
  no setup: replies, reasoning, tool output, status, and context usage.
- Any number of terminals can be watched at once, each on its own client.
- TracePilot can no longer fork a live terminal session by linking it.
- Locating spawns at most one `netstat -ano` per 2 s on Windows (holder
  liveness is a file-open probe), and the port table is shared across
  sessions. A 500-session request takes about 3 ms after
  the first port probe.
- The persisted view stays authoritative; the overlay only fills the gap
  until the durable events are indexed.

**Trade-offs.**

- Terminals started without `--ui-server` can only be followed through the
  durable events on disk. The UI shows the exact restart command instead.
- Each attach adds a `session.resume` event to the user's session.
- Hosting detection relies on undocumented CLI files (`inuse.*.lock`,
  `inuse.*.hold`). A CLI bump must re-check them. When liveness cannot be
  determined, the locator falls back to treating any lock as live.
- Terminals started with a bare `--ui-server` accept connections without a
  connection token (F13). TracePilot connects only to `127.0.0.1`, and only
  to a port owned by the session's lock holder. Token support is a
  follow-up.
- Permission and input prompts stay in the terminal. The live panel shows
  that a prompt is pending but cannot answer it.

## Alternatives considered

1. **Enable the server inside a running CLI.** Not possible: the flag is
   read once at startup and there is no runtime control.
2. **Use the `~/.copilot/servers` registry.** Rejected for now: plain
   `--ui-server` terminals do not publish to it. Revisit if the CLI starts
   publishing them.
3. **Tail `events.jsonl` for live updates.** Rejected as the live source:
   more than 90% of a turn's events are ephemeral and never written to disk
   (F7). The persisted refresh already covers durable events.
4. **Scan all processes with `tasklist` or PowerShell for liveness.**
   Rejected: it took about 500 ms per call on Windows and blocked the
   polling cadence. The hold-file probe answers the same question in
   microseconds.
5. **Keep a single bridge client and switch between terminals.** Rejected:
   users run several terminals at once, and switching would re-resume each
   time, adding `session.resume` events.

## References

- [Copilot live attach plan](../features/copilot-live-attach-plan.md)
- ADR-0015: official SDK, observer semantics, detach behaviour.
- ADR-0009: bridge lifecycle and the preference guard.
- `crates/tracepilot-orchestrator/src/bridge/live_host.rs`,
  `bridge/manager/attach.rs`, `bridge/manager/forwarder.rs`
- `apps/desktop/src/stores/sdk/liveHosts.ts`,
  `apps/desktop/src/composables/useLivePersistedSync.ts`
