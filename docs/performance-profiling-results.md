# TracePilot Performance Profiling Results

> Generated from a full proof-of-concept run of every profiling tool in the TracePilot performance toolkit.
> Date: July 2025 · Branch: `Matt/Performance_Playbook_Docs` · Host: Windows 11

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Criterion Benchmarks (Rust)](#1-criterion-benchmarks-rust)
3. [dhat-rs Heap Profiling](#2-dhat-rs-heap-profiling)
4. [Flamegraph / CPU Profiling](#3-flamegraph--cpu-profiling)
5. [SQLite Query Profiling](#4-sqlite-query-profiling)
6. [tokio-console (Async Task Inspector)](#5-tokio-console-async-task-inspector)
7. [Frontend Bundle Analysis](#6-frontend-bundle-analysis)
8. [usePerfMonitor (Vue Component Profiling)](#7-useperfmonitor-vue-component-profiling)
9. [Long Task Observer](#8-long-task-observer)
10. [Chrome DevTools / Lighthouse](#9-chrome-devtools--lighthouse)
11. [PGO Build Scripts](#10-pgo-build-scripts)
12. [Key Findings & Bottlenecks](#key-findings--bottlenecks)
13. [Recommended Next Actions](#recommended-next-actions)

---

## Executive Summary

| Tool | Status | Key Finding |
|------|--------|-------------|
| **Criterion benchmarks** | ✅ Ran successfully | 27 benchmarks across 7 groups; parsing is the dominant cost in synthetic benchmarks |
| **Real-world profiling** | ✅ Ran successfully | **FTS5 writes are 87.8% of search indexing (41s/47s)** — the #1 bottleneck |
| **dhat-rs heap profiling** | ✅ Ran successfully | 50-turn session: 248KB total allocs, 208KB peak live |
| **Flamegraph** | ⚠️ Requires admin | Windows needs elevated privileges (blondie/dtrace); Linux/macOS ready |
| **SQLite query profiling** | ✅ Active in debug | No slow queries (>10ms) detected in test fixtures; production monitoring ready |
| **tokio-console** | ⚠️ Requires app running | Feature-gated; needs manual app launch to test |
| **Bundle analysis** | ✅ Ran successfully | 550 modules → 437KB bundle-stats.html treemap; initial chunk 103KB |
| **usePerfMonitor** | ⚠️ Requires app running | Composable deployed to 3 views; needs live app to collect data |
| **Long task observer** | ⚠️ Requires app running | Dev-only; auto-logs main-thread blocks >50ms |
| **Chrome DevTools** | ⚠️ Requires app running | Manual profiling via browser DevTools |
| **PGO build scripts** | ✅ Available | Scripts ready for Linux/macOS (.sh) and Windows (.ps1) |

**Bottom line:** The automated backend tools (benchmarks, dhat, SQLite profiling, bundle analysis) all work out of the box. Frontend/runtime tools (usePerfMonitor, long task observer, tokio-console) require the app to be running in dev mode. **Real-world profiling revealed FTS5 writes as the dominant bottleneck (87.8% of search indexing time).**

---

## 0. Real-World Search Indexing Profiling

**Tool:** `real_bench.rs` harness against actual user session data  
**Command:** `cargo run --release --bin real_bench -p tracepilot-bench`

### Environment

| Metric | Value |
|--------|-------|
| Sessions discovered | 275 |
| Sessions with events | 178 |
| Total data size | 1,190.9 MB |
| Total FTS rows | 326,758 |

### Phase 1: `reindex_all` (Metadata Indexing)

| Metric | Value |
|--------|-------|
| Time | 3.70s |
| Throughput | 74.2 sessions/sec |

### Phase 2: `reindex_search_content` (Deep Content FTS5 Indexing)

| Step | Time | % of Total |
|------|------|-----------|
| Discovery | 0.03s | <0.1% |
| Staleness check | 0.01s | <0.1% |
| **JSON Parsing** | **5.07s** | **10.9%** |
| Content Extraction | 0.62s | 1.3% |
| **FTS5 DB Writes** | **41.02s** | **87.8%** |
| **Total** | **~47s** | 100% |

### Top 10 Slowest Sessions (Parse Time)

| Session | Parse | Extract | File Size | FTS Rows |
|---------|-------|---------|-----------|----------|
| `01b724a3` | 210ms | 28ms | 41.2 MB | 11,569 |
| `c533a91f` | 179ms | 24ms | 34.6 MB | 8,742 |
| `13d8ee2d` | 168ms | 20ms | 42.0 MB | 9,976 |
| `3336e71a` | 167ms | 20ms | 38.2 MB | 9,721 |
| `3e5e0480` | 164ms | 29ms | 34.5 MB | 12,529 |

### Top 10 Slowest FTS5 Writes

| Session | Write Time | FTS Rows |
|---------|-----------|----------|
| `51418700` | 1,564ms | 9,198 |
| `3e5e0480` | 1,486ms | 12,529 |
| `3fb96bf5` | 1,284ms | 9,514 |
| `01b724a3` | 1,256ms | 11,569 |
| `3336e71a` | 1,154ms | 9,721 |
| `c533a91f` | 1,127ms | 8,742 |
| `13d8ee2d` | 1,126ms | 9,976 |
| `fd713dd4` | 1,056ms | 8,448 |
| `c3d25a3c` | 1,024ms | 6,050 |
| `3d94669a` | 955ms | 7,548 |

### Key Insight

The **FTS5 write path** (`upsert_search_content`) dominates at **87.8%** of total time. Each call:
1. Opens a `SAVEPOINT`
2. `DELETE FROM search_content WHERE session_id = ?`
3. Individual `INSERT` for each row
4. `RELEASE SAVEPOINT`

With 326,758 rows across 178 sessions, this creates massive FTS5 index rebuild overhead. The DELETE-before-INSERT pattern means FTS5 must update its B-tree for every row twice (once for deletion, once for insertion).

**Staleness-aware re-runs are fast (0.04s)** — the system correctly skips already-indexed sessions. The bottleneck only matters for first-time indexing or when many sessions have changed.

### Optimization Applied: Bulk Write with FTS5 Rebuild

**Approach:** For bulk indexing (≥10 sessions), drop FTS triggers → insert all rows → rebuild FTS index in one pass → restore triggers. Small incremental updates (< 10 sessions) still use per-row triggers.

| Strategy | Time | Speedup |
|----------|------|---------|
| Per-row triggers (original) | 44.1s | 1.0x |
| Transaction batching (groups of 50) | 47.7s | 0.9x (no improvement) |
| **Bulk write + FTS rebuild** | **9.3s** | **4.8x** |

Transaction batching didn't help because WAL already amortizes fsyncs. The bottleneck was the **per-row FTS5 trigger overhead** (654K trigger operations). The bulk rebuild approach eliminates all per-row FTS work and replaces it with a single O(N) pass.

---

## 1. Criterion Benchmarks (Rust)

**Command:** `cargo bench -p tracepilot-bench`

### Results Summary

| Benchmark | Size | Median Time | Throughput |
|-----------|------|-------------|------------|
| **Parsing** | | | |
| `parse_typed_events` | 100 events | 371.6 µs | 51.0 MiB/s |
| `parse_typed_events` | 1,000 events | 2.76 ms | 69.6 MiB/s |
| `parse_typed_events` | 5,000 events | 15.8 ms | 61.7 MiB/s |
| `parse_typed_events` | 10,000 events | 34.1 ms | 57.7 MiB/s |
| **Turn Reconstruction** | | | |
| `reconstruct_turns` | 100 events | 20.0 µs | 5.09 Melem/s |
| `reconstruct_turns` | 500 events | 109.5 µs | 4.58 Melem/s |
| `reconstruct_turns` | 2,000 events | 388.1 µs | 5.16 Melem/s |
| `reconstruct_turns` | 5,000 events | 1.03 ms | 4.87 Melem/s |
| **Analytics** | | | |
| `compute_analytics` | 10 sessions | 9.49 µs | 1.05 Melem/s |
| `compute_analytics` | 50 sessions | 45.5 µs | 1.10 Melem/s |
| `compute_analytics` | 100 sessions | 108.5 µs | 921 Kelem/s |
| `compute_analytics` | 200 sessions | 177.7 µs | 1.13 Melem/s |
| **Tool Analysis** | | | |
| `compute_tool_analysis` | 50 sessions | 124.6 µs | 401 Kelem/s |
| `compute_tool_analysis` | 200 sessions | 536.5 µs | 373 Kelem/s |
| **Code Impact** | | | |
| `compute_code_impact` | 10 sessions | 16.4 µs | 610 Kelem/s |
| `compute_code_impact` | 200 sessions | 314.9 µs | 635 Kelem/s |
| **Indexer (SQLite I/O)** | | | |
| `upsert_session` | 5 turns | 33.0 ms | — |
| `upsert_session` | 20 turns | 20.0 ms | — |
| `upsert_session` | 50 turns | 20.5 ms | — |
| `reindex_all` | 10 sessions | 43.1 ms | 232 elem/s |
| `reindex_all` | 50 sessions | 43.2 ms | 1.16 Kelem/s |
| `reindex_all` | 100 sessions | 38.6 ms | 2.59 Kelem/s |
| `reindex_varied` | 50 sessions | 82.1 ms | 609 elem/s |
| `reindex_varied` | 100 sessions | 41.1 ms | 2.43 Kelem/s |
| **SQLite Queries** | | | |
| `query_analytics` | 10 sessions | 237.3 µs | 42.1 Kelem/s |
| `query_analytics` | 50 sessions | 455.7 µs | 109.7 Kelem/s |
| `query_analytics` | 100 sessions | 683.1 µs | 146.4 Kelem/s |
| `query_analytics` | 200 sessions | 1.23 ms | 162.2 Kelem/s |
| **Session Summary** | | | |
| `load_session_summary` | 5 turns | 440.3 µs | — |
| `load_session_summary` | 20 turns | 996.0 µs | — |
| `load_session_summary` | 50 turns | 1.81 ms | — |
| **Search** | | | |
| `search` | 10 sessions | 30.5 µs | 328 Kelem/s |
| `search` | 50 sessions | 22.5 µs | 2.22 Melem/s |
| `search` | 100 sessions | 24.9 µs | 4.01 Melem/s |
| `search` | 200 sessions | 32.8 µs | 6.09 Melem/s |

### Interpretation

- **Parsing is the dominant CPU cost** — `parse_typed_events/10000` takes 34ms, which means parsing a large session is the primary bottleneck for session loading
- **Turn reconstruction is cheap** — even 5,000 events reconstruct in ~1ms
- **Analytics compute is fast** — 200 sessions in <180µs, not a bottleneck
- **SQLite upsert is the I/O bottleneck** — 20-33ms per session write due to disk I/O
- **Reindex throughput** — 100 sessions in ~40ms via Rayon parallel indexing
- **Search is sub-millisecond** — even at 200 sessions, under 33µs

### How to Compare Against Baseline

```powershell
# Save current as baseline
cargo bench -p tracepilot-bench -- --save-baseline current

# Make changes, then compare
cargo bench -p tracepilot-bench -- --baseline current
```

### Criterion HTML Reports

After running benchmarks, open interactive charts at:
```
target/criterion/report/index.html
```

---

## 2. dhat-rs Heap Profiling

**Command:** `cargo test -p tracepilot-core --features dhat-heap -- dhat_tests --test-threads=1 --nocapture`

### Results (50-turn Session Parse + Turn Reconstruction)

| Metric | Value |
|--------|-------|
| Total bytes allocated | 248,368 |
| Total allocations | 1,316 |
| Peak bytes (max live) | 208,501 |
| Peak allocations (max live) | 1,009 |
| Currently live bytes | 193,107 |
| Currently live allocations | 1,006 |

### Interpretation

- **248KB total for 50 turns** — reasonable, but ~83% remains live after parsing, suggesting most allocations are retained in the final data structures rather than being temporary
- **1,316 total allocations** for 50 turns means ~26 allocations per turn — each turn involves String allocations for content, Vec entries for tool calls, etc.
- **Peak 208KB** with 193KB still live = only 15KB was temporary scratch space; the parsing pipeline is fairly allocation-efficient

### How to Get Detailed Allocation Traces

```powershell
# Run without --testing flag for full dhat-heap.json output
cargo test -p tracepilot-core --features dhat-heap -- dhat_tests --test-threads=1
# Open the output file in Firefox:
# https://nnethercote.github.io/dh_view/dh_view.html
```

The full dhat viewer shows allocation call stacks, letting you pinpoint exactly which code paths allocate the most memory.

---

## 3. Flamegraph / CPU Profiling

**Command:** `cargo flamegraph --bench parsing -p tracepilot-bench -- --bench --profile-time 5`

### Status: Requires Elevated Privileges on Windows

```
Error: could not find dtrace and could not profile using blondie: NotAnAdmin
```

**On Windows:** Run PowerShell as Administrator, then:
```powershell
cargo flamegraph --bench parsing -p tracepilot-bench -- --bench --profile-time 5
# Opens flamegraph.svg in browser
```

**On Linux/macOS:** Works without special privileges (uses `perf` or `dtrace`):
```bash
cargo flamegraph --bench parsing -p tracepilot-bench -- --bench --profile-time 5
```

**Tip:** Add debug symbols for better stack traces:
```toml
# Cargo.toml (temporary, for profiling only)
[profile.bench]
debug = true
```

### What You'll See

The flamegraph shows a hierarchical view of where CPU time is spent. For TracePilot, expect to see:
- `serde_json::de::*` — JSON deserialization (parsing)
- `rusqlite::*` — SQLite operations (indexing)
- `std::io::*` — File I/O (session discovery)

---

## 4. SQLite Query Profiling

**Mechanism:** `conn.profile()` callback in debug builds (>10ms = warning log)

**Command:** `$env:RUST_LOG = "tracepilot_indexer=debug"; cargo test -p tracepilot-indexer -- --test-threads=1`

### Results

No slow queries detected during test runs. This is expected — test fixtures use small in-memory datasets.

### For Real-World Profiling

To catch slow queries with your actual session data:
1. Build the app in debug mode: `cargo build`
2. Launch with tracing enabled: `RUST_LOG=tracepilot_indexer=debug`
3. Any SQL query taking >10ms will be logged:
   ```
   WARN tracepilot_indexer: Slow SQL query duration_ms=47 query="SELECT ... FROM sessions WHERE ..."
   ```

### Implementation Details

```rust
// crates/tracepilot-indexer/src/index_db/mod.rs:56-66
#[cfg(debug_assertions)]
conn.profile(Some(|query: &str, duration: Duration| {
    if duration.as_millis() > 10 {
        tracing::warn!(
            duration_ms = duration.as_millis(),
            query = %query.chars().take(200).collect::<String>(),
            "Slow SQL query"
        );
    }
}));
```

---

## 5. tokio-console (Async Task Inspector)

**Requires:** Running the desktop app with the `tokio-console` feature flag.

### Setup

```bash
# Install tokio-console
cargo install tokio-console

# Build the app with console support
cd apps/desktop/src-tauri
cargo build --features tokio-console

# In another terminal, connect the console
tokio-console
```

### What It Shows

- All active async tasks and their state (idle, running, scheduled)
- Task poll durations and wake counts
- Resource contention (mutexes, channels)

**⚠️ Note:** Enabling tokio-console replaces the normal tauri-plugin-log bridge. App logs will not appear in the console while tokio-console is active. This is feature-gated and documented in `main.rs`.

---

## 6. Frontend Bundle Analysis

**Command:** `cd apps/desktop && npx vite build --mode analyze`

### Results

| Metric | Value |
|--------|-------|
| Total modules | 550 |
| Build time | 26.4s |
| Visualizer output | `dist/bundle-stats.html` (437KB) |

### Top 15 Largest JS Chunks (gzipped)

| Chunk | Raw | Gzipped |
|-------|-----|---------|
| `index-B-h6JCHE.js` (app core) | 103.2 KB | 46.1 KB |
| `index-C8s7crYg.js` (pinia/stores) | 107.4 KB | 34.7 KB |
| `vendor-vue-DYr_IjX_.js` (Vue runtime) | 111.5 KB | 43.5 KB |
| `SessionTimelineView` | 57.0 KB | 16.9 KB |
| `SessionSearchView` | 53.4 KB | 15.8 KB |
| `SessionReplayView` | 34.7 KB | 11.0 KB |
| `WorktreeManagerView` | 34.3 KB | 8.2 KB |
| `SettingsView` | 27.1 KB | 8.2 KB |
| `AnalyticsDashboardView` | 26.9 KB | 7.7 KB |
| `SessionLauncherView` | 26.9 KB | 9.1 KB |
| `ConfigInjectorView` | 25.1 KB | 8.3 KB |
| `ExportView` | 23.6 KB | 7.9 KB |
| `purify.es` (DOMPurify) | 22.8 KB | 8.8 KB |
| `TodosTab` | 20.6 KB | 7.6 KB |
| `ModelComparisonView` | 21.4 KB | 6.3 KB |

### Initial Load Budget

| Resource | Size | Gzipped |
|----------|------|---------|
| **Initial JS** (index + vendor-vue + stores) | 322 KB | 124 KB |
| **Initial CSS** (index.css) | 115 KB | 21.4 KB |
| **Total initial load** | ~437 KB | ~145 KB |

### Interpretation

- **Vue runtime (111KB)** — irreducible dependency, already tree-shaken
- **Pinia stores (107KB)** — largest app code chunk; consider lazy-loading stores not needed at startup
- **App core (103KB)** — router, composables, shared utils
- **DOMPurify (23KB)** — loaded lazily only when markdown content is rendered ✅
- **All views are lazy-loaded** via route-level code splitting ✅
- **CSS is well-chunked** — per-view CSS splitting working correctly

### How to Explore

Open the interactive treemap:
```
apps/desktop/dist/bundle-stats.html
```

---

## 7. usePerfMonitor (Vue Component Profiling)

**Status:** Deployed to 3 views but requires the app running in dev mode.

**Integrated views:**
- `SessionListView`
- `SessionDetailView`
- `AnalyticsDashboardView`

### How to Use

1. Start the app in dev mode: `cd apps/desktop && pnpm dev`
2. Navigate to views with monitoring
3. Open browser console:
   ```javascript
   // Get all recorded performance entries
   window.__TRACEPILOT_PERF__

   // Get entries slower than 100ms
   import { getSlowEntries } from './composables/usePerfMonitor'
   getSlowEntries(100)

   // Pretty-print summary
   import { dumpPerfSummary } from './composables/usePerfMonitor'
   dumpPerfSummary()
   ```

### Expected Output Format

```
Component          | Mount (ms) | Render (ms) | Count
SessionListView    |    45.2    |    12.3     |   1
SessionDetailView  |    89.7    |    34.5     |   3
```

---

## 8. Long Task Observer

**Status:** Active in dev mode only — auto-imported in `main.ts`.

### How to Use

1. Start the app in dev mode
2. Open browser console — any main-thread block >50ms is automatically logged:
   ```
   [LongTask] 67ms task detected (attribution: script)
   ```

### What Triggers It

- Heavy JSON parsing in the renderer
- Large DOM updates (e.g., loading a session with 200+ turns)
- Synchronous IPC calls that block the main thread

---

## 9. Chrome DevTools / Lighthouse

**Requires:** App running in dev mode with DevTools open.

### Quick Profiling Steps

1. Open the app → Press `F12` → **Performance** tab
2. Click **Record** → Navigate to a view → Click **Stop**
3. Look for:
   - **Long tasks** (red bars in the flame chart)
   - **Layout thrashing** (purple bars)
   - **Scripting time** breakdown

### Lighthouse (for initial load)

1. DevTools → **Lighthouse** tab
2. Select **Performance** category
3. Click **Analyze page load**
4. Key metrics: FCP, LCP, TBT, CLS

---

## 10. PGO Build Scripts

**Status:** Scripts available but not yet tested end-to-end.

### How to Use

**Linux/macOS:**
```bash
./scripts/pgo-build.sh
# Or skip benchmarks and reuse existing profiles:
./scripts/pgo-build.sh --skip-bench
```

**Windows:**
```powershell
.\scripts\pgo-build.ps1
# Or skip benchmarks:
.\scripts\pgo-build.ps1 -SkipBench
```

### Expected Improvement

PGO typically provides 5-15% improvement on hot paths by optimizing branch prediction and function layout based on actual runtime profiles.

---

## Key Findings & Bottlenecks

### 🔴 Critical: FTS5 Write Path — Optimized 4.8x

Real-world profiling against 275 sessions (1.19 GB of events data) revealed:

| Phase | Before | After | Improvement |
|-------|--------|-------|------------|
| **FTS5 DB Writes** | 41.0s (87.8%) | **9.3s** | **4.8x faster** |
| JSON Parsing | 5.1s (10.9%) | 5.1s | — |
| Content Extraction | 0.6s (1.3%) | 0.6s | — |
| **Total Phase 2** | **~47s** | **~15s** | **~3x faster** |

**Fix:** `bulk_write_search_content()` drops FTS triggers during load, inserts rows without per-row index updates, then rebuilds FTS5 in a single O(N) pass. Automatically used when ≥10 sessions need indexing. Falls back to per-session `upsert_search_content()` for small incremental updates.

### 🟡 Medium Impact

| Area | Finding | Evidence |
|------|---------|----------|
| **JSON parsing** | 5.1s to parse 1.19 GB — 233 MB/s throughput | Real-world profiling |
| **Initial bundle** | 145KB gzipped initial load (JS+CSS) | Bundle analysis |
| **Pinia stores chunk** | 107KB (34.7KB gz) loaded eagerly | Bundle analysis |

### 🟢 Already Optimized

| Area | Finding | Evidence |
|------|---------|----------|
| **Staleness check** | Re-run after indexing: 0.04s (skips unchanged sessions) | Real-world profiling |
| **Search queries** | Sub-33µs even at 200 sessions | Criterion: `search/*` |
| **Analytics compute** | <180µs for 200 sessions | Criterion: `compute_analytics/*` |
| **Code splitting** | All views lazy-loaded, per-view CSS | Bundle analysis |
| **Parallel indexing** | Rayon par_iter for session processing | `reindex_all` benchmarks |
| **Progress throttling** | 80ms throttle (~12 updates/sec) | Phase 5 implementation |

---

## Recommended Next Actions

### For Developers

1. **Run benchmarks before/after changes:**
   ```powershell
   cargo bench -p tracepilot-bench -- --save-baseline before
   # Make changes
   cargo bench -p tracepilot-bench -- --baseline before
   ```

2. **Profile heap allocations when adding new data structures:**
   ```powershell
   cargo test -p tracepilot-core --features dhat-heap -- dhat_tests --test-threads=1 --nocapture
   ```

3. **Check bundle size impact of new dependencies:**
   ```powershell
   cd apps/desktop && npx vite build --mode analyze
   # Open dist/bundle-stats.html
   ```

### For Investigating Specific Bottlenecks

| Symptom | Tool to Use | Command |
|---------|-------------|---------|
| "App feels slow on startup" | Bundle analysis + Lighthouse | `npx vite build --mode analyze` |
| "Indexing is slow" | Criterion + SQLite profiling | `cargo bench -p tracepilot-bench --bench indexer` |
| "Session detail takes long to load" | usePerfMonitor + Chrome Performance | Check `window.__TRACEPILOT_PERF__` |
| "Memory usage grows over time" | dhat-rs | `cargo test --features dhat-heap` |
| "UI janks/freezes" | Long task observer + Chrome Performance | Check console for `[LongTask]` logs |
| "Async tasks seem stuck" | tokio-console | `cargo build --features tokio-console` |

### For AI Agents

The Criterion benchmarks and dhat profiling are fully automatable:
```bash
# CI-friendly benchmark run (machine-readable JSON output)
cargo bench -p tracepilot-bench -- --output-format bencher

# Automated regression detection
cargo bench -p tracepilot-bench -- --save-baseline main
# ... apply PR changes ...
cargo bench -p tracepilot-bench -- --baseline main
```

---

## Appendix: Tool Installation Checklist

| Tool | Install | Verification |
|------|---------|-------------|
| Criterion | Built-in (workspace dependency) | `cargo bench -p tracepilot-bench` |
| dhat-rs | Built-in (optional feature) | `cargo test -p tracepilot-core --features dhat-heap` |
| cargo-flamegraph | `cargo install flamegraph` | `cargo flamegraph --version` |
| tokio-console | `cargo install tokio-console` | `tokio-console --version` |
| Vite bundle analyzer | Built-in (rollup-plugin-visualizer) | `npx vite build --mode analyze` |
| PGO scripts | Built-in (`scripts/pgo-build.*`) | `./scripts/pgo-build.sh --help` |
