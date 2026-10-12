# Performance Dashboard

Central index for TracePilot performance benchmarks, thresholds, and retained
run artifacts. This page links the everyday playbook, the CI benchmark
workflow, and the machine-readable performance contract.

## Contents

- [Performance Budgets](#performance-budgets)
- [Application Performance Map](#application-performance-map)
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

## Application Performance Map

TracePilot's ordinary read flows cross Vue, the typed client, Tauri commands,
provider adapters and SQLite. Measure the layer being changed, then exercise
the complete native flow: a faster query does not imply an equally large change
in route-to-paint time.

| Facet | Runtime path | Main cost and existing bounds | Measurement |
| --- | --- | --- | --- |
| Startup and session list | Lazy routes → Pinia sessions store → `list_sessions` → SQLite session summaries; background source discovery/indexing | Indexed summaries avoid reparsing every log; the frontend precomputes filter text | Native first/warm navigation, IPC log, indexing probe |
| Source ingestion | Copilot JSONL / Claude transcript → provider snapshot → typed events → turns and summary | JSON decoding, retained raw/typed payloads and reconstruction; fingerprint freshness and cancellation must survive optimizations | `parsing` Criterion suite; phase-one indexing; complete output equivalence |
| Index writes | Bounded parallel preparation → ordered SQLite writer → normalized analytics and FTS5 rows | Parsing, row insertion and FTS maintenance; batch memory and cancellation budgets are in the playbook | `index_probe`, `indexing_workloads`, peak working set and cancellation latency |
| Search | Search store → content results + exact count + self-excluding facets → SQLite B-tree / FTS5 queries | Broad result sets make aggregate scans costly; facet caches invalidate on database changes | Query plans and separate result/count/facet timings, then native Search |
| Analytics and Metrics | Cached store request → SQL aggregates over normalized child tables → dashboard/charts | Aggregation and chart construction; respect source/date/repository filters and cache freshness | `analytics` and `ipc_hot_path` benches; native filtered dashboard |
| Session detail and IPC | Section loaders → source-version event/turn caches → IPC preparation → serde/Tauri transport | Large response serialization and transfer; caches are bounded and source-sensitive | Native IPC timing with payload equality, cold and warm calls separately |
| Conversation rendering | Turns → view-mode grouping / tool lookup → content-visibility chunks → turn/tool components | Repeated grouping, reactive traversals, Markdown, layout and DOM size | Deterministic work-count tests plus native route-to-paint, long tasks and heap |
| Export | Source snapshot → section selection / redaction → Markdown or JSON renderer | Reconstruction, payload copies, JSON serialization and content hashing | Exact byte/hash comparison, build/render time and process peak memory |
| Packaging and tooling | Vite lazy chunks + Rust release build; deterministic corpus builders | Startup assets and build cost are separate from steady-state app speed | Bundle report; native release build with recorded source and corpus identity |

Experimental Replay, MCP servers, Config Injector and SDK steering are outside
this map's optimization targets. The app's default workflows and common shared
paths take priority, following the [agent focus policy](../agents/focus.md).

### Parallel correctness work, serial measurements

Use separate worktrees and `pnpm app:start -Instance <name> -Fixtures` for native
verification. Each instance owns its data, WebView profile, lifecycle record and
registry-allocated ports. Use the printed Playwright attach command and stop
only instances started by the run. Isolation prevents state collisions; it does
not isolate CPU, memory bandwidth, filesystem cache or the machine's processes.

Build and run correctness tests in parallel within the machine's capacity.
Before accepting performance numbers, finish competing builds/tests and run one
timed workload at a time. Save separate baseline/head executables and alternate
their run order. Record the revision, release/debug profile, corpus size,
cache conditions, sample count, median and range. Keep raw data under ignored
agent directories; publish only synthetic or aggregate evidence. Check the
combined branch with the same workload before claiming integration preserved a
gain. Do not add percentages from different layers or workloads together.

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
