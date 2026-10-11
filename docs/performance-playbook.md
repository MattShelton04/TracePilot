# Performance Playbook

Quick-reference guide for profiling, benchmarking, and finding bottlenecks in TracePilot.

> Historical generated performance analysis reports were removed in the 2026-05-01 docs cleanup.
> **Performance thresholds**: [`perf-budget.json`](../perf-budget.json) (advisory; missing or invalid required measurements still fail CI)

---

## 1. Rust Benchmarks (Criterion)

Run all benchmarks:

```sh
cargo bench -p tracepilot-bench
```

Run a specific suite:

```sh
cargo bench -p tracepilot-bench --bench parsing    # event parsing + turn reconstruction
cargo bench -p tracepilot-bench --bench indexer     # reindex, search, upsert, analytics queries
cargo bench -p tracepilot-bench --bench analytics   # compute_analytics, tool_analysis, code_impact
```

Compare against a saved baseline:

```sh
cargo bench -p tracepilot-bench -- --save-baseline before-my-change
# ... make changes ...
cargo bench -p tracepilot-bench -- --baseline before-my-change
```

HTML reports are generated in `target/criterion/report/index.html`.

### Benchmark suites

| Suite | What it measures | Key benchmarks |
|-------|-----------------|----------------|
| `parsing` | JSONL → typed events, turn reconstruction, session summaries | `parse_typed_events/{100,1000,5000}`, `reconstruct_turns/{100,500,2000,5000}` |
| `indexer` | Full reindex, search, upsert, analytics queries | `reindex_all/{10,50,100}`, `reindex_varied/{50,100}`, `search/{10,50,100,200}` |
| `indexer` | Search content indexing (FTS5) | `reindex_search_content/{10,50,100,200}`, `reindex_search_varied/{50,100}` |
| `analytics` | Analytics computation functions | `compute_analytics`, `compute_tool_analysis`, `compute_code_impact` |

### Indexing resource and cancellation budgets

The existing [`index_probe`](../crates/tracepilot-bench/examples/index_probe.rs)
reports `elapsed_ms` and the process high-water memory mark (`peak_rss_kib`) on
Windows and Linux. Each mode runs in a fresh process so its peak is attributable.
The peak includes SQLite and Rayon allocations. Windows uses the process's
`PeakWorkingSet64`; Linux uses `/proc/self/status`'s `VmHWM`.

Build and generate a deterministic corpus, keeping data and output in the ignored
agent area. For example, from PowerShell at the repository root:

```powershell
cargo build --release -p tracepilot-bench --example index_probe --example performance_probe
$corpus = Join-Path (Get-Location) '.agent/indexing-perf'
& .\target\release\examples\performance_probe.exe generate --root $corpus --scale large
$sessions = Join-Path $corpus 'copilot/session-state'
$index = Join-Path $corpus 'tracepilot/index.db'
$env:TRACEPILOT_MEMORY_BUDGET_MIB = '1024'
$env:TRACEPILOT_CANCEL_BUDGET_MS = '250'
& .\target\release\examples\index_probe.exe phase1 $sessions $index
& .\target\release\examples\index_probe.exe phase2 $sessions $index
& .\target\release\examples\index_probe.exe phase2-cancel $sessions $index
```

`phase1` must run before search modes. `phase2-cancel` marks search extraction
stale, requests cancellation from another thread after 50 ms, and measures until
indexing returns, including worker joins and discarded partial buffers. Its JSON
`cancellation` object reports `latency_us`, `budget_ms`, and `request_delay_ms`.
The probe fails if indexing completes before the request; use a larger corpus
instead of interpreting that case as a cancellation measurement.

The default enforced budgets are 1,024 MiB peak memory and 250 ms cancellation
latency. The environment variables above override them for a declared workload.
Over-budget runs and unavailable memory measurements exit unsuccessfully. Record
the corpus scale and overrides alongside results. The `large` fixture exercises
many sessions; `massive` adds gigabytes of input and much larger individual logs.
Use `massive` when assessing how memory scales beyond the preparation batch.

