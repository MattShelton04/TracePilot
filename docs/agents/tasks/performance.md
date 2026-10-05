# Performance

Reduce one measured bottleneck in a representative workload without changing behavior.

**Size:** larger. **Protocol:** read [protocol.md](../protocol.md) sections Core, Rust and IPC, and Ship. To measure in the app, also read Running the app.
<!-- protocol: core rust app? ship -->

## Launch

```text
Read docs/agents/tasks/performance.md and follow it. Focus: opening a 2,000-turn conversation.
```

## Tools already in the repository

Read the [performance playbook](../../performance-playbook.md), including its quick bottleneck-finding workflow, then use:
- **Criterion benches** (`crates/tracepilot-bench/benches/`: `parsing`, `indexer`, `analytics`, `ipc_hot_path`, `batch_size`), with `pwsh -File scripts/bench.ps1 -Save|-Compare -Baseline <name>`. Run `just bench-flamegraph <bench>` if you have the profiler.
- **IPC timings in the app.** Clear the buffer, then read `window.__TRACEPILOT_IPC_PERF__?.getIpcPerfLog()`. The budgets are in `perf-budget.json`. `node scripts/e2e/perf-profile.mjs --instance <slug>` runs repeatable flows against your named instance.
- **A release binary** for realistic numbers: `pnpm app:start -Runtime production -Instance <slug> -DataRoot <synthetic corpus>`. Without `-Fixtures`, a new corpus opens on the setup wizard; complete it before measuring.
- `EXPLAIN QUERY PLAN` for indexer queries, and the `scripts/perf/` probes.
- **The `benchmark-compare` workflow**, which runs automatically on PRs that touch Rust and can also be dispatched manually. Its results on your PR are useful extra evidence.

Build synthetic corpora with the bench builders (`crates/tracepilot-bench/src/{builder,profiles}.rs`) or the fixture generators. **Never use private sessions.**

## Do

1. **Measure a baseline.** Record the workload, its size, debug or release, cold or warm, and enough repeats to know the noise.
2. **Find the bottleneck** with a profiler, call counts, IPC logs or query plans, not by guessing.
3. **Make the simplest fix.** Preserve correctness, ordering, freshness, cancellation and memory bounds. Keep the indexing budgets documented in the playbook. A new cache or new concurrency must show a benefit and have a clear invalidation story.
4. **Measure again the same way.** Report before and after numbers with their spread, and check memory where you might be trading one cost for another. **If there's no demonstrated gain, revert it.**

Don't hide rows, reduce fidelity, add stale caches, virtualize lists without a separate decision (see `docs/perf/desktop-virtualization-audit.md`), or extrapolate from a microbenchmark.

## Done when

One real workload is measurably faster or lighter, behavior is unchanged, and the method and numbers are in the PR.
