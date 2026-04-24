# ADR-0008 — MCP server hosting model

- **Date:** 2026-04-19
- **Status:** Accepted

> **Note.** MCP (Model Context Protocol) is still evolving upstream. This
> ADR captures the shape we ship today; sections marked _Subject to
> revision_ are expected to change as the upstream spec stabilises.

## Context

Copilot CLI consumes MCP servers through a shared `mcp-config.json` file
in the Copilot home directory (`~/.copilot/mcp-config.json`). TracePilot
is a second consumer of that same config file — it reads, diffs, edits,
imports, and health-probes the server catalogue on behalf of the user,
but it does **not** itself host or proxy any MCP server: the CLI is the
only process that speaks MCP to a running server.

Two consequences fall out of this split:

1. **We manage configuration, not lifetime.** TracePilot persists servers
   via `mcp::config::{load_config, save_config}` (atomic writes under a
   static `CONFIG_LOCK`) and exposes add / update / remove / toggle
   operations. The CLI owns connection lifetime — it spawns stdio
   subprocesses or dials HTTP/SSE endpoints itself when a session runs.
2. **Our probes must look like real MCP clients.** Health probes run a
   full JSON-RPC handshake (`initialize` → `notifications/initialized`
   → `tools/list`) so a server that negotiates badly is caught at
   configure-time, not mid-conversation. Probes are ad-hoc (triggered
   from the frontend via `mcp_check_health` / `mcp_check_server_health`
   IPC commands) rather than a background cadence, so the desktop UI is
   authoritative about when a check happens and the backend adds no
   timer of its own.

Third, because the user supplies raw URLs for HTTP-transport servers,
TracePilot is the natural point to enforce an SSRF policy — the CLI
trusts whatever it's told to dial.

## Decision

1. **Scope.** `crates/tracepilot-orchestrator/src/mcp/` owns all MCP
   concerns outside of actually speaking the protocol during a Copilot
   turn. Submodules: `config` (read / write / mutate
   `mcp-config.json`), `diff` (compare two catalogues), `import`
   (pull servers from a foreign config file), `health` (probe a server
   + cache discovered tools), `url_policy` (SSRF classifier), `headers`
   (HTTP header sanitisation), `types` (shared DTOs), `error`
   (`McpError` — see ADR-0005).

2. **Transport dispatch.** `health::check_single_server` switches on
   `McpServerConfig::effective_transport()` to hand off to
   `health::stdio::check_stdio_server` or
   `health::http::check_http_server`. `check_all_servers` fans out via
   `tokio::task::JoinSet` so total latency is bounded by the slowest
   single probe rather than the sum of probes, and disabled servers are
   short-circuited to `Status::Disabled` without any I/O.

3. **Stdio probes use `hidden_command`.** Subprocesses are spawned via
   `crate::process::hidden_std_command`, which on Windows sets the
   `CREATE_NO_WINDOW` creation flag (see ADR-0004 — background-process
   discipline). A probe that succeeds or times out is always reaped
   (`kill_and_reap`) so we never leak children.

4. **HTTP probes enforce a URL policy on every hop.** Before any request
   fires, `url_policy::validate_mcp_url_async` rejects:
   non-`http(s)` schemes; IP-literal hosts in private / link-local /
   broadcast / multicast / unspecified / CGNAT ranges; IPv6 ULAs;
   hostnames whose first DNS resolution lands in any of the above.
   **Loopback (`127.0.0.0/8`, `::1`, `localhost`) is permitted** —
   local MCP servers (CLI helpers, containerised tools) are a
   first-class MCP deployment shape, and the SSRF risk on a
   single-user desktop app targeting its own loopback is materially
   lower than on a web service. **IPv4-mapped (`::ffff:a.b.c.d`) and
   IPv4-compatible (`::a.b.c.d`) IPv6 literals are normalised to IPv4
   before classification** so `http://[::ffff:10.0.0.1]/` cannot slip
   past the V4 checks — this class of bypass was closed after initial
   triage and the gap is now covered by dedicated regression tests in
   `url_policy::tests`.