Each batch is limited to 32 sessions and an estimated 16 MiB of event source; an
oversized session is a batch of its own. Batches are written in order, one at a
time, while up to 8 later batches and 96 MiB of estimated source are prepared on
Rayon workers. A batch over that budget is prepared alone and may exceed it in
memory; parsed representations, extracted rows and SQLite also consume memory.
This is a bound on accumulated preparation across sessions, not a universal
process-memory limit. Cancellation checkpoints cover directory scans, buffered reads, extraction and insertion
chunks; individual JSON decoding and SQLite statements remain non-preemptible.

Trigger-maintained search writes coalesce prepared batches of at least 10 sessions
into one transaction, with per-session savepoints for failed writes. Smaller
batches keep individual commits so a few large sessions do not retain combined
SQLite/FTS write state. Standalone writes use one transaction without a nested
savepoint, avoiding a second in-memory rollback journal. Cancellation or a failed
batch commit rolls back that batch; completed commits remain searchable. Source
preparation happens before the transaction, so file reads do not hold the database
write lock. Compare fresh and incremental phases when changing this boundary:
per-session commits can substantially increase transaction and WAL/checkpoint work.

FTS5 writes its pending terms out at every statement savepoint, so an `AFTER
INSERT` trigger firing inside each multi-row `INSERT` leaves thousands of small
segments to merge. A session replacement therefore drops `search_content_ai`,
inserts the rows, indexes them with one `INSERT INTO search_fts ... SELECT` in
rowid order, and recreates the trigger, all inside the caller's transaction or
savepoint (a rollback restores the trigger). Deletes still go through
`search_content_ad`. Replaying 671k real rows, per-row trigger maintenance took
16.3 s and the single statement 11.2 s, close to a full FTS `rebuild`; automerge
settings (0 to 16) made no difference.

### Measuring the whole indexing path

[`indexing_workloads`](../crates/tracepilot-bench/examples/indexing_workloads.rs)
runs each indexing workload the app runs, over Copilot and Claude Code sources
together, and prints wall time per step plus the process peak:

```powershell
cargo build --release -p tracepilot-bench --example indexing_workloads
$probe = '.\target\release\examples\indexing_workloads.exe'
& $probe first <copilot-session-state> <claude-config-dir> .agent\perf\index.db   # empty DB
# Copy that DB before each of: incr, analytics-bump claudeCode, search-rebuild,
# rebuild, purge claudeCode, enable claudeCode (after a purge).
```

Pass `-` for a source to leave it out (Copilot only is the regression check).
For a growing live session, null one session's `source_fingerprint` and
`search_source_fingerprint` in the copy, then run `incr`. Read CPU time from
outside (`(Get-Process -Id ...).TotalProcessorTime`, or a wrapper that starts the
probe). For base/head comparisons on Copilot alone, `index_probe phase1`/`phase2`
builds unchanged against older releases.

Method that held up: release builds; a fresh process per workload; at least five
runs per side, interleaved (ABBA); record the machine's CPU load before each run
and discard runs that start under load, since a running desktop app or another
agent's build shifts timings by 2x. For identical output, dump every table
sorted with wall-clock columns masked, plus FTS `bm25` results for a fixed set of
probe queries and FTS5 `integrity-check`, on a frozen corpus. FTS segment layout
(`search_fts_data`, `search_fts_idx`) legitimately differs with write order.

Baseline (2026-10, 12-thread desktop, median of 5 or more): a heavy real corpus of 618
Copilot sessions (2.5 GB of events, largest 111 MiB) and 101 Claude Code sessions
(0.8 GB) builds a 550 MiB index with 671k search rows.

| Workload | Time | Notes |
| --- | --- | --- |
| First index | 46 s | sessions 12.5 s (the writer waits on parsing ~85% of it), search 33 s; peak 500 MiB |
| Copilot only, first index | 9 s + 25 s | v0.9.1: 15.5 s + 43 s on the same corpus |
| Search index rebuild | 50 s | deletes and re-inserts every row |
| Settings full rebuild | 65 s | sessions 11 s, search 54 s |
| Analytics bump (Claude / Copilot) | 4 s / 8.5 s | search is skipped |
| Enable / disable Claude Code | 9.5 s / 1.3 s | |
| One live 50 MiB Claude session | 1.2 s | about half sessions, half search |

