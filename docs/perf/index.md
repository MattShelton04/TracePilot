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
- [Optimization Comparisons](#optimization-comparisons)
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

## Optimization comparisons

These comparisons use Windows release builds on a Ryzen 5 3600 with 16 GiB RAM,
Rust 1.94.0 and WebView2 154.0.4258.62. The original product is `d95f6d81`.
Baseline and candidate processes ran serially in alternating order, with no
competing builds, tests or app instances. OS file caching was uncontrolled.
Medians below describe separate workloads; their percentages must not be added.

| Facet | Workload | Baseline median [range] | Individual change median [range] | Evidence |
| --- | --- | --- | --- | --- |
| Conversation | Warm native route, 4,000 turns / 12,000 tools / 800 agents | 3,686.1 [3,532.1–3,964.3] ms | 3,388.0 [3,276.7–3,540.4] ms | Six warm samples per side; [#1020](https://github.com/MattShelton04/TracePilot/pull/1020) |
| Search database | Unfiltered browse facets, 600 sessions / 300,000 rows | 982.9 [965.7–988.7] ms | 132.5 [129.1–139.0] ms | Five fresh processes per side; [#1022](https://github.com/MattShelton04/TracePilot/pull/1022) |
| Search database | Browse page plus exact count, same index | 28.03 [27.57–29.20] ms | 8.33 [8.01–8.75] ms | One operation warm-up in each process; complete output digests equal |
| Export | Full JSON, 2,000 turns / 8,000 tools / 24,001 events | 502.1 [497.7–522.7] ms | 310.4 [304.1–313.2] ms | Six fresh processes per side; [#1021](https://github.com/MattShelton04/TracePilot/pull/1021) |
| Export | Markdown sharing, same 36.8 MB source | 274.2 [271.4–279.4] ms | 188.3 [182.3–192.0] ms | Complete normalized output SHA-256 equal for every sample |
| Source parsing | Frozen local sample, 116.9 MB / 31,666 events | 426.9 [415.9–446.1] ms | 338.3 [334.9–353.5] ms | Six fresh processes per side; [#1023](https://github.com/MattShelton04/TracePilot/pull/1023) |
| Source parsing | Synthetic export workload, 36.8 MB / 24,001 events | 116.6 [112.6–119.6] ms | 90.7 [86.1–106.3] ms | Complete parsed-record and diagnostic hashes equal |
| Initial indexing | 1,000 sessions / 136,930 events / 37,581 tools | 4,022 [3,925–4,252] ms | 3,512 [3,446–3,885] ms | Five fresh processes per side; [#1025](https://github.com/MattShelton04/TracePilot/pull/1025) |
| Index refresh | Same corpus, unchanged metadata and search | 440 [433–471] ms | 291 [289–298] ms | Fresh backups of the completed original index; complete output parity |

The conversation change separates tool lookup from unused agent grouping and
computes disclosure metadata once per group. It retains every mounted row and
its state. Native warm long-history navigation improved 8.1%; small and dense
tool-only workloads overlapped and do not establish a speedup. The endpoint is
the expected mounted turn count, first visible message and two animation
frames, not full-scroll smoothness. Backend data was prewarmed before the first
visit, so these are not cold-start measurements.

Search aggregates omit the sessions join only when no source/repository filter
requires it. Result rows and repository facets retain the join. This preserves
exact counts, filtering, facet self-exclusion and ordering without a migration,
new index or result cache. Browse facets improved 86.5%; common-term FTS facets
improved 19.6%. These are SQLite library measurements, not native route latency.
The separate [schema audit](https://github.com/MattShelton04/TracePilot/pull/1024)
also checked eight join-removal query shapes on a frozen local database, with
complete result parity. Its alternate SQLite runtime provides supporting SQL
diagnostics; those timings are not combined with the release-build results here.

Export reuses reconstructed data, moves selected raw events and streams hashing
over borrowed sessions. Full JSON peak working set fell from 310.5 to 229.6 MiB;
Markdown sharing fell from 234.2 to 166.8 MiB. Measurements cover archive
construction/filtering/rendering, excluding desktop IPC, dialogs and final file
writes. The archive and final output are still resident in memory.

The parser uses a 256 KiB file buffer and the standard library's newline search,
while preserving cancellation checks after at most 8 KiB scanned and between
records. It adds 248 KiB per active reader. Seventy-two comparisons cover small
records, large tool outputs and two frozen local sessions; all output hashes
match. These parsing gains do not establish an equal reduction in total indexing
time. Filesystem reads and each record's JSON decode remain non-preemptible.

Startup discovery skips marker flags unused by the indexing provider, freshness
checks avoid source I/O where stored state already proves staleness, and summary
enrichment avoids discarded turn statistics. Strict source validation and public
discovery flags remain intact. First indexing improved 12.7%, including metadata,
search writes and final maintenance; unchanged refresh improved 33.9%. These
are backend measurements with uncontrolled filesystem caching, not native
first-launch timings. All 20 accepted runs match indexed data and ranked FTS
results, with no deferred merge work. First-index peak memory is essentially
unchanged. A separate 3.36 GB corpus passed compatibility checks; its smaller
diagnostic timing difference does not establish a speed gain.

Regression coverage includes work-count and attached-DOM tests, a legacy SQL
oracle across filter combinations, and exact legacy export bytes/hashes.
Independent reviewers checked both code and reported statistics. Interrupted
and contended runs are excluded from accepted evidence. Raw results, preserved
executables and corpus manifests remain in ignored local evidence directories;
PR descriptions include revision identities and reproduction commands.

Three additional indexing changes were screened on frozen 1,000-session and
500-session corpora, with two fresh processes per side and complete final
maintenance. Continuous statement reuse, changing the adaptive FTS rebuild
selection, and bounded JSON text flattening preserved indexed output but did
not demonstrate a meaningful whole-index or peak-memory benefit. They are
excluded from the combined changes; these diagnostic samples do not establish
that the rejected changes are regressions.

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
