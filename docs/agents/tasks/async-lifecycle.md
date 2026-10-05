# Async and lifecycle correctness

Fix one demonstrated race or resource leak.

**Presets** (both focused):
- `stale-result`: an older request overwrites newer intent.
- `resource-cleanup`: a leaked or duplicated listener, timer, watcher, task or process.

**Protocol:** read [protocol.md](../protocol.md) sections Core and Ship. Also read Rust and IPC for Rust targets, and Running the app to confirm a fix in the UI.
<!-- protocol: core rust? app? ship -->

## Launch

```text
Read docs/agents/tasks/async-lifecycle.md and follow it. Preset: stale-result. Focus: switching sessions quickly in session detail.
```

## `stale-result`

Plausible places for a stale result to win:
- switching sessions or tabs quickly;
- search typing and facet changes;
- changing analytics time ranges or filters;
- auto-refresh and live updates racing a manual refresh;
- quick file selection in the Explorer;
- path validation in setup or settings.

1. Read how the target store already handles this. That may be `runAction`/`runMutation`, `useAsyncGuard`, `useCachedFetch` or its own lifecycle.
2. **Prove the race.** Start two operations and resolve them in the problematic order, using `packages/test-utils/src/deferred.ts`. Show the wrong final state.
3. Fix it with the store's existing mechanism:
   - The latest valid request wins.
   - A stale error can't replace a newer success.
   - Loading state never gets stuck.
   - Cleanup doesn't cancel unrelated work.

   Remember that cancelling a request doesn't stop a late completion from arriving.

Don't serialize requests, add debounces or retries to hide the race, or touch Rust indexing and reset coordination without evidence. Those already have dedicated tests.

## `resource-cleanup`

Candidates:
- Frontend:
  - Tauri `listen()` calls whose unlisten function is never called;
  - auto-refresh and countdown timers;
  - watchers in composables outside components, which need `onScopeDispose`;
  - observers in charts and the timeline;
  - global key handlers;
  - pop-out windows;
  - listeners registered twice when a store re-hydrates.
- Rust:
  - spawned tokio tasks;
  - file watchers;
  - SDK bridge connections (ADR 0009 and ADR 0016);
  - the context-capture loopback server (ADR 0014);
  - orchestrator child processes (ADR 0004).

1. Work out who owns the resource, then **demonstrate** the leak. For example, show listener counts growing across mount/unmount cycles, a timer firing after unmount, or a task that outlives its owner. A missing cleanup call nearby is a clue, not proof.
2. Fix it with the smallest pattern already used in the code. Cleanup must be idempotent, safe after partial initialization, and must never shut down a resource that something else still uses.
3. Test it:
   - Vitest: repeated mount and unmount with fake timers, checking that counts return to baseline.
   - Rust: drop or cancel the owner and assert the task ends. Test orchestrator processes with `cargo test -p tracepilot-orchestrator`.

## Done when

The race or leak is reproduced by a deterministic test, fixed with the existing pattern, and normal behavior is unchanged.
