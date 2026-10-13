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
- [Combined Validation](#combined-validation)
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
| Conversation | Warm native route, 4,000 turns / 12,000 tools / 800 agents | 3,686.1 [3,532.1–3,964.3] ms | 3,388.0 [3,276.7–3,540.4] ms | Six warm visits per side, clustered within two processes; [#1020](https://github.com/MattShelton04/TracePilot/pull/1020) |
| Search database | Unfiltered browse facets, 600 sessions / 300,000 rows | 982.9 [965.7–988.7] ms | 132.5 [129.1–139.0] ms | Five fresh processes per side; [#1022](https://github.com/MattShelton04/TracePilot/pull/1022) |
| Search database | Browse page plus exact count, same index | 28.03 [27.57–29.20] ms | 8.33 [8.01–8.75] ms | One operation warm-up in each process; complete output digests equal |
| Export | Full JSON, 2,000 turns / 8,000 tools / 24,001 events | 502.1 [497.7–522.7] ms | 310.4 [304.1–313.2] ms | Six fresh processes per side; [#1021](https://github.com/MattShelton04/TracePilot/pull/1021) |
| Export | Markdown sharing, same 36.8 MB source | 274.2 [271.4–279.4] ms | 188.3 [182.3–192.0] ms | Complete normalized output SHA-256 equal for every sample |
| Source parsing | Frozen local sample, 116.9 MB / 31,666 events | 426.9 [415.9–446.1] ms | 338.3 [334.9–353.5] ms | Six fresh processes per side; [#1023](https://github.com/MattShelton04/TracePilot/pull/1023) |
| Source parsing | Synthetic export workload, 36.8 MB / 24,001 events | 116.6 [112.6–119.6] ms | 90.7 [86.1–106.3] ms | Complete raw-record and diagnostic hashes equal |
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
records. It adds 248 KiB per active reader. Seventy-two process runs (six per revision per workload across six
workloads, or 36 baseline/head pairs) cover small records, large tool outputs and
two frozen local sessions. All raw-record and canonical diagnostic hashes match;
typed payload serialization is not part of the hash oracle. These parsing gains do not establish an equal reduction in total indexing
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

Four additional indexing changes were screened on frozen 1,000-session and
500-session corpora, with two fresh processes per side and complete final
maintenance. Continuous statement reuse, changing the adaptive FTS rebuild
selection, bounded JSON text flattening and batch FTS coalescing preserved
indexed output but did not demonstrate a meaningful whole-index or peak-memory
benefit. Coalescing had a promising phase-two median on the smaller corpus
(3,090 to 2,368 ms), but total time (4,291.5 to 4,088 ms) had overlapping ranges,
and the larger corpus phase-two difference was only 0.68%. They are
excluded from the combined changes; these diagnostic samples do not establish
that the rejected changes are regressions.

## Combined validation

The [combined PR #1027](https://github.com/MattShelton04/TracePilot/pull/1027)
contains the six changes in [#1020](https://github.com/MattShelton04/TracePilot/pull/1020),
[#1021](https://github.com/MattShelton04/TracePilot/pull/1021),
[#1022](https://github.com/MattShelton04/TracePilot/pull/1022),
[#1023](https://github.com/MattShelton04/TracePilot/pull/1023),
[#1025](https://github.com/MattShelton04/TracePilot/pull/1025) and
[#1026](https://github.com/MattShelton04/TracePilot/pull/1026).
The original product is `d95f6d81d8a27f9ee3b18967f00b81d76c25e723` and the
measured combined product is `e3097fb3772907fa706f0c6dcafd9fdd08e73e64`.
Publication commit `20138afb` changes documentation only. A later CI repair
updates the locked optional `quinn-proto` dependency from 0.11.15 to 0.11.18
after five new security advisories. It has no active reverse dependency in
`cargo tree --locked --workspace --target all --invert quinn-proto`.
The measurements below remain attributed to `e3097fb` and are separate from
the independent-change results above; they were not rerun for the lock update.

### First setup in the native app

The combined product `e3097fb3772907fa706f0c6dcafd9fdd08e73e64` also changes first
setup. It waits for the loading screen's own successful metadata reindex request,
then uses one 180ms fade (no animation wait with reduced motion). An unrelated
source refresh cannot dismiss it early. Existing error/timeout recovery and
persisting setup completion before mounting the app remain intact.

Real Windows Tauri release measurements used the visible full setup wizard on
fresh isolated data roots and WebView profiles. Each corpus has five fresh
processes per revision in alternating pairs. The endpoint starts at the final
Launch TracePilot action and ends when the expected session cards are mounted,
the first is measurable, and two animation frames have passed. Earlier wizard
steps and initial process launch are outside this interval.

| Native first-setup workload | Original median [range] | Combined median [range] | Less time |
| --- | --- | --- | --- |
| 12 indexed sessions / 11 visible cards | 2,254.8 [2,186.9–2,487.7] ms | 919.0 [918.1–962.3] ms | 59.2% |
| 1,012 indexed sessions / 1,011 visible cards | 4,147.9 [4,066.9–4,369.2] ms | 3,038.4 [2,985.6–3,307.5] ms | 26.7% |

Successful own reindex settlement to app-shell mount fell from 1,487.5 to
225.2ms on the small corpus and 1,194.0 to 224.7ms on the larger corpus. This
interval includes the unchanged configuration save and has millisecond clock
quantization. Shell-to-usable-list medians remained similar: 140.9→141.7ms and
495.6→489.8ms. The end-to-end setup figures measure the combined branch; they
must not be attributed solely to the presentation change.

All 24 acceptance cases passed: 20 normal-motion timing cases, two reduced-motion
controls and two Skip controls. Both source families, metadata IDs, visible card
counts, filtering, persisted setup state and completed search-index counts were
verified. Reduced-motion and Skip controls are excluded from performance
averages. A preflight CPU failure interrupted an earlier set, which was retained
only as diagnostic evidence; no samples from it were reused. The successful set
waited up to 30 seconds for CPU<20%, requiring free RAM>4,000MiB at each
attempt before the action and recording every attempt. Its memory guard observed at least
5,581.9MiB free RAM and never stopped a process.

The session list becomes usable after metadata indexing. Background FTS
completion is verified separately and is not the handoff barrier. These results
do not measure ordinary completed-setup startup or cold-disk startup; OS file
caches were uncontrolled.

### Combined conversation navigation

Four fresh native processes ran in baseline/combined/combined/baseline order,
with a fresh isolated data root and WebView profile per process. Each process
visited each conversation once after backend data prewarming, then revisited it
three times. The six warm samples per revision are clustered within two
processes; they are not six independent process launches.

| Warm route workload | Original median [range] | Combined median [range] | Interpretation |
| --- | --- | --- | --- |
| 30 turns / 90 tools | 84.9 [82.2–101.1] ms | 84.0 [79.6–93.7] ms | Overlapping ranges; no clear gain |
| 4,000 turns / 12,000 tools / 800 agents | 3,733.6 [3,492.7–3,935.8] ms | 3,319.0 [3,171.7–3,430.0] ms | 11.1% less time |
| 20 turns / 10,000 tools | 1,391.1 [1,363.1–1,539.1] ms | 1,327.4 [1,308.5–1,425.0] ms | Overlapping ranges; no clear gain |

The endpoint is route change to expected mounted turn count, a visible first
message and two animation frames. Garbage collection occurs before timing;
OS file caching is uncontrolled. This does not measure scroll smoothness or
cold startup. First backend-prewarmed visits have only two samples per revision
and do not support a general first-visit speed claim. The long-history first
visit was 4,037.9 [4,020.4–4,055.3] versus 3,928.2 [3,793.1–4,063.3] ms.

All 48 route observations passed. The metadata and background search lifecycles
were balanced before route timing, with the expected 15 metadata sessions,
14 visible cards and 52,589 search rows. Loaded frontend bytes and executable
hashes matched the intended revision. The run's memory guard observed at least
5,360.7 MiB free RAM and did not interrupt execution. Endpoint heap readings
are diagnostic and do not establish a peak-memory improvement.

### Combined indexing

Five fresh processes per revision per Copilot-only corpus measured the complete first-index
path, including migrations, metadata indexing, search indexing and final
maintenance. These are backend timings; native setup has its separate endpoint
above. All samples are retained, including the slowest original small-corpus
sample. Phase medians are diagnostic components and must not be added together.

| First-index workload | Original median [range] | Combined median [range] | Interpretation |
| --- | --- | --- | --- |
| 1,000 sessions / 136,930 events / 37,581 tools | 3,969 [3,797–5,535] ms | 3,733 [3,631–3,833] ms | 5.9% lower median; ranges overlap |
| 500 sessions / 1,477,800 events / 426,800 tools; 3.36 GB source | 47,373 [46,685–49,921] ms | 44,958 [44,496–45,367] ms | 5.1% less time; ranges separated |

Metadata-phase medians were 1,258→1,103 ms on the smaller corpus and
10,858→9,281 ms on the stress corpus. Search-phase medians were 2,673→2,635 ms
and 36,474→35,637 ms respectively. The stress result supports a modest whole-path
indexing improvement; it does not imply a comparable change for every corpus.
Peak working set was essentially unchanged: median 148.9→149.5 MiB and
414.9→414.4 MiB. Final database sizes were identical within each corpus.

All 20 first-index databases matched expected counts, source manifests, logical
table values, triggers and six complete ordered MATCH/bm25 result sets. Both FTS
integrity checks passed. Logical comparison masks declared indexing/schema/
maintenance timestamps and excludes SQLite internals, planner statistics and
FTS shadow layout; it does not require byte-identical database files or establish
equivalence for every possible query. An independent check of all 20 maintenance
records confirmed no deferred merge work.

Twenty additional compatibility runs covered unchanged refresh, one large
session update, ten small updates, thirty large updates and search rebuild
(two fresh processes per revision per workload). All logical/FTS comparisons
passed. The strict zero-residual-maintenance gate failed for 12 runs: all three
update workloads on both revisions left merge work. Their recent-seed fixtures
deliberately exercise the existing four-hour maintenance throttle; that policy
and its call sites are unchanged. Unchanged refresh and forced rebuild had no
residual work in their eight runs. The failed gate is retained, and none of these
controls supports a fully drained timing or combined refresh speed claim.

### Combined search, export and parsing

| Endpoint | Unit | Processes per revision | Original median [range] | Combined median [range] | Reduction |
| --- | --- | --- | --- | --- | --- |
| Browse facets | ms | 5 | 947.523 [941.533–949.322] | 128.605 [127.533–144.866] | 86.4% |
| Browse page + exact count | ms | 5 | 27.660 [26.991–28.209] | 8.158 [7.826–8.469] | 70.5% |
| Common FTS page + exact count | ms | 5 | 676.622 [652.018–697.885] | 589.379 [588.272–602.593] | 12.9% |
| Common FTS count | ms | 5 | 185.766 [179.979–189.920] | 103.337 [102.790–106.634] | 44.4% |
| Common FTS facets | ms | 5 | 1,028.567 [1,012.244–1,163.995] | 808.864 [788.979–866.356] | 21.4% |
| Full JSON export | ms | 6 | 527.260 [482.181–611.035] | 278.143 [277.109–294.910] | 47.2% |
| Full JSON export peak working set | MiB | 6 | 309.982 [309.938–310.012] | 229.061 [229.035–229.098] | 26.1% |
| Sharing Markdown export | ms | 6 | 271.071 [260.504–283.575] | 157.029 [155.077–168.102] | 42.1% |
| Sharing Markdown peak working set | MiB | 6 | 233.998 [233.969–234.020] | 166.305 [166.234–166.320] | 28.9% |
| Parse small records: 4.66 MB / 20,000 events | ms | 6 | 44.954 [44.408–52.379] | 41.006 [40.020–42.023] | 8.8% |
| Parse large tool output: 33.57 MB / 128 events | ms | 6 | 56.309 [53.668–60.711] | 32.662 [32.237–33.516] | 42.0% |
| Parse huge tool output: 100.68 MB / 128 events | ms | 6 | 164.465 [160.286–179.383] | 97.625 [95.040–101.557] | 40.6% |
| Parse export source: 36.84 MB / 24,001 events | ms | 6 | 116.787 [113.222–126.662] | 90.255 [88.117–91.431] | 22.7% |
| Parse frozen local sample: 116.94 MB / 31,666 events | ms | 6 | 436.923 [423.416–460.525] | 343.566 [340.121–358.109] | 21.4% |
| Parse frozen local sample: 1.67 MB / 786 events | ms | 6 | 8.949 [8.621–23.875] | 7.737 [7.446–8.142] | 13.5% |

The 600-session / 300,000-row search corpus uses five fresh processes per
revision, each warming and timing 45 operations (15 query/filter combinations
times page/count/facets). All complete output digests match. These are database
library timings, excluding native IPC/UI. Source/repository-filtered and rare
query ranges generally overlap; no broad improvement is claimed for those
controls. Eight operation medians increased by 0.1–5.1%, with overlapping ranges.

Export uses 2,000 turns / 8,000 tools / 24,001 events from 36,838,143 source bytes,
with six fresh processes per revision per preset. Timing covers build/filter/
render, excluding desktop IPC, dialog and save-file I/O. Exact normalized bytes
and SHA-256 match after freezing volatile header fields and section order.
Peak working set is measured per process; the archive and output remain resident.

Parsing uses six fresh processes per revision for each of six workloads (72
processes). Timing covers `parse_typed_events`, with hashing afterward. Every
raw-record and diagnostic hash and typed/fallback/error count matches; typed
payload serialization is not hashed. Input hashes remained unchanged. Frozen
local samples contribute aggregate measurements only. The complete library set
has 106 processes. An earlier launch failed before any timed sample because
the sandbox denied child-process creation; a fresh run with the same runner,
probes and inputs succeeded under approved execution permission.


### Resource and cancellation checks

Three final-only processes on the 1,000-session synthetic corpus passed the
1,024 MiB peak-working-set budget. Metadata and search phases peaked at 108.0
and 147.6 MiB and each indexed all 1,000 sessions. The cancellation sample
returned 7.245 ms after the request, within the 250 ms budget. This is one
observed cancellation point with zero sessions reported indexed or skipped;
it does not establish worst-case cancellation during a write. The resource runner
does not independently verify post-cancel recovery; recovery is covered by
existing tests and completed-output parity by the separate index comparisons.



### Verification and limits

The frozen combined product passed the repository's literal `just ci` command:
2,199 Rust tests, 4,650 Vitest tests across 503 files, and 20 site tests passed;
10 existing Rust tests remain ignored. The recipe excludes the desktop Rust
crate. Workspace type checking and the production frontend build passed.
Formatting, all-target Clippy with warnings denied, Biome, file budgets, action
pins, documentation links, ADRs, catalog drift, CSP and public API checks were
also inspected individually. Biome reported two existing information-level
suggestions; catalog peer-dependency/hoist notes were advisory.

Hosted checks passed Windows, Linux and macOS Rust, frontend and desktop tests,
Windows automation/installer and macOS bundling. A security job found zero
vulnerabilities but initially failed to update its GitHub check record; retrying
that job succeeded without changing product code. The real native release build
and app checks supplement these CI gates.

The final bundle was essentially unchanged: JavaScript 2,278,826 to 2,278,617
bytes, CSS 767,502 to 767,532 bytes, and largest JavaScript chunk 362,821 to
362,724 bytes. No meaningful bundle-size improvement is claimed.

Native functional checks passed Search with a result facet and deep link,
Chat/Compact/Timeline, Overview/Events/Metrics, session Refresh, Analytics and
Tools. JSON and Markdown export previews each reported ten selected sections;
Markdown rendered five nonempty sections. Dense groups retained all 500 mounted rows, initially displayed seven,
preserved node/detail state through expansion and collapse, and revealed a
hidden event through its deep link. Existing tests cover export save/import and
recovery contracts; native export verification here covers preview only.

Captured images were opened and visually inspected at 1440×960, 960×640 and
2560×1440 in dark mode, plus 1440×960 in light mode. Actual DOM, cached and backend
theme settings agreed. Settings navigation and view controls remained reachable
without page-level horizontal overflow. Baseline and combined completed roots
also relaunched successfully; these are post-attachment correctness checks,
not startup timing measurements.

The final retained native IPC snapshot contained 161 successful entries and no
failed entries; the helper observed no page or console errors. Fifteen slow-IPC
warnings were recorded. The client meter is bounded, so this is not a claim of
complete process-start IPC coverage. Synthetic corpus hashes were unchanged
after the checks. All owned apps, registry claims and automation browsers were
cleaned up using recorded ownership identities.

Final combined validation ran with one owned heavy workload at a time, bounded
build/test workers and a memory guard that stops only its own process tree.
Source validation, batching, per-session recovery and cancellation behavior
remain covered by regression tests. No speed claim assumes reduced durability,
skipped failed sessions or incomplete search maintenance. The workload results
do not establish a universal app-wide speedup or prove the absence of all
possible regressions.

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
