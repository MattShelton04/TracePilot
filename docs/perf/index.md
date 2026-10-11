# Performance Dashboard

Central index for TracePilot performance benchmarks, thresholds, and retained
run artifacts. This page links the everyday playbook, the CI benchmark
workflow, and the machine-readable performance contract.

## Contents

- [Performance Budgets](#performance-budgets)
- [Running Benchmarks Locally](#running-benchmarks-locally)
- [CI Benchmark Workflow](#ci-benchmark-workflow)
- [Latest Results](#latest-results)
- [Indexing Baseline](#indexing-baseline)
- [Comparing Runs](#comparing-runs)
- [Related Docs](#related-docs)

## Performance Budgets

Thresholds are declared in [`perf-budget.json`](../../perf-budget.json) at the
repo root and grouped by surface:

| Group      | What it covers                                                               |
| ---------- | ---------------------------------------------------------------------------- |
| `frontend` | Advisory total size, largest chunk, and initial HTML asset count             |
| `ipc`      | Diagnostic P95 latency targets for Tauri IPC commands                        |
| `render`   | Dev-only Vue mount-to-paint warning thresholds                               |
| `rust`     | Advisory thresholds for required Criterion mean estimates                    |

The [`Benchmarks`](../../.github/workflows/benchmark.yml) workflow fails when
a required result is missing, malformed, or unmapped. Timing threshold
exceedances remain advisory on shared runners. The frontend workflow reports
all three declared size metrics as advisory and fails only when required
measurement inputs are missing or invalid.

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
and can also be triggered manually from the GitHub Actions tab. Each declared
Cargo benchmark suite runs on a separate shared Ubuntu runner; it is not an
automatic pull-request gate and does not run the native Windows desktop harness.

Each run:

1. Discovers the benchmark targets from the crate's `Cargo.toml` and executes
   `cargo bench --locked -p tracepilot-bench --bench <suite>` against synthetic
   fixtures in parallel. The first declared suite is the sole main cache writer.
2. Requires corrected, populated results for parsing 1,000 events, analytics
   across 100 sessions, and common-term content search across 100 sessions.
3. Records Criterion's mean estimate and reported confidence interval, budget
   status, fixture/harness identity, revision, run, runner, Node, Rust, and
   `bench` profile provenance in `benchmark-output.json`.
4. Requires every declared suite to succeed and record the same Rust compiler.
   Compiler provenance is recorded before measurement, and suite outcomes and
   Cargo logs remain available after failures. Missing, malformed, or unknown
   required data also fail validation. Threshold exceedances remain advisory.
5. Uploads each suite's measurements, full HTML report tree and diagnostics as
   `criterion-suite-<suite>`. A separate
   `criterion-v2-nonempty-fixtures-<run-number>` artifact contains the combined
   JSON, Markdown summary and checker log. All artifacts have 90-day retention.
   Failed or incomplete runs retain an explicitly incomplete diagnostic summary;
   they cannot be used as successful baselines.

The workflow has read-only repository permission, does not update Pages, and
does not comment on pull requests.

## Latest Results

Latest CI artifacts: see the most recent successful run on the
[`Benchmarks` workflow page](../../.github/workflows/benchmark.yml). Download
the `criterion-v2-nonempty-fixtures-*` artifact for the combined summary. Download
the `criterion-suite-*` artifacts and unzip each into a separate directory under
[`results/`](./results/) to browse its full HTML report locally.

The [`results/`](./results/) directory is gitignored (artifacts are large and
reproducible from CI), so committed snapshots live under `results/README.md`
when we want to pin a reference baseline.

## Indexing Baseline

Whole-path indexing numbers (first index, incremental and live refresh, analytics
bump, rebuilds, source toggle) on a heavy two-source corpus, the method behind
them, and the Copilot-only comparison with v0.9.1 are in the playbook under
[Measuring the whole indexing path](../performance-playbook.md#measuring-the-whole-indexing-path).
Re-measure with the same method before claiming an indexing regression or gain.

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
