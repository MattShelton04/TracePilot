# Performance probes

Performance and bundle probes and their comparison contracts. Some launch a
native app or read selected data and write ignored `.tracepilot/perf/`; review
the command first. Methods and usage are in the
[performance playbook](../../docs/performance-playbook.md).

- `check-bundle.mjs` — measures the desktop bundle against its budgets for the bundle-analysis workflow; `publish-bundle.mjs` posts its result from the trusted workflow.
- `compare.mjs` — offline comparison of compatible native desktop runs.
- `criterion-compare.mjs` — summarises a same-runner Criterion base/head comparison.
- `desktop.mjs` — real Windows desktop measurements against an isolated release app.
- `indexing.mjs` — native first-setup and full-rebuild measurements over owned, isolated corpora.
- `ipc.mjs` — warm native Tauri round trips; complements `desktop.mjs`.
- `probe-compare.mjs` — same-runner base/head comparison of backend phases with wall time and peak memory.
- `summarize-benchmarks.mjs --criterion=target/criterion --budget=perf-budget.json` — nightly aggregation. Requires `BENCHMARK_SUITES`, `BENCHMARK_RESULT`, `BENCHMARK_DOWNLOAD_RESULT` and `BENCHMARK_CONTRACT_RESULT`; writes `benchmark-output.json`, `benchmark-summary.md` and `benchmark-contract.log` even for incomplete runs, which exit nonzero.
- `verify-desktop.mjs` — correctness and interaction checks on the real app; mutates only an owned synthetic fixture.

Tests: `node --test scripts/perf/*.test.mjs`. `private-snapshot.mjs` is an
[audit-only helper](../README.md#audit-only-helpers).