Where the first index's search phase goes (scoped timers): the writer is busy
24 s, of which row inserts take 9 s, the per-session FTS statement 5 s and 532
commits 7 s; it waits 4.5 s for preparation. Maintenance at the end of the pass
adds FTS `optimize` and `ANALYZE`, about 2 s each on a fresh index and up to
10 s each on a large, aged one, both under the write lock, so a concurrent
session write can time out with `database is locked`.

For base/head comparisons, run a separate head-only budget check. A historical
base may legitimately exceed the new memory budget; use an explicitly recorded
larger budget for the comparison itself so it can produce both measurements.
The shared comparison probe consists of `index_probe.rs` and its
`index_probe/limits.rs` helper; copy both when building it against an older base.

---

## 2. Heap Profiling (dhat-rs)

Profile memory allocations in tests:

```sh
cargo test -p tracepilot-core --features dhat-heap
```

This produces `dhat-heap.json` — open it at https://nnethercote.github.io/dh_view/dh_view.html.

---

## 3. CPU Profiling (cargo-flamegraph)

```sh
cargo install flamegraph
cargo flamegraph --bench parsing -p tracepilot-bench -- --bench "parse_typed_events/1000"
```

Opens `flamegraph.svg` — look for wide bars (hot functions).

---

## 4. SQLite Query Profiling

**Automatic in debug builds.** Any query taking >10ms is logged via `tracing::warn`:

```
WARN tracepilot_indexer: Slow SQL query duration_ms=15 query="SELECT ..."
```

To see these logs, run the app in dev mode (`cargo tauri dev`) and watch the console output.

---

## 5. Async Task Profiling (tokio-console)

Profile async runtime tasks (spawn counts, poll times, waker behavior):

```sh
# Terminal 1: build and run with tokio-console support
cargo tauri dev --features tokio-console

# Terminal 2: connect the console UI
cargo install tokio-console
tokio-console
```

> **Note:** This replaces normal Rust log output while active. Use only for async debugging.

---

## 6. Frontend — Component Mount Timing

The `usePerfMonitor` composable is integrated into SessionListView, SessionDetailView, and AnalyticsDashboardView. Open the browser console in dev mode:

```js
// Summary table of all recorded timings
__TRACEPILOT_PERF__.dumpPerfSummary()

// Raw log entries
__TRACEPILOT_PERF__.getPerfLog()

// Only entries slower than 50ms
__TRACEPILOT_PERF__.getSlowEntries(50)

// Clear and start fresh
__TRACEPILOT_PERF__.clearPerfLog()
```

Slow mounts (>50ms) automatically log a console warning in dev mode.

### Adding to a new view

```ts
import { usePerfMonitor } from '@/composables/usePerfMonitor';
const { mark, measure, timeAsync } = usePerfMonitor('MyView');

// Time an async operation
const data = await timeAsync('loadData', () => store.fetchData());

// Manual marks
mark('renderStart');
// ... rendering ...
const ms = measure('render', 'renderStart');
```

---

## 7. Frontend — Long Task Detection

In dev mode, the app automatically detects main-thread blocks >50ms via the W3C Long Tasks API. Watch the console for:

```
[perf] Long task: 82.3ms (self, at 1234ms)
```

These indicate UI jank — investigate what's happening at that timestamp using Chrome DevTools Performance tab.

---

## 8. Frontend — Bundle Analysis

```sh
pnpm --filter @tracepilot/desktop build --mode analyze
```

Opens an interactive treemap (`stats.html`) showing what's in each chunk. Look for:
- Unexpectedly large chunks
- Dependencies that should be lazy-loaded
- Duplicate code across chunks

The bundle workflow reports total JS + CSS size, largest-chunk size, and initial
HTML asset count from `perf-budget.json` on relevant PRs. All size thresholds
are advisory; missing assets or invalid measurement inputs still fail the job.

---

## 9. Frontend — Chrome DevTools

| Tool | When to use |
|------|-------------|
| **Performance tab** | Record a trace → identify long tasks, layout thrashing, expensive repaints |
| **Memory tab** | Take heap snapshots → find memory leaks (compare before/after navigation) |
| **Vue DevTools** | Component render times, reactivity tracking, Pinia store inspection |
| **Network tab** | IPC timing (filter by `ipc://`) — see serialization overhead |