5. **Redirect chains re-enter the policy.** `check_http_server`
   installs a custom `reqwest::redirect::Policy` that re-validates
   every redirect target against the same `validate_mcp_url` and caps
   the chain at 5 hops. A hostile 302 to a private RFC1918 address is
   therefore rejected even though the initial URL was public.

6. **Error taxonomy.** `McpError` (see ADR-0005) enumerates the failure
   shapes — config IO, JSON parse, validation, health taxonomy. Probe
   results are surfaced as `McpHealthResult` with an explicit
   `McpHealthStatus` enum (`Healthy` / `Unreachable` / `Disabled` /
   `Unhealthy`) and a cached `Vec<McpTool>` discovered at probe time.

7. **No background probe cadence (today).** Health checks are driven
   from the frontend via the IPC commands listed above. There is no
   backend scheduler, no periodic refresh, and no persistent
   health-cache store — each probe is a fresh round-trip. Subject to
   revision once we have product data on probe cost and desired
   freshness.

## Consequences

**Good.**

- Configuration edits and probes are fully observable from a single
  crate; the desktop can show diffs + health without teaching the
  frontend to speak MCP.
- The URL policy is a single chokepoint — adding new SSRF classes
  (e.g. a future IPv6 /3 bogon range) is a one-file change with
  existing test coverage conventions.
- Parallel `JoinSet` probes keep UX responsive as the catalogue grows.
  Stdio spawn + reap discipline keeps us honest against zombie
  processes even when a server hangs.

**Trade-offs.**

- We duplicate the handshake logic the CLI also implements. When the
  MCP spec changes, both code paths need updating; our probe is not a
  reference implementation.
- On-demand health means a user viewing the MCP manager sees
  point-in-time status — there is no "was healthy 30s ago" cache to
  fall back on after a transient blip.
- DNS-rebind TOCTOU (address changes between our pre-check and the
  OS-level resolution at request time) is **not** mitigated at this
  layer. Defence is delegated to the OS and to `reqwest` (which
  re-resolves per request) plus the redirect-policy check.

## Alternatives considered

1. **Proxy all MCP traffic through TracePilot.** Rejected: duplicates
   CLI functionality, doubles the protocol-version burden, and adds a
   hot path we'd have to keep up with upstream changes to. The CLI is
   authoritative for MCP IO during sessions.
2. **Periodic backend health poller with cached results.** Rejected for
   wave 1 in favour of explicit frontend-driven probes; avoids a whole
   class of "stale cache vs live state" bugs until we have concrete
   product requirements for freshness. Can be reintroduced if needed.
3. **Permit loopback + RFC1918 unconditionally.** Rejected for RFC1918:
   a malicious MCP config could still probe home-router admin panels
   or corporate intranets. Loopback alone is permitted (wave 2 above)
   because the threat model on a single-user desktop app reaching its
   own loopback is materially weaker than reaching arbitrary private
   network peers. A future iteration may add an explicit per-server
   allow-list flag for power users who genuinely want to target an
   RFC1918 address.
4. **Skip the URL policy and rely on the HTTP client / OS.** Rejected:
   `reqwest` has no SSRF opinion, the OS never will, and the attack
   surface (user-supplied URLs) warrants a first-class classifier.

## References

- `crates/tracepilot-orchestrator/src/mcp/mod.rs` — module layout.
- `crates/tracepilot-orchestrator/src/mcp/health/mod.rs` — probe
  orchestration; `runner.rs`, `stdio.rs`, `http.rs`.
- `crates/tracepilot-orchestrator/src/mcp/url_policy.rs` — SSRF
  classifier, IPv4-mapped normalisation, per-redirect validation.
- `crates/tracepilot-orchestrator/src/mcp/config.rs` — atomic
  `mcp-config.json` IO.
- `crates/tracepilot-tauri-bindings/src/commands/mcp.rs` —
  `mcp_check_health` / `mcp_check_server_health` IPC entry points.
- ADR-0004 — background-process discipline (`hidden_command`,
  `CREATE_NO_WINDOW`).
- ADR-0005 — `thiserror`-per-crate error model (`McpError`).
