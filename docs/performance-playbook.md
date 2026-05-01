# Performance Playbook

Quick-reference guide for profiling, benchmarking, and finding bottlenecks in TracePilot.

> Historical generated performance analysis reports were removed in the 2026-05-01 docs cleanup.
> **Performance budgets**: [`perf-budget.json`](../perf-budget.json) (CI-enforced)

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

CI enforces bundle budgets from `perf-budget.json` on every PR.

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
2. Run debug build → watch for "Slow SQL query" tracing warnings
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

Every PR automatically runs:

| Check | What it does |
|-------|-------------|
| **Bundle analysis** | Builds frontend, posts size table as PR comment, enforces `perf-budget.json` |
| **Criterion benchmarks** | Runs all Rust benchmarks, reports regressions |
| **Typecheck + tests** | 489 Rust tests + 421 frontend tests |
