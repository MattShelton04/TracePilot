# Trust boundary

Fix one concrete, reachable weakness in how one boundary validates or handles untrusted input.

**Size:** larger. **When:** periodically, or after changes to a boundary. **Protocol:** read [protocol.md](../protocol.md) sections Core, Rust and IPC, and Ship. To reproduce something in the app, also read Running the app.
<!-- protocol: core rust app? ship -->

## Launch

```text
Read docs/agents/tasks/trust-boundary.md and follow it. Focus: .tpx.json import.
```

## Boundaries

First read [CSP](../../security/csp.md), [permissions](../../security/permissions.md), and ADRs [0011](../../adr/0011-tauri-capability-scoping.md), [0012](../../adr/0012-filesystem-trust-boundary.md) and [0014](../../adr/0014-bounded-loopback-context-capture.md).

- **Session files** (JSONL, YAML, SQLite) can be malformed, truncated, huge or hostile.
- **The Explorer.** The path jail is in `crates/tracepilot-tauri-bindings/src/commands/file_browser/security.rs`. Also check the SQLite, JSON, CSV, Markdown and image viewers.
- **Markdown and HTML in the WebView.** Check `MarkdownContent` sanitization, link handling, and the CSP (`node scripts/check-csp.mjs`).
- **Export redaction** (`crates/tracepilot-export/src/redaction`).
- **`.tpx.json` import.** The pipeline is parse, migrate, validate, then write a session directory, with no archive extraction. Check the identifiers and paths it rebuilds when writing, its JSON size and resource limits, its schema validation, and where it writes.
- **Launcher and worktree command construction.** Look for argument injection and missing canonicalization (ADR 0004 and ADR 0012).
- **Other boundaries:** skill import through `gh`, the loopback context-capture server, and Tauri capabilities.

## Do

1. Read the real callers and the supported input contract. Find a specific weakness that can be reached, and confirm it with **harmless local fixtures only**. Never scan or exploit live services. Use synthetic secrets when you test redaction.
2. Fix it at the right layer with the smallest compatible change, preferring a shared helper over scattered checks. Valid legacy data must keep working. Every limit you add needs a stated reason.
3. Test that unsafe input is rejected *and* that valid edge cases are still accepted. Check sibling callers so the fix can't be bypassed another way.

**Disclosure.** The repository is public. If you find a *serious, exploitable* vulnerability, don't push it or describe it publicly. Keep the work local and give the details in your final handover. Low-risk hardening can go in a normal PR with a neutral description.

Don't build a security framework, weaken capabilities or the CSP, quietly turn invalid input into success, or claim the whole app is secure.

## Done when

One boundary behaves safely and predictably, and regression tests cover both rejected and accepted input.