---

## 10. Profile-Guided Optimization (PGO)

For release builds with 5–15% additional speedup:

```sh
# Linux/macOS
./scripts/pgo-build.sh

# Windows
.\scripts\pgo-build.ps1

# Reuse existing profiles (skip benchmark collection)
./scripts/pgo-build.sh --skip-bench
.\scripts\pgo-build.ps1 -SkipBench
```

Requires `rustup component add llvm-tools`.

---

## Quick Bottleneck-Finding Workflow

### "The app feels slow on startup"

1. `cargo tauri dev` → Chrome DevTools Performance tab → record app launch
2. Check `__TRACEPILOT_PERF__.dumpPerfSummary()` for slow mounts
3. Check console for long task warnings
4. Look at Network tab for slow IPC calls

### "Reindexing is slow"

1. `cargo bench -p tracepilot-bench --bench indexer` → synthetic Criterion benchmarks
2. Watch for "Slow SQL query" tracing warnings (also in the app log); for a whole
   pass, time each workload with `indexing_workloads` (see
   [Measuring the whole indexing path](#measuring-the-whole-indexing-path))
3. `cargo flamegraph --bench indexer` → find hot functions
4. `cargo test -p tracepilot-core --features dhat-heap` → check allocation counts

### "Search is slow"

1. `cargo bench -p tracepilot-bench --bench indexer -- search` → benchmark search queries
2. Check SQLite query profiling output in debug mode
3. For Tantivy deep search: check `crates/tracepilot-indexer/examples/bench_tantivy.rs`

### "The bundle is too big"

1. `pnpm --filter @tracepilot/desktop build --mode analyze` → inspect treemap
2. Check if new dependencies can be lazy-loaded
3. Compare against `perf-budget.json` limits

---

## CI Integration

Performance coverage:

| Check | What it does |
|-------|-------------|
| **Bundle analysis** | Relevant PRs: builds frontend, reports advisory size thresholds, retains size tables as artifacts and job summaries |
| **Criterion benchmarks** | Nightly/manual Linux runs: five benchmark suites run on separate runners, followed by one required-result summary. Suite HTML reports and the combined JSON/Markdown are retained; timing thresholds are advisory |
| **Base vs head comparison** | PRs touching Rust: `benchmark-compare.yml` measures the whole-PR merge base and exact PR head on one runner. `index_probe` alternates base/head builds over a generated corpus for wall time and peak RSS. The Criterion comparison (~25 min) is opt-in: add the `benchmark:criterion` label or run the workflow manually. Advisory annotations plus a job summary |
| **Native desktop** | Manual Windows release measurements with isolated data, including conversation scroll frame times; see the [performance mission report](reports/performance-mission.md) |
| **Typecheck + tests** | Standard correctness checks; see the [testing guide](testing.md) |

Run the same backend comparison locally with two separately built probes:

```sh
node scripts/perf/probe-compare.mjs --base=<base index_probe> --head=<head index_probe> \
  --sessions=<corpus>/copilot/session-state --work=<scratch dir> --repeats=4
```

Build each probe into its own `CARGO_TARGET_DIR`. Cargo does not re-copy an
up-to-date example into `target/release/examples`, so a shared directory can
silently hand back the other revision's binary.

CI restores the nightly main dependency cache and seeds two separate release
targets, removing local workspace crates and example binaries before each build.
Only the first declared nightly suite (currently parsing) saves this cache;
PR comparisons never save new entries. Keep `CARGO_TARGET_DIR` scoped to Cargo commands: declaring it for the
whole comparison job changes the Rust cache environment hash and prevents it
from restoring the nightly cache.

The shared probe harness embeds `TRACEPILOT_PROBE_REVISION` at compile time.
`index_probe --revision` prints that commit; passing `--base-sha=<commit>` and
`--head-sha=<commit>` to the comparator rejects stale or swapped binaries before
measurement. CI always enables this check and includes the SHAs in its JSON.
Manual workflow runs use the selected revision's first parent when the base
input is blank; an explicit base must differ from the measured head.

Measurement jobs have read-only repository permissions. They do not publish to
Pages or comment on PRs. See the [performance index](perf/index.md) for artifact
retention and comparison requirements.
