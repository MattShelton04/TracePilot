# ADR-0015: Official Copilot Rust SDK, driven against the user's installed CLI

Date: 2026-09-26
Status: Accepted

## Context

TracePilot's Copilot bridge (ADR-0007, ADR-0009) was built on the community
crate `copilot-community-sdk/copilot-sdk-rust`, pinned to a git SHA. That crate
stopped receiving updates on 2026-03-19 and had wire bugs that TracePilot
worked around with a hand-written JSON-RPC client (`session.model.switchTo`)
and an event-payload flattening shim. It also made `destroy` write
`session.shutdown` into sessions TracePilot did not own.

GitHub now publishes an official Rust SDK, `github-copilot-sdk`, on crates.io
from [`github/copilot-sdk`](https://github.com/github/copilot-sdk). It tracks
the CLI's JSON-RPC schema (protocol v3), exposes typed RPC namespaces, supports
multiple clients on one CLI server, and offers `Client::from_streams` for
testing.

TracePilot's product need is to **attach** to Copilot CLI sessions that are
already running in the user's terminals and observe them live. Research
recorded in the [live attach plan](../features/copilot-live-attach-plan.md)
verified against CLI 1.0.88 that:

- an SDK client can join a running `copilot --ui-server` over TCP and resume
  its session as a handler-less observer, receiving live events for prompts
  typed in the terminal;
- a separately spawned CLI that "resumes" a running session gets an isolated
  copy and none of the live activity;
- the official crate, by default, downloads and embeds a full CLI at build
  time, and in 1.0.14 it resolves a CLI program even for external transports.

## Decision

1. **Dependency.** Use `github-copilot-sdk` from crates.io with an **exact**
   version pin (`=1.0.14` at adoption) and `default-features = false`. Remove
   the community git dependency and its `deny.toml` git allow-list entry.

2. **No bundled CLI.** TracePilot drives the user's installed `copilot`.
   `.cargo/config.toml` sets `COPILOT_SKIP_CLI_DOWNLOAD=1`, so no build
   downloads, caches, or embeds CLI artifacts. The bridge resolves `copilot`
   through PATH (preferring a native executable) and always passes
   `CliProgram::Path`, including for `Transport::External`. This also works
   around the SDK resolving a program for external transports.

3. **Transport mapping.** No CLI URL means `Transport::Stdio`, a private
   TracePilot-owned CLI process. A CLI URL (`host:port`, optionally with a
   scheme) means `Transport::External` to an already-running server.

4. **Observer semantics for attach.** Sessions resumed by TracePilot install
   no permission, elicitation, user-input, or plan handlers. Prompts therefore
   stay with the terminal that owns the session. Detaching always uses
   `Session::disconnect()`, which leaves on-disk state untouched. TracePilot
   never writes `session.shutdown` into a session it attached to.

5. **Owned sessions need an explicit permission policy.** Sessions created by
   TracePilot's SDK launcher approve all permission requests only when the
   launch has *Auto-approve* enabled. Otherwise they install no handler, and
   the runtime denies tool permissions. An interactive handler is planned.

6. **Tests use the real SDK.** Bridge unit tests connect a real
   `github_copilot_sdk::Client` to an in-memory, scripted JSON-RPC peer through
   `Client::from_streams`. They do not fabricate SDK session objects.

7. The runtime preference guard (ADR-0007) and the connection state machine,
   broadcast channels, and metrics (ADR-0009) are unchanged by this ADR.

## Consequences

**Good.**

- Wire-level workarounds are deleted. Method names, event shapes, and protocol
  versions come from the vendor's generated schema.
- Builds are offline and deterministic with respect to the CLI, and the binary
  does not grow by an embedded CLI.
- Detaching from a user's session no longer mutates its history beyond the
  single `session.resume` event that any resume writes.
- Bridge tests exercise the real SDK router and event loop.

**Trade-offs.**

- The SDK and the CLI both release roughly weekly. An exact pin means each bump
  is a deliberate change that must be smoke-tested against a current CLI.
- `native-tls` (SChannel on Windows, OpenSSL elsewhere) enters the dependency
  graph through the SDK's HTTP and WebSocket forwarding code, next to the
  workspace's `rustls` stack. Because Cargo unifies reqwest features,
  native-tls would become the default backend for TracePilot's own reqwest
  clients, so outbound HTTPS clients call `use_rustls_tls()` explicitly.
- Without a bundled CLI, SDK features that depend on the bundled runtime
  (in-process transport, `install_bundled_cli`) are unavailable. TracePilot
  does not need them.
- Attaching still appends one `session.resume` event per resume. The attach
  design must resume at most once per session per connection.

## Alternatives considered

1. **Keep the community crate and patch it.** Rejected: it is unmaintained,
   it already lags the CLI schema, and every protocol change would need a fork.
2. **Enable `bundled-cli` and ship the SDK's CLI.** Rejected: it adds a large
   artifact, downloads at build time, and would run a different CLI version
   from the one that wrote the user's sessions. That reintroduces the
   schema-mismatch failures documented in ADR-0009.
3. **Talk JSON-RPC directly without an SDK.** Rejected: it duplicates the
   vendor's generated types and router, which is the maintenance burden this
   ADR removes.
4. **Keep private stdio "resume" for observing running sessions.** Rejected:
   verified to produce an isolated copy that sees no live activity. Sending
   through it would fork history.

## References

- [Copilot live attach plan](../features/copilot-live-attach-plan.md) —
  findings F1–F18 and the phased roadmap.
- ADR-0007 — SDK always compiled in, gated at runtime.
- ADR-0009 — bridge lifecycle; `destroy` semantics are amended by decision 4
  above.
- `crates/tracepilot-orchestrator/src/bridge/` — implementation.
