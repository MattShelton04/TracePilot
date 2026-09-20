# Performance Dashboard

Central index for TracePilot performance benchmarks, thresholds, and retained
run artifacts. This page links the everyday playbook, the CI benchmark
workflow, and the machine-readable performance contract.

## Contents

- [Performance Budgets](#performance-budgets)
- [Running Benchmarks Locally](#running-benchmarks-locally)
- [CI Benchmark Workflow](#ci-benchmark-workflow)
- [Latest Results](#latest-results)
- [Comparing Runs](#comparing-runs)
- [Related Docs](#related-docs)

## Performance Budgets

Thresholds are declared in [`perf-budget.json`](../../perf-budget.json) at the
repo root and grouped by surface:

| Group      | What it covers                                                               |
| ---------- | ---------------------------------------------------------------------------- |
| `frontend` | Enforced total size; advisory largest chunk and initial HTML asset count     |
| `ipc`      | Diagnostic P95 latency targets for Tauri IPC commands                        |
| `render`   | Dev-only Vue mount-to-paint warning thresholds                               |
| `rust`     | Advisory thresholds for required Criterion mean estimates                    |

The [`Benchmarks`](../../.github/workflows/benchmark.yml) workflow fails when
a required result is missing, malformed, or unmapped. Timing threshold
exceedances remain advisory on shared runners. The frontend workflow hard-gates
total JS + CSS size and reports its other two declared metrics as advisory.

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

The [`Benchmarks`](../../.github/workflows/benchmark.yml) workflow runs nightly
and can also be triggered manually from the GitHub Actions tab. It runs on a
shared Ubuntu runner; it is not an automatic pull-request gate and does not run
the native Windows desktop harness.

Each run:

1. Executes `cargo bench -p tracepilot-bench` against synthetic fixtures.
2. Requires corrected, populated results for parsing 1,000 events, analytics
   across 100 sessions, and common-term content search across 100 sessions.
3. Records Criterion's mean estimate and reported confidence interval, budget
   status, fixture/harness identity, revision, run, runner, Node, Rust, and
   `bench` profile provenance in `benchmark-output.json`.
4. Fails on missing, malformed, or unknown required data. Threshold
   exceedances are retained as advisory status.
5. Uploads the JSON, Markdown summary, checker log, and full Criterion report
   tree as `criterion-v2-nonempty-fixtures-<run-number>` with 90-day retention.

The workflow has read-only repository permission, does not update Pages, and
does not comment on pull requests.

## Latest Results

Latest CI artifacts: see the most recent successful run on the
[`Benchmarks` workflow page](../../.github/workflows/benchmark.yml). Download
the `criterion-v2-nonempty-fixtures-*` artifact and unzip into
[`results/`](./results/) to browse the HTML reports locally.

The [`results/`](./results/) directory is gitignored (artifacts are large and
reproducible from CI), so committed snapshots live under `results/README.md`
when we want to pin a reference baseline.

## Comparing Runs

There is no benchmark Pages publisher or durable timeseries. Compare compatible
runs by downloading their retained artifacts and checking the fixture,
harness, revision, runner, toolchain, and profile metadata before comparing
mean estimates. Shared-runner timings are diagnostic and artifacts expire
after 90 days.

Native Windows release measurements remain manual. Follow
[`crates/tracepilot-bench/README.md`](../../crates/tracepilot-bench/README.md)
and the performance mission report for the real-app command and isolation
requirements.

## Related Docs

- [`docs/performance-playbook.md`](../performance-playbook.md) — profiling, flamegraphs, PGO
- [`perf-budget.json`](../../perf-budget.json) — machine-readable thresholds
- [`crates/tracepilot-bench/`](../../crates/tracepilot-bench/) — Criterion suites
- [`.github/workflows/benchmark.yml`](../../.github/workflows/benchmark.yml) — CI workflow
- [`.github/workflows/bundle-analysis.yml`](../../.github/workflows/bundle-analysis.yml) — frontend bundle budgets
