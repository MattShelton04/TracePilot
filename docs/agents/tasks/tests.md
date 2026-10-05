# Behavioral tests

Protect behavior that users would notice if it broke and that no meaningful test guards today.

**Presets:**
- `regression` (focused, the default): one important edge case.
- `subsystem` (larger): a focused set of tests for one risky subsystem.

**Protocol:** read [protocol.md](../protocol.md) sections Core and Ship. If you test Rust code, also read Rust and IPC.
<!-- protocol: core rust? ship -->

## Launch

```text
Read docs/agents/tasks/tests.md and follow it. Preset: subsystem. Focus: export redaction.
```

## Where the risk is

- **Copilot CLI parsing and reconstruction.** Unknown or new events, missing optional fields, a truncated last line, subagent and turn boundaries, model switches and compactions. See `crates/tracepilot-core/tests/`, which holds the schema compatibility, accounting contract and CLI turn parity tests.
- **The indexer.** Incremental add, edit and remove; FTS edge cases (quotes, operators, non-ASCII); migrations; analytics queries.
- **Export and import.** Redaction, the section filters, and `.tpx.json` round trips.
- **The orchestrator.** Worktree operations against temporary git repositories, and launcher argument construction.
- **tauri-bindings.** File-browser path security and config migration.
- **Desktop stores.** Hydration, error slots and stale-response guards. Use `@tracepilot/test-utils`: `builders`, `deferred` and `pinia`.

## How

- Choose cases from the code's contract and the risks you can name. A coverage percentage or a test count is not a goal.
- Assert outcomes users would care about, not private details and not just "a mock was called".
- Control clocks and promise ordering. Use no sleeps and no network.
- Keep fixtures small and synthetic. Never copy real session JSONL.
- For each test that guards a behavior, show it can fail for that *behavioral* reason. One way is to temporarily invert the relevant logic and watch the test fail, then restore the code. Note in the PR what you broke.
- If a test exposes a real bug, show the failure first, then fix it narrowly. Otherwise a tests-only PR is the intended outcome.
- Don't add test frameworks, giant snapshots or tests coupled to incidental DOM structure, and don't refactor production code beyond a minimal test seam.

## Done when

Previously unprotected, user-relevant behavior is guarded by understandable tests, and the PR names the risks those tests cover.
