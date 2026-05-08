# Performance Dashboard

Central index for TracePilot performance benchmarks, budgets, and historical
trends. This page links the everyday playbook, the CI benchmark workflow, and
the machine-readable budgets used to gate regressions.

## Contents

- [Performance Budgets](#performance-budgets)
- [Running Benchmarks Locally](#running-benchmarks-locally)
- [CI Benchmark Workflow](#ci-benchmark-workflow)
- [Latest Results](#latest-results)
- [Historical Trends](#historical-trends)
- [Related Docs](#related-docs)

## Performance Budgets

Budgets are declared in [`perf-budget.json`](../../perf-budget.json) at the
repo root and grouped by surface:

| Group      | What it covers                                                             |
| ---------- | -------------------------------------------------------------------------- |
| `frontend` | Bundle size, largest chunk, initial-load chunk count                       |
| `ipc`      | P95 latency targets for Tauri IPC commands                                 |
| `render`   | Vue mount-to-paint budgets (dev-only `useRenderBudget` composable)         |
| `rust`     | Criterion benchmark budgets (`parsing`, `analytics`, `indexer` suites)     |

The Rust budgets are enforced by the
[`Benchmarks`](../../.github/workflows/benchmark.yml) workflow; the frontend
budgets are enforced by [`bundle-analysis.yml`](../../.github/workflows/bundle-analysis.yml).

## Running Benchmarks Locally

The Rust benchmarks live in the [`tracepilot-bench`](../../crates/tracepilot-bench)
crate and use Criterion.

```bash
# Run every benchmark suite
cargo bench -p tracepilot-bench

# Run a single suite
cargo bench -p tracepilot-bench --bench parsing
cargo bench -p tracepilot-bench --bench analytics
cargo bench -p tracepilot-bench --bench indexer
cargo bench -p tracepilot-bench --bench batch_size
cargo bench -p tracepilot-bench --bench ipc_hot_path

# Compare against a saved baseline
cargo bench -p tracepilot-bench -- --save-baseline before
# ... make changes ...
cargo bench -p tracepilot-bench -- --baseline before
```

Criterion writes HTML reports to `target/criterion/` — open
`target/criterion/report/index.html` in a browser for graphs. See
[`docs/performance-playbook.md`](../performance-playbook.md) for profiling,
flamegraph, and PGO workflows.

## CI Benchmark Workflow

The [`Benchmarks`](../../.github/workflows/benchmark.yml) workflow is
**manual-only** (`workflow_dispatch`). Trigger it from the GitHub Actions tab
when you want a fresh perf snapshot or are validating a perf-sensitive change.

Each run:

1. Executes `cargo bench -p tracepilot-bench`.
2. Extracts mean estimates into `benchmark-output.json`.
3. Checks the `rust` section of `perf-budget.json` and fails if budgets are
   exceeded.
4. Uploads the full Criterion HTML report tree as the
   `criterion-reports-<run-number>` artifact (90-day retention).
5. Pushes the JSON timeseries to the `dev/bench` data dir via
   [`benchmark-action/github-action-benchmark`](https://github.com/benchmark-action/github-action-benchmark)
   for trend tracking.

## Latest Results

Latest CI artifacts: see the most recent successful run on the
[`Benchmarks` workflow page](../../.github/workflows/benchmark.yml). Download
the `criterion-reports-*` artifact and unzip into [`results/`](./results/) to
browse the HTML reports locally.

The [`results/`](./results/) directory is gitignored (artifacts are large and
reproducible from CI), so committed snapshots live under `results/README.md`
when we want to pin a reference baseline.

## Historical Trends

Long-term trend data is published by the CI workflow to the `dev/bench` data
directory via `benchmark-action/github-action-benchmark`. Once the workflow
has run on the default branch, charts will be available at
`https://<org>.github.io/TracePilot/dev/bench/` (GitHub Pages must be enabled
for the repo). Until then, trends can be reconstructed by downloading the
`criterion-reports-*` artifacts from past workflow runs.

> **Placeholder**: link the published GitHub Pages dashboard URL here once it
> goes live.

## Related Docs

- [`docs/performance-playbook.md`](../performance-playbook.md) — profiling, flamegraphs, PGO
- [`perf-budget.json`](../../perf-budget.json) — machine-readable budgets
- [`crates/tracepilot-bench/`](../../crates/tracepilot-bench/) — Criterion suites
- [`.github/workflows/benchmark.yml`](../../.github/workflows/benchmark.yml) — CI workflow
- [`.github/workflows/bundle-analysis.yml`](../../.github/workflows/bundle-analysis.yml) — frontend bundle budgets
