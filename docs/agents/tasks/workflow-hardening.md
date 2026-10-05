# Workflow hardening

Fix a related cluster of real edge cases in one important end-to-end workflow.

**Size:** larger. **Protocol:** read [protocol.md](../protocol.md) sections Core, Running the app, Rust and IPC, and Ship. If the fix involves UI, also read UI.
<!-- protocol: core app rust ui? ship -->

## Launch

```text
Read docs/agents/tasks/workflow-hardening.md and follow it. Focus: incremental refresh while a session is still being written.
```

## Workflows

- First-run setup, then initial indexing, then browsing. Use `-Fixtures -FirstRun` with a fresh instance name to start on the setup wizard.
- Incremental refresh as sessions are added, edited or removed, including **running** sessions.
- Search, then opening a hit and landing on the right turn.
- A live session: auto-refresh, the prompt-cache countdown, and the watching state. Use synthetic sessions only, and never attach to real ones.
- **Export, then import:** a `.tpx.json` archive round trip. Markdown and raw exports are one-way, so check them separately for fidelity and redaction.
- Settings: change, save, restart and persist. Then **Reset Everything** and recover, following the [reset and recovery steps](../../testing.md) in the testing guide.
- The Session Launcher and the Worktree Manager, *up to command construction*. Use temporary git repositories, and never launch real Copilot sessions.

The native E2E suite (`tests/e2e`, run with `pnpm test:e2e` on Windows) already covers setup, indexing, browsing, search, refresh, settings and restart. Extend it rather than writing a parallel harness.

## Do

1. Follow the real path from the view to the store, the client, the command, the crate and persistence, then back to the UI.
2. Exercise the failure transitions the workflow actually supports: malformed input, repeated clicks, slow responses, navigating away, partial failure, a restart halfway through, and a missing dependency. Everything native runs on an isolated `-DataRoot`.
3. Reproduce the strongest findings, then fix a small *related* set at their roots. Protect each fix at the lowest level that reproduces it. Add an E2E journey only for behavior you can't observe any other way.
4. Messages must stay accurate, and the workflow must never report success before the operation completes.

Don't add generic retries, swallow errors, change data formats, or fix unrelated issues. List those in your handover instead.

## Done when

The workflow behaves predictably in its normal and relevant failure states, each fix has a regression test, and the evidence is reproducible.
