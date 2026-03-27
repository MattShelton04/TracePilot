# TracePilot Performance Analysis & Profiling Strategy Report

**Date**: 2026-03-27
**Version**: 0.5.1
**Scope**: Full-stack — Rust backend, Vue 3 frontend, Tauri IPC layer, CLI app, benchmarks, CI integration
**Reviewed by**: Claude Opus 4.6, GPT 5.4, GPT 5.3 Codex — cross-validated against source code

---

## How to Read This Report

- **Severity ratings**: 🔴 High (measurable user-facing impact), 🟡 Medium (significant under load), 🟠 Low (minor or theoretical)
- **Bottleneck IDs**: B1–B16, referenced throughout. Each bottleneck links to its proposed fix.
- **Roadmap phases**: Phase 1 (quick wins) → Phase 4 (continuous improvement). Items reference bottleneck IDs.
- **Philosophy**: **Measure first, optimize second.** Instrumentation and profiling infrastructure should be established before making optimization changes. Premature optimization without measurement risks wasted effort and added complexity.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current Performance Baseline](#2-current-performance-baseline)
3. [Rust Backend Profiling Landscape](#3-rust-backend-profiling-landscape)
4. [Frontend Performance Profiling Landscape](#4-frontend-performance-profiling-landscape)
5. [Tauri IPC Layer Analysis](#5-tauri-ipc-layer-analysis)
6. [Identified Performance Bottlenecks](#6-identified-performance-bottlenecks)
7. [Industry-Standard Optimization Techniques (Tailored)](#7-industry-standard-optimization-techniques-tailored)
8. [Benchmarking Strategy — Replacing & Extending tracepilot-bench](#8-benchmarking-strategy--replacing--extending-tracepilot-bench)
9. [Recommended Performance Infrastructure](#9-recommended-performance-infrastructure)
10. [Implementation Roadmap](#10-implementation-roadmap)
11. [Appendix A: Tool Reference Matrix](#appendix-a-tool-reference-matrix)
12. [Appendix B: CLI App Performance Notes](#appendix-b-cli-app-performance-notes)

---

## 1. Executive Summary

TracePilot has strong performance fundamentals: incremental SQLite indexing with WAL mode, LRU caching in both the Rust backend (turn cache) and Vue frontend (session detail cache), async Tauri IPC with `spawn_blocking` for CPU-bound work, and lazy-loaded Vue routes. The prior optimization pass (documented in `docs/research/optimization-plan.md`) successfully addressed 13/18 identified issues.

However, significant optimization opportunities remain across all layers. This report identifies concrete bottlenecks with code-level examples, surveys the profiling/analysis tool landscape for each technology, and proposes a **maintainable, reusable performance infrastructure** that developers and AI agents can use to find and fix bottlenecks systematically.

### Key Findings

| Area | Severity | Finding |
|------|----------|---------|
| Rust — Event deserialization | 🔴 High | `serde_json::from_value` clones entire JSON `Value` per event via `try_deser!` macro |
| Rust — Release profile | 🟡 Medium | `opt-level = "s"` (size) vs `"2"` (speed) — ~10-15% runtime cost |
| Rust — Parallelism | 🟡 Medium | Session indexing is fully sequential; no rayon/tokio parallelism |
| Rust — Turn cache lock scope | 🟡 Medium | `get_session_turns` clones entire turn Vec while holding Mutex |
| Frontend — List rendering | 🔴 High | No virtual scrolling for session lists or conversation turns |
| Frontend — Computed chains | 🟡 Medium | Cascading recomputes in timeline views (`flatMap` on every turn change) |
| Frontend — Bundle optimization | 🟡 Medium | No manual chunking, no vendor separation, heavy deps loaded eagerly |
| Tauri — IPC overhead | 🟡 Medium | Full turn payloads serialized + lock contention on cache reads |
| Tauri — WebView cold start | 🟠 Low | System WebView (WebView2/WebKitGTK) first-launch overhead |
| Benchmarks | 🟡 Medium | Criterion 0.5 is solid but coverage is limited; no memory, IPC, or frontend benchmarks |

---

## 2. Current Performance Baseline

### 2.1 What's Already Optimized (from optimization-plan.md)

| Optimization | Status | Impact |
|---|---|---|
| Incremental reindexing (skip unchanged sessions) | ✅ Done | Eliminated full-rescan overhead |
| SQL-based analytics aggregation (no disk scan) | ✅ Done | 50-100× faster than disk scan fallback |
| Single-pass event parsing per session | ✅ Done | Eliminated 2-3× redundant `events.jsonl` reads |
| WAL mode + busy timeout on SQLite | ✅ Done | Concurrent read access, no writer starvation |
| Transaction batching (BATCH_SIZE=100) | ✅ Done | Amortizes fsync overhead for bulk indexing |
| O(n²) → O(1) model dedup via HashSet | ✅ Done | Fixed quadratic scaling in turn_stats |
| 10-entry LRU turn cache in Tauri state | ✅ Done | Instant repeated session views |
| Frontend session detail cache (10 sessions, background refresh) | ✅ Done | Instant tab switching for recent sessions |
| Lazy-loaded Vue routes for all major views | ✅ Done | Reduced initial bundle load |
| `prepare_turns_for_ipc()` payload trimming | ✅ Done | 10-20% smaller IPC payloads |
| Proper `spawn_blocking` for all DB/FS operations | ✅ Done | Never blocks Tokio event loop |
| Event listener cleanup in Vue components | ✅ Done | All `addEventListener` calls have `onUnmounted` cleanup |

### 2.2 Current Benchmark Suite (`tracepilot-bench`)

The existing Criterion benchmarks cover three areas:

| Benchmark File | What's Measured | Parameterization |
|---|---|---|
| `parsing.rs` | `parse_typed_events`, `reconstruct_turns` | 100/1000/10000 events; 100/500/2000 turns |
| `analytics.rs` | `compute_analytics`, `compute_tool_analysis`, `compute_code_impact` | 10/50/100 sessions |
| `indexer.rs` | `upsert_session`, `search`, `query_analytics` | Single session; 10/50/100 indexed sessions |

**Strengths**: Covers core hot paths, uses throughput measurement, CI workflow with historical tracking.
**Gaps**: No memory profiling, no concurrent load tests, no IPC benchmarks, no frontend metrics, `black_box` not used (may allow optimizer skew), `bench_upsert_session` includes fixture creation in measurement time.

### 2.3 Release Profile

```toml
[profile.release]
lto = "thin"         # Good — cross-crate optimization
strip = true         # Good — smaller binary
codegen-units = 1    # Good — maximum optimization scope
opt-level = "s"      # ⚠️ Optimizes for SIZE, not speed
```

`opt-level = "s"` tells LLVM to prefer smaller code over faster code. For a desktop app where binary size is less critical than responsiveness, this is a suboptimal choice. Switching to `opt-level = "2"` (balanced) would yield ~10-15% faster runtime for CPU-bound operations like JSONL parsing and analytics aggregation, at the cost of a ~20-30% larger binary. `opt-level = "3"` is another option but can occasionally cause regressions due to aggressive inlining; `"2"` is the safer default.

---

## 3. Rust Backend Profiling Landscape

### 3.1 Runtime Profilers

| Tool | What It Measures | Platform | Integration Effort | Best For |
|------|-----------------|----------|-------------------|----------|
| **[`cargo-flamegraph`](https://github.com/flamegraph-rs/flamegraph)** | CPU time (sampling profiler) | Linux/macOS/Windows | `cargo install flamegraph` + run | Finding CPU hotspots in real workloads |
| **[`samply`](https://github.com/mstange/samply)** | CPU profiling with Firefox Profiler UI | Linux/macOS | `cargo install samply` | Interactive flame chart exploration |
| **[`perf`](https://perf.wiki.kernel.org/)** | Linux kernel-level CPU/cache/branch profiling | Linux only | Built-in | Low-level CPU optimization (CI runners) |
| **[Instruments](https://developer.apple.com/instruments/)** | Time Profiler, Allocations, Leaks | macOS only | Built-in Xcode | macOS-specific profiling |
| **[`tracing` + `tracing-timing`](https://docs.rs/tracing-timing)** | Function-level timing spans | Cross-platform | Add tracing spans to code | Correlating with application logic |
| **[`tracy`](https://github.com/wolfpld/tracy) + [`tracing-tracy`](https://github.com/nagisa/rust_tracy_client)** | Frame-level profiler (CPU + GPU) | Cross-platform | Add `tracing-tracy` subscriber | Real-time profiling of hot loops |
| **[`tokio-console`](https://github.com/tokio-rs/console)** | Tokio task scheduling, wake patterns | Cross-platform | `console-subscriber` crate | Async runtime bottlenecks |

#### Recommendation: `cargo-flamegraph` + `tracing` instrumentation

For TracePilot's workload (session parsing, SQLite queries, IPC serialization), the combination of:
1. **`cargo-flamegraph`** for macro-level CPU profiling of benchmarks
2. **`tracing` spans** on key functions (already using `tracing` crate) for structured timing
3. **`tokio-console`** for debugging async task scheduling (indexing, search)

This gives both birds-eye view (flamegraph) and granular instrumentation (tracing spans).

### 3.2 Memory Profilers

| Tool | What It Measures | Platform | Integration Effort | Best For |
|------|-----------------|----------|-------------------|----------|
| **[DHAT](https://valgrind.org/docs/manual/dh-manual.html) / [`dhat-rs`](https://docs.rs/dhat)** | Heap profiling (allocations, peak memory, short-lived allocs) | Cross-platform (Rust-native) | Add `dhat` crate + feature flag | Finding wasteful allocations |
| **[`jemalloc` + `jeprof`](https://github.com/jemalloc/jemalloc)** | Heap profiling via allocator hooks | Linux/macOS | Replace global allocator | Production-grade memory profiling |
| **[Valgrind/Massif](https://valgrind.org/docs/manual/ms-manual.html)** | Heap snapshots over time | Linux only | No code changes | Memory growth visualization |
| **[`cargo-instruments`](https://github.com/cmyr/cargo-instruments)** | Instruments.app integration | macOS only | `cargo install cargo-instruments` | macOS memory profiling |
| **[`tracking_allocator`](https://docs.rs/tracking-allocator)** | Per-callsite allocation tracking | Cross-platform | Replace global allocator | Pinpointing allocation sources |

#### Recommendation: `dhat-rs` for development profiling

`dhat-rs` is the best fit for TracePilot because:
- Works natively in Rust (no external tools needed)
- Can be gated behind a `profile` feature flag — zero overhead in production
- Produces allocation-centric reports that directly show wasteful patterns
- Works across all platforms (critical for a Tauri desktop app)

### 3.3 Compile-Time Analysis

| Tool | What It Measures | Best For |
|------|-----------------|----------|
| **`cargo build --timings`** | Per-crate compilation times | Identifying slow crates |
| **`cargo bloat`** | Binary size per crate/function | Finding bloated dependencies |
| **`cargo udeps`** | Unused dependencies | Removing dead weight |
| **`cargo-geiger`** | Unsafe code audit | Security + optimization targeting |

### 3.4 Database Profiling

SQLite-specific profiling for the indexer:

| Approach | What It Measures | How to Enable |
|----------|-----------------|---------------|
| **`EXPLAIN QUERY PLAN`** | Query execution strategy | Prefix queries in `analytics_queries.rs` |
| **`sqlite3_profile` callback** | Per-query wall-clock time | `rusqlite::Connection::profile()` |
| **`PRAGMA compile_options`** | SQLite build configuration | One-time check |
| **`.expert` mode** | Index recommendations | `sqlite3` CLI tool |
| **Custom `tracing` spans** | Per-query timing in application context | Wrap DB calls in spans |

---

## 4. Frontend Performance Profiling Landscape

### 4.1 Vue-Specific Tools

| Tool | What It Measures | Integration |
|------|-----------------|-------------|
| **[Vue DevTools](https://devtools.vuejs.org/)** | Component render time, Pinia state changes, computed recalculations, event timeline | Browser extension (Chromium/Firefox) |
| **Vue DevTools Performance Tab** | Component render profiling, reactivity tracking | Built into Vue DevTools |
| **Vue 3.5 Reactive Props Destructure** | Reduced `.value` boilerplate with compile-time transforms | Built-in (Vue 3.5+, which TracePilot uses) |

### 4.2 General Web Performance Tools

| Tool | What It Measures | Applicability to Tauri |
|------|-----------------|----------------------|
| **Chrome DevTools Performance Panel** | JS execution time, layout/paint/composite, memory timeline | ✅ Works with Tauri's webview in dev mode |
| **Chrome DevTools Memory Panel** | Heap snapshots, allocation timeline, detached DOM nodes | ✅ Full support |
| **Lighthouse** | Core Web Vitals (FCP, LCP, CLS, TBT) | ⚠️ Partially relevant (no network fetch) |
| **[`web-vitals`](https://github.com/GoogleChrome/web-vitals)** | Runtime CWV metrics | ⚠️ Limited in Tauri (no network waterfall) |
| **[`vite-plugin-inspect`](https://github.com/antfu-collective/vite-plugin-inspect)** | Module transform analysis during dev | ✅ Useful for build optimization |

### 4.3 Bundle Analysis

| Tool | What It Measures | Integration |
|------|-----------------|-------------|
| **[`rollup-plugin-visualizer`](https://github.com/btd/rollup-plugin-visualizer)** | Bundle composition treemap | Add to `vite.config.ts` plugins |
| **[`vite-bundle-analyzer`](https://github.com/nicolo-ribaudo/vite-bundle-analyzer)** | Chunk sizes, dependency tree | Vite plugin |
| **`npx vite-bundle-visualizer`** | Quick one-shot analysis | No install needed |
| **`source-map-explorer`** | Source map analysis for production builds | Post-build analysis |

#### Recommendation: `rollup-plugin-visualizer` + Chrome DevTools

For a Tauri app, the combination of:
1. **`rollup-plugin-visualizer`** for understanding what goes into each chunk
2. **Chrome DevTools Performance/Memory panels** via Tauri's dev webview
3. **Vue DevTools** for component-level render profiling

This covers bundle optimization, runtime profiling, and Vue-specific reactivity analysis.

### 4.4 Performance Monitoring (Runtime)

| Approach | What It Measures | Implementation |
|----------|-----------------|----------------|
| **`performance.mark()` / `performance.measure()`** | Custom timing marks in the Performance API | Add to store actions, view mounts |
| **Vue `onRenderTriggered` / `onRenderTracked`** | Detailed reactivity dependency tracking | Add to suspected hot components |
| **Custom `usePerfMonitor` composable** | Per-view load times, IPC roundtrip times | Instrument views/stores |
| **`PerformanceObserver` for long tasks** | Tasks blocking main thread >50ms | Global observer in `main.ts` |

---

## 5. Tauri IPC Layer Analysis

### 5.1 Serialization Overhead

Every Tauri `#[tauri::command]` call involves:
1. **Frontend → Backend**: JSON serialization of arguments via `@tauri-apps/api` `invoke()`
2. **Backend → Frontend**: Serde serialization of return value to JSON

For TracePilot, the heaviest IPC payloads are:
- `get_session_turns` — full turn list with tool calls, messages, args summaries
- `search_sessions` — paginated search results with facets
- `get_analytics` — aggregated dashboard data

The existing `prepare_turns_for_ipc()` optimization strips `transformed_user_message` and pre-computes `args_summary`, which is good. But there's more to gain.

### 5.2 IPC Profiling Approaches

| Approach | What It Measures | How |
|----------|-----------------|-----|
| **Wrap `invoke()` with timing** | Frontend-visible IPC roundtrip time | Instrument `@tracepilot/client` |
| **`tracing` spans in Tauri commands** | Backend processing time (excluding serialization) | Instrument command handlers |
| **Tauri IPC event payload size logging** | Bytes transferred per command | Log `serde_json::to_string().len()` |
| **Custom IPC benchmark** | End-to-end latency under load | Add to `tracepilot-bench` |
| **Lock-scope timing** | Time spent holding Mutex in `get_session_turns` | `Instant::now()` around cache operations |

A phased breakdown of each IPC call reveals the real cost structure:
1. **Backend work** — DB query or file I/O + parsing (tens to hundreds of ms)
2. **Cache clone/trim** — cloning cached turns under Mutex + `prepare_turns_for_ipc` (potentially ms for large sessions)
3. **IPC serialization** — `serde_json` serialize + WebView bridge (typically <10ms)
4. **Frontend processing** — Vue reactivity propagation + DOM rendering

Profiling should cover all four phases, not just serialization.

### 5.3 IPC Optimization Techniques

| Technique | Applicability | Estimated Impact |
|-----------|--------------|-----------------|
| **Pagination for large payloads** | `get_session_turns` with 500+ turns | 🔴 High — reduces peak payload from MBs to KBs |
| **Selective field loading** | Only return fields the view needs | 🟡 Medium — reduces serialization work |
| **Reduce lock scope in turn cache** | Clone turns *outside* the Mutex guard | 🟡 Medium — reduces contention on concurrent reads |
| **Tauri IPC channels / streaming** | Stream data in chunks for large results | 🟡 Medium — improves perceived latency; Tauri 2 supports `ipc::Channel` |
| **Binary serialization (MessagePack)** | Replace JSON with binary format | 🟠 Low — marginal gains for typical payload sizes; try pagination first |

### 5.4 Tauri Plugin & WebView Startup Overhead

**Plugin registration** (6 plugins + 78 IPC commands):
TracePilot registers 6 plugins in `main.rs:22-54`, including the custom TracePilot plugin which registers **78 IPC commands** via `invoke_handler`. Plugin initialization is synchronous at startup. The `tauri_plugin_log` plugin with 3 targets (Stdout, LogDir, Webview) may add measurable startup latency.

**WebView cold start**:
Tauri uses the system WebView (WebView2 on Windows, WebKitGTK on Linux, WKWebView on macOS). First-launch performance characteristics include:
- **Windows WebView2**: First launch may trigger runtime download/install (~50-100MB), adding significant delay
- **All platforms**: WebView process spawns with ~50-100MB baseline memory overhead
- **Subsequent launches**: Warm cache makes startup significantly faster
- **GPU compositing**: Behavior varies across platforms; can affect animation smoothness

These are largely outside application control but worth measuring for baseline expectations.

---

## 6. Identified Performance Bottlenecks

### 6.1 Rust Backend

#### 🔴 B1: JSON Value Cloning in Event Deserialization

**File**: `crates/tracepilot-core/src/parsing/events.rs:164-177`

```rust
macro_rules! try_deser {
    ($variant:ident, $data_type:ty, $wire:expr, $data:expr) => {{
        match serde_json::from_value::<$data_type>($data.clone()) {  // ← clone
            Ok(typed) => (TypedEventData::$variant(typed), None),
            Err(e) => (
                TypedEventData::Other($data.clone()),               // ← clone again on error
                Some(EventParseWarning::DeserializationFailed { ... }),
            ),
        }
    }};
}
```

**Impact**: For a session with 1000 events, this performs 1000+ deep clones of `serde_json::Value` trees. Each `Value` can contain nested objects/arrays, making this one of the most allocation-heavy operations.

**Why this is hard to fix incrementally**: The function signature takes `data: &Value` (a reference), so `from_value` must clone to get an owned value. Removing the error-path clone is trivial but nearly zero-impact (errors are rare). The **real fix** requires a deeper change:

**Option A — Change function signature to take owned `Value`**: Modify `typed_data_from_raw` to accept `data: Value` instead of `&Value`. This eliminates the success-path clone at the cost of requiring the caller (`parse_typed_events`) to pass ownership. The error-path fallback `TypedEventData::Other(data)` would then also be free. The caller at `events.rs:316` currently passes `&raw.data` — switching to `raw.data` (move) with minor restructuring would work since `raw` is consumed in the loop.

**Option B — Tagged enum deserialization (long-term)**: Eliminate the intermediate `Value` entirely by deserializing directly from the raw JSON string. See [§7.1.1](#711-zero-copy-deserialization) for details. This is a larger effort (estimated 3-5 days with compatibility testing) but delivers the biggest allocation reduction.

#### 🟠 B2: No Vec Pre-allocation in Raw JSONL Parsing

**File**: `crates/tracepilot-core/src/parsing/events.rs:127`

```rust
let mut events = Vec::new();  // No capacity hint
```

**Note**: The *typed event* stage (`parse_typed_events` at line 312) already correctly uses `Vec::with_capacity(raw_events.len())`. This issue only affects the raw parsing stage.

For large sessions (10K+ events), the Vec will reallocate ~13 times (doubling strategy). A simple file-size heuristic (avg ~200 bytes/event) would save most reallocations:

```rust
let file_size = std::fs::metadata(path)?.len();
let estimated_events = (file_size / 200) as usize;
let mut events = Vec::with_capacity(estimated_events);
```

#### 🟡 B3: Sequential Session Indexing (No Parallelism)

**File**: `crates/tracepilot-indexer/src/lib.rs:136-240`

Session indexing processes sessions one at a time in a single `for` loop. While SQLite writes must be serialized, the expensive operations (file I/O, JSONL parsing, analytics computation) could be parallelized using `rayon` and then batched into SQLite transactions.

**Important**: `rusqlite::Connection` is `!Send`, so the DB object cannot be shared across rayon threads. The correct pattern is: (1) sequentially identify sessions needing reindex, (2) parallelize the I/O-heavy parse/prepare phase, (3) sequentially write results to SQLite:

```rust
// Step 1: Sequential — identify what needs reindexing (requires DB access)
let to_reindex: Vec<_> = sessions.iter()
    .filter(|s| db.needs_reindex(&s.id, &s.path))
    .collect();

// Step 2: Parallel — CPU/IO-heavy parsing (no DB access)
let prepared: Vec<_> = to_reindex.par_iter()
    .map(|s| (s, load_and_prepare(&s.path)))
    .collect();

// Step 3: Sequential — write to SQLite (requires DB access)
db.begin_transaction()?;
for (session, prepared_data) in prepared {
    db.write_prepared(session, prepared_data)?;
}
db.commit_transaction()?;
```

#### 🟡 B4: String Cloning in Analytics Aggregation

**File**: `crates/tracepilot-core/src/analytics/aggregator.rs:52+`

The aggregation loop clones model names and date strings for HashMap keys:

```rust
let entry = model_tokens.entry(model_name.clone()).or_insert((0, 0, 0, 0, 0.0, 0));
```

For 100+ sessions with 5+ models each, this creates hundreds of unnecessary string allocations. Consider using `Cow<str>` or interning model names.

#### 🟠 B5: `opt-level = "s"` in Release Profile

**File**: `Cargo.toml:50`

Switching from `opt-level = "s"` to `opt-level = "2"` provides ~10-15% speedup for CPU-bound parsing and aggregation. The binary size increase (~20-30%) is acceptable for a desktop application. `opt-level = "3"` is more aggressive but can occasionally cause regressions due to heavy inlining; `"2"` is the safer choice.

### 6.2 Frontend

#### 🔴 B6: No Virtual Scrolling for Large Lists

**Files**: `apps/desktop/src/views/SessionListView.vue`, `ConversationTab.vue`

Session lists render all items into the DOM. With 1000+ sessions, this creates thousands of DOM nodes with transition effects and nested badges. The conversation tab similarly renders all turns.

**Fix**: Implement virtual scrolling with `@tanstack/vue-virtual` or `vue-virtual-scroller`:

```vue
<!-- Before -->
<div v-for="session in store.filteredSessions" :key="session.id">
  <SessionCard :session="session" />
</div>

<!-- After -->
<VirtualList :items="store.filteredSessions" :item-size="72" v-slot="{ item }">
  <SessionCard :session="item" />
</VirtualList>
```

#### 🟡 B7: Multiple Filter Passes in `filteredSessions` Computed

**File**: `apps/desktop/src/stores/sessions.ts:25-68`

```typescript
const filteredSessions = computed(() => {
    let result = sessions.value;
    result = result.filter(s => ...);  // Pass 1: hide empty
    result = result.filter(s => ...);  // Pass 2: search query (3× toLowerCase per item!)
    result = result.filter(s => ...);  // Pass 3: filter repo
    result = result.filter(s => ...);  // Pass 4: filter branch
    const sorted = [...result];        // Copy array
    sorted.sort((a, b) => { ... });    // Sort
    return sorted;
});
```

Four sequential `.filter()` calls create four intermediate arrays. Additionally, `toLowerCase()` is called on every session field on every keystroke. This should be a single pass with memoized lowercase values:

```typescript
const filteredSessions = computed(() => {
    const prefs = usePreferencesStore();
    const q = searchQuery.value?.toLowerCase();
    const repo = filterRepo.value;
    const branch = filterBranch.value;
    const hideEmpty = prefs.hideEmptySessions;

    // Single-pass filter
    const result: SessionListItem[] = [];
    for (const s of sessions.value) {
        if (hideEmpty && (s.turnCount ?? 0) === 0) continue;
        if (q && !(
            s.summary?.toLowerCase().includes(q) ||
            s.repository?.toLowerCase().includes(q) ||
            s.branch?.toLowerCase().includes(q) ||
            s.id.toLowerCase().includes(q)
        )) continue;
        if (repo && s.repository !== repo) continue;
        if (branch && s.branch !== branch) continue;
        result.push(s);
    }
    result.sort((a, b) => { ... });
    return result;
});
```

For the `toLowerCase()` issue, if session lists are large, consider pre-computing lowercased search fields when sessions are loaded.

#### 🟡 B8: Cascading Computed Properties in Timeline Views

**Files**: `NestedSwimlanesView.vue`, `AgentTreeView.vue`, `TurnWaterfallView.vue`

Timeline views build cascading computed chains:

```
turns → allToolCalls (flatMap) → groupedPhases → rendering
```

Every turn change triggers `flatMap()` which creates a new array of all tool calls. With 100 turns × 50 tool calls = 5000 items, this is expensive. Consider using `shallowRef` for large intermediate arrays or breaking the dependency chain with explicit dirty tracking.

#### 🟡 B9: No Vite Build Optimization

**File**: `apps/desktop/vite.config.ts`

```typescript
export default defineConfig({
    plugins: [vue(), tailwindcss()],
    // No build optimization config
});
```

Missing optimizations:
- **`build.rollupOptions.output.manualChunks`** — separate vendor and feature chunks for better caching
- **Dynamic import for heavy deps** — `markdown-it` + `dompurify` (~150KB) loaded eagerly in `@tracepilot/ui`

Note: Vite's default esbuild minifier is appropriate; terser is not inherently better for this use case. CSS splitting is also handled well by Tailwind's JIT approach.

#### 🟡 B10: Deep Watchers on Complex Objects

**File**: `apps/desktop/src/stores/preferences.ts:319-339`

```typescript
watch([theme, costPerPremiumRequest, modelWholesalePrices, ... 15 more],
      scheduleSave, { deep: true });
```

`{ deep: true }` on `modelWholesalePrices` (an array of objects) means Vue traverses the entire array on every reactivity check. For preferences, this is called infrequently so impact is low, but it's an anti-pattern that should be avoided for frequently-changing data.

#### 🟡 B11: Triple Nested `v-for` in Timeline Rendering

**File**: `NestedSwimlanesView.vue`

```vue
<template v-for="phase in groupedPhases" :key="phase.id">
  <div v-for="turn in phase.turns" :key="turn.id">
    <div v-for="(agent, agentIdx) in subagents(turn)" :key="agentIdx">
      <div v-for="(tc, idx) in nestedTools(turn, agent)" :key="tc.toolCallId">
```

O(n⁴) worst-case rendering complexity. Each `subagents()` and `nestedTools()` call is a function invocation during render — these should be pre-computed in a `computed` property.

### 6.3 Tauri IPC Layer

#### 🟡 B12: Turn Cache Lock Contention

**File**: `crates/tracepilot-tauri-bindings/src/commands/session.rs:182-206`

```rust
{
    let Ok(mut lru) = cache.lock() else { ... };
    if let Some(cached) = lru.get(&session_id) {
        if cached.events_file_size == file_size {
            let mut turns = cached.turns.clone();          // ← Expensive clone UNDER lock
            tracepilot_core::turns::prepare_turns_for_ipc(&mut turns); // ← IPC prep UNDER lock
            return Ok(TurnsResponse { turns, ... });
        }
    }
}
```

The Mutex is held while cloning the entire turn vector AND running `prepare_turns_for_ipc`. For sessions with hundreds of turns (each containing messages, tool calls, results), this clone can take milliseconds. During that time, all other concurrent `get_session_turns` calls block on the lock.

**Fix**: Extract the cached data from the lock scope quickly, then clone/trim outside:

```rust
let cached_turns = {
    let Ok(mut lru) = cache.lock() else { ... };
    lru.get(&session_id)
        .filter(|c| c.events_file_size == file_size)
        .map(|c| c.turns.clone())  // Still clones, but consider Arc<Vec<Turn>> to avoid
};
if let Some(mut turns) = cached_turns {
    tracepilot_core::turns::prepare_turns_for_ipc(&mut turns); // Outside lock
    return Ok(TurnsResponse { turns, events_file_size: file_size });
}
```

Better yet, wrap turns in `Arc<Vec<ConversationTurn>>` so cache hits only bump a reference count instead of deep-cloning.

#### 🟠 B13: Full Turn Payloads Over IPC

`get_session_turns` serializes the complete turn list to JSON for IPC. For sessions with 500+ turns (each containing messages, tool calls, results), this can be several MB of JSON. Consider pagination or lazy loading of turn details.

#### 🟠 B14: CSS `transition: all` Anti-Pattern

Multiple components use `transition: all var(--transition-fast)` which animates *every* CSS property on change. This forces the browser to check all animatable properties, which is more expensive than targeting specific properties (`transition: opacity 150ms, transform 150ms`). While individually minor, this adds up across the many interactive elements in the UI.

#### 🟠 B15: IndexingLoadingScreen Animation CPU Cost

The `IndexingLoadingScreen` component runs 5+ concurrent infinite `@keyframes` animations (logo glow, ripple pulse, particle drift, etc.). During indexing — which is already CPU-intensive in the Rust backend — these animations compete for main-thread paint budget and can cause frame drops.

#### 🟠 B16: No SQLite ANALYZE/VACUUM Scheduling

No `ANALYZE` or `VACUUM` calls were found in the codebase. For a database that grows over time with incremental indexing:
- **`ANALYZE`** updates query planner statistics, ensuring indexes are used effectively
- **`VACUUM`** reclaims space from deleted rows (relevant after session pruning)

Consider running `PRAGMA optimize` periodically (already called after bulk writes in the indexer — good) and scheduling `ANALYZE` after significant data changes.

---

## 7. Industry-Standard Optimization Techniques (Tailored)

### 7.1 Rust Backend Optimizations

#### 7.1.1 Zero-Copy Deserialization

**Current**: JSONL events are read as strings, parsed into `serde_json::Value`, then deserialized into typed structs via `from_value` (which requires cloning the Value).

**Industry standard**: Use `serde_json::from_str` with tagged enum deserialization to go directly from raw JSON to typed structs in a single pass:

```rust
#[derive(Deserialize)]
#[serde(tag = "type", content = "data")]
enum TypedRawEvent {
    #[serde(rename = "session.start")]
    SessionStart(SessionStartData),
    #[serde(rename = "user.message")]
    UserMessage(UserMessageData),
    // ... 30+ variants
    #[serde(other)]
    Unknown,
}
```

This eliminates the intermediate `Value` tree entirely, reducing allocations by 50%+ during parsing.

**Caveat**: This is a significant refactor (estimated 3-5 days with compatibility testing). The current two-phase approach (RawEvent → TypedEventData) serves important purposes:
- Preserves raw JSON for unknown event types (`TypedEventData::Other`)
- Generates detailed diagnostic warnings per event
- The events also have fields outside the enum discriminant (`id`, `timestamp`, `parentId`) which adjacent tagging doesn't handle directly

A hybrid approach using `serde_json::value::RawValue` can preserve raw JSON for unknown types without full `Value` parsing. The outer envelope (`RawEvent`) would still parse `id`, `timestamp`, etc., while the inner `data` field uses `RawValue` and defers typed deserialization.

#### 7.1.2 Parallel I/O with Rayon

**Current**: Session discovery and parsing are sequential.

**Industry standard**: Use `rayon::par_iter` for embarrassingly parallel file I/O operations. **Important**: `rusqlite::Connection` is `!Send`, so all DB operations must remain on a single thread. The pattern is: identify work sequentially (needs DB), parse in parallel (no DB), write sequentially (needs DB):

```rust
use rayon::prelude::*;

// Phase 1: Sequential — check what needs reindexing (DB access)
let to_process: Vec<_> = discovered_sessions
    .iter()
    .filter(|s| s.has_workspace_yaml && db.needs_reindex(&s.id, &s.path))
    .collect();

// Phase 2: Parallel — CPU/IO-heavy parsing (no DB access)
let prepared: Vec<_> = to_process
    .par_iter()
    .filter_map(|s| load_session_summary(&s.path).ok().map(|summary| (s, summary)))
    .collect();

// Phase 3: Sequential — write to SQLite
db.begin_transaction()?;
for (session, summary) in &prepared {
    db.write_session(session, summary)?;
}
db.commit_transaction()?;
```

Rayon is already the standard for Rust data parallelism and integrates naturally with the existing sequential code.

#### 7.1.3 String Interning for Repeated Values

Model names, tool names, and repository names are repeated across thousands of events and sessions. String interning avoids redundant allocations. Use the [`string_interner`](https://crates.io/crates/string_interner) crate for a production-ready, safe implementation:

```rust
use string_interner::{StringInterner, DefaultSymbol};

let mut interner = StringInterner::default();
let sym: DefaultSymbol = interner.get_or_intern("gpt-4");
// sym is a lightweight handle; identical strings share the same symbol
```

This avoids repeated heap allocations for the same model/tool names across sessions.

#### 7.1.4 Targeted Allocation Reduction

The turn reconstruction state machine (`turns/mod.rs`) creates many small allocations (AttributedMessage, ToolCall structs). While arena allocation with `bumpalo` would batch these into a single allocation, **this doesn't apply to TracePilot's architecture** because turns outlive parsing — they're stored in the LRU cache and serialized over IPC.

Instead, focus on reducing *unnecessary* allocations:
- Use `Cow<'_, str>` for fields that are usually string literals (tool names, model names)
- Pre-size `HashMap`s and `Vec`s with `with_capacity()` based on expected sizes
- Avoid intermediate `String::from()` / `.to_string()` in loops — prefer borrowing where possible
- Consider `SmallVec` (from the `smallvec` crate) for collections that are usually small (e.g., tool call args)

#### 7.1.5 SQLite Prepared Statement Caching

**Current**: Some queries are constructed dynamically with `format!()`.

**Industry standard**: Use prepared statement caching via `rusqlite::CachedStatement`:

```rust
// Current
let sql = format!("SELECT ... FROM sessions {}", where_clause);
conn.query_row(&sql, params, |row| { ... })?;

// Better — cached prepared statements
let mut stmt = conn.prepare_cached("SELECT ... FROM sessions WHERE created_at >= ?1")?;
stmt.query_row(params![date], |row| { ... })?;
```

`prepare_cached` reuses compiled SQL plans, saving 5-10μs per query.

#### 7.1.6 Memory-Mapped I/O for Very Large JSONL Files

For very large `events.jsonl` files (>10MB / 50K+ events), memory-mapped I/O avoids kernel copy overhead:

```rust
use memmap2::Mmap;

let file = std::fs::File::open(path)?;
let mmap = unsafe { Mmap::map(&file)? };
let content = std::str::from_utf8(&mmap)?;

for line in content.lines() {
    // Parse directly from mmap'd memory — no heap allocation for line reads
}
```

This is particularly effective when combined with SIMD-accelerated JSON parsing (`simd-json` crate).

**Threshold**: For typical TracePilot sessions (<1MB JSONL), `BufReader` is likely faster due to lower setup overhead (no page table setup, no TLB misses). Only consider mmap for files >10MB. Benchmark before adopting.

### 7.2 Frontend Optimizations

#### 7.2.1 Virtual Scrolling

The #1 frontend optimization for TracePilot. With `@tanstack/vue-virtual`:

```typescript
import { useVirtualizer } from '@tanstack/vue-virtual';

const virtualizer = useVirtualizer({
    count: filteredSessions.value.length,
    getScrollElement: () => scrollContainerRef.value,
    estimateSize: () => 72,    // estimated row height
    overscan: 5,               // render 5 extra items above/below
});
```

This renders only ~20-30 visible items instead of 1000+, reducing DOM nodes by 95%+.

#### 7.2.2 Computed Memoization with `shallowRef`

For large derived arrays that don't need deep reactivity:

```typescript
import { shallowRef, triggerRef } from 'vue';

const allToolCalls = shallowRef<ToolCall[]>([]);

watch(() => store.turns, (turns) => {
    allToolCalls.value = turns.flatMap(t => t.toolCalls);
    triggerRef(allToolCalls);
}, { deep: false });
```

`shallowRef` prevents Vue from tracking every item in the array, only triggering updates when the reference changes.

#### 7.2.3 Web Workers for Expensive Computations

Move CPU-intensive frontend work off the main thread:

```typescript
// worker.ts
self.onmessage = (e: MessageEvent) => {
    const { sessions, query, filters } = e.data;
    const result = filterAndSortSessions(sessions, query, filters);
    self.postMessage(result);
};

// store
const worker = new Worker(new URL('./filter-worker.ts', import.meta.url));
worker.postMessage({ sessions: rawSessions, query, filters });
worker.onmessage = (e) => { filteredSessions.value = e.data; };
```

#### 7.2.4 Bundle Splitting Strategy

```typescript
// vite.config.ts — add to build config
export default defineConfig({
    build: {
        rollupOptions: {
            output: {
                manualChunks: {
                    'vendor-vue': ['vue', 'vue-router', 'pinia'],
                    'vendor-tauri': ['@tauri-apps/api', '@tauri-apps/plugin-dialog',
                                     '@tauri-apps/plugin-log', '@tauri-apps/plugin-opener',
                                     '@tauri-apps/plugin-process', '@tauri-apps/plugin-updater'],
                    'markdown': ['markdown-it', 'dompurify'],
                },
            },
        },
    },
});
```

This separates rarely-changing vendor code from application code, improving cache efficiency during development. Note: for a Tauri desktop app, network caching is less critical than for web apps — all assets are local. The primary benefit is **development DX** (faster rebuilds) and **lazy loading of heavy deps** like `markdown-it`. Measure chunk sizes with `rollup-plugin-visualizer` before and after to validate impact.

#### 7.2.5 Debounced Search Input

**Current**: Search query changes immediately trigger `filteredSessions` recomputation.

**Standard**: Debounce search input to avoid recomputation on every keystroke:

```typescript
import { useDebounceFn } from '@vueuse/core';

const rawSearchQuery = ref('');
const debouncedSearchQuery = ref('');
const updateSearch = useDebounceFn((val: string) => {
    debouncedSearchQuery.value = val;
}, 200);

watch(rawSearchQuery, updateSearch);
```

The `filteredSessions` computed then uses `debouncedSearchQuery` instead of the raw input.

#### 7.2.6 Lazy Loading Heavy Dependencies

```typescript
// Instead of top-level import
import markdownIt from 'markdown-it';
import DOMPurify from 'dompurify';

// Use dynamic import
const renderMarkdown = async (content: string) => {
    const [{ default: markdownIt }, { default: DOMPurify }] = await Promise.all([
        import('markdown-it'),
        import('dompurify'),
    ]);
    const md = markdownIt();
    return DOMPurify.sanitize(md.render(content));
};
```

---

## 8. Benchmarking Strategy — Replacing & Extending tracepilot-bench

### 8.1 Assessment of Current Setup

The current `tracepilot-bench` crate uses **Criterion 0.5** with `html_reports` enabled. Criterion is still the gold standard for Rust benchmarking and is actively maintained. However, the benchmarks have gaps.

### 8.2 Recommended Benchmark Framework

**Keep Criterion 0.5** as the primary framework — it's not outdated. Criterion provides:
- Statistical analysis (confidence intervals, noise detection)
- Regression detection across runs
- HTML reports with comparison charts
- Throughput measurement (bytes/sec, elements/sec)
- Integration with CI via `benchmark-action/github-action-benchmark`

**Add complementary tools:**

| Tool | Purpose | When to Use |
|------|---------|-------------|
| **[`criterion`](https://crates.io/crates/criterion) 0.5** | Statistical microbenchmarks | Core hot-path benchmarks (keep) |
| **[`divan`](https://github.com/nvzqz/divan)** | Attribute-based benchmarks (simpler API) | Quick one-off benchmarks during development |
| **[`iai-callgrind`](https://github.com/iai-callgrind/iai-callgrind)** | Instruction-count benchmarks (deterministic, CI-stable) | CI regression detection (no noise from CPU frequency scaling) |
| **[`dhat-rs`](https://docs.rs/dhat)** | Allocation profiling in benchmarks | Memory efficiency benchmarks |
| **Custom Tauri IPC benchmarks** | End-to-end IPC latency | Integration benchmarks |

### 8.3 Recommended New Benchmarks

#### Parsing Benchmarks (extend `parsing.rs`)

```rust
// Add: Real-world session benchmarks (use actual captured session fixtures)
fn bench_parse_real_session(c: &mut Criterion) {
    let fixture = Path::new("fixtures/real-session-500-events");
    c.bench_function("parse_real_session_500", |b| {
        b.iter(|| parse_typed_events(&fixture.join("events.jsonl")).unwrap())
    });
}

// Add: Memory allocation profiling
fn bench_parse_allocations(c: &mut Criterion) {
    // Use dhat-rs to count allocations during parsing
}

// Add: Throughput at scale
fn bench_parse_typed_events_large(c: &mut Criterion) {
    for size in [100, 1000, 5000, 10000, 50000] { ... }
}
```

#### Indexer Benchmarks (extend `indexer.rs`)

```rust
// Add: Incremental reindex (most common real-world operation)
fn bench_incremental_reindex(c: &mut Criterion) {
    // Pre-populate DB, change 10% of sessions, reindex
}

// Add: Concurrent read during write
fn bench_concurrent_read_write(c: &mut Criterion) {
    // Simulate UI reading analytics while indexing runs
}

// Add: FTS search with various query types
fn bench_fts_search_variants(c: &mut Criterion) {
    for query in ["simple word", "multi word query", "exact \"phrase match\"", "tool:grep"] {
        ...
    }
}
```

#### IPC Benchmarks (new `ipc.rs`)

```rust
// Benchmark IPC serialization/deserialization
fn bench_ipc_turn_serialization(c: &mut Criterion) {
    let turns = generate_turns(100);
    c.bench_function("serialize_100_turns", |b| {
        b.iter(|| serde_json::to_string(&turns).unwrap())
    });
}
```

#### Memory Benchmarks (new `memory.rs`)

```rust
// Using dhat-rs for allocation profiling
#[global_allocator]
static ALLOC: dhat::Alloc = dhat::Alloc;

fn bench_memory_parse_session(c: &mut Criterion) {
    let _profiler = dhat::Profiler::builder().testing().build();
    // Parse session, then check dhat stats
    let stats = dhat::HeapStats::get();
    println!("Total allocations: {}", stats.total_blocks);
    println!("Peak memory: {} bytes", stats.max_bytes);
}
```

### 8.4 `iai-callgrind` for CI-Stable Benchmarks

Criterion benchmarks are noisy on CI runners (CPU frequency scaling, shared hardware). `iai-callgrind` counts instructions instead, making results deterministic:

```rust
use iai_callgrind::{library_benchmark, library_benchmark_group, main};

#[library_benchmark]
#[bench::small(100)]
#[bench::medium(1000)]
#[bench::large(10000)]
fn bench_parse_events(size: usize) -> Vec<TypedEvent> {
    let jsonl = generate_events_jsonl_string(size);
    // ...
    parse_typed_events(&path).unwrap().events
}

library_benchmark_group!(name = parsing; benchmarks = bench_parse_events);
main!(library_benchmark_groups = parsing);
```

**Platform caveat**: `iai-callgrind` requires Valgrind, which is **Linux-only** — it has zero Windows support, not even via WSL for cross-compiled Windows binaries. Since TracePilot is primarily developed on Windows, this tool is:
- ✅ Viable for **CI** (GitHub Actions runs `ubuntu-latest`)
- ❌ Not usable for **local development** on Windows
- ⚠️ Profiles **Linux execution characteristics**, which may differ from Windows

**Windows alternatives for local profiling**: Consider **Windows Performance Analyzer (WPA)** with ETW tracing, or **`cargo-show-asm`** for inspecting generated assembly on hot functions (works on all platforms).

### 8.5 Frontend Performance Benchmarks

For the Vue frontend, create a `performance.test.ts` suite in Vitest:

```typescript
import { describe, it, expect } from 'vitest';
import { performance } from 'perf_hooks';

describe('Performance', () => {
    it('filteredSessions computes in <10ms for 1000 sessions', () => {
        const store = createTestStore();
        store.sessions = generateSessions(1000);
        store.searchQuery = 'refactor';

        const start = performance.now();
        const result = store.filteredSessions;
        const elapsed = performance.now() - start;

        expect(elapsed).toBeLessThan(10);
        expect(result.length).toBeGreaterThan(0);
    });
});
```

---

## 9. Recommended Performance Infrastructure

### 9.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                  Performance Infrastructure              │
├──────────────────┬──────────────────┬───────────────────┤
│   Development    │       CI         │   Production      │
├──────────────────┼──────────────────┼───────────────────┤
│ cargo-flamegraph │ Criterion bench  │ tracing spans     │
│ dhat-rs profiler │ iai-callgrind    │ IPC timing logs   │
│ Vue DevTools     │ Bundle analysis  │ Performance marks  │
│ Chrome DevTools  │ Typecheck perf   │ Long task observer│
│ tokio-console    │ Binary size track│                   │
│ rollup-visualize │                  │                   │
└──────────────────┴──────────────────┴───────────────────┘
```

### 9.2 Implementation: `tracing` Instrumentation Layer

Add structured tracing spans to key Rust functions. These are zero-cost in production when no subscriber is active (current TracePilot behavior), but enable profiling when a subscriber is configured:

```rust
// crates/tracepilot-core/src/parsing/events.rs
// Use #[instrument] on the outer function for automatic span creation.
// Add sub-spans for finer-grained profiling of distinct phases.
#[tracing::instrument(skip(path), fields(path = %path.display()))]
pub fn parse_typed_events(path: &Path) -> Result<ParsedEvents> {
    let (raw_events, malformed) = parse_events_jsonl(path)?;

    let _dispatch_span = tracing::info_span!("type_dispatch", event_count = raw_events.len()).entered();
    // ... typed_data_from_raw loop
}

// crates/tracepilot-indexer/src/lib.rs
#[tracing::instrument(skip_all, fields(session_count = sessions.len()))]
pub fn reindex_incremental(sessions: &[DiscoveredSession], db: &IndexDb) -> Result<IndexStats> {
    // ...
}

// crates/tracepilot-tauri-bindings/src/commands/analytics.rs
#[tracing::instrument(skip(state))]
pub async fn get_analytics(state: State<'_, SharedConfig>, ...) -> CmdResult<AnalyticsData> {
    // ...
}
```

### 9.3 Implementation: Frontend Performance Monitor Composable

Create a reusable composable that instruments Vue component lifecycle and IPC calls:

```typescript
// apps/desktop/src/composables/usePerfMonitor.ts
import { onMounted, onUnmounted, getCurrentInstance } from 'vue';
import { logDebug } from '@/utils/logger';

interface PerfEntry {
    name: string;
    duration: number;
    timestamp: number;
}

const perfLog: PerfEntry[] = [];

export function usePerfMonitor(label?: string) {
    const instance = getCurrentInstance();
    const componentName = label || instance?.type.__name || 'Unknown';
    let mountStart: number;

    onMounted(() => {
        const duration = performance.now() - mountStart;
        const entry = { name: `${componentName}:mount`, duration, timestamp: Date.now() };
        perfLog.push(entry);
        if (duration > 50) {
            logDebug(`[perf] ${componentName} mount took ${duration.toFixed(1)}ms`);
        }
    });

    mountStart = performance.now();

    return {
        mark: (name: string) => performance.mark(`${componentName}:${name}`),
        measure: (name: string, startMark: string) => {
            const measure = performance.measure(
                `${componentName}:${name}`,
                `${componentName}:${startMark}`
            );
            return measure.duration;
        },
        getLog: () => [...perfLog],
    };
}

// Usage in a view:
// const { mark, measure } = usePerfMonitor('SessionDetailView');
// mark('dataLoadStart');
// await store.loadSession(id);
// const loadTime = measure('dataLoad', 'dataLoadStart');
```

### 9.4 Implementation: IPC Timing Wrapper

Instrument the Tauri client to automatically log IPC roundtrip times:

```typescript
// packages/client/src/invoke.ts — add timing wrapper
import { invoke as tauriInvoke } from '@tauri-apps/api/core';

const IPC_SLOW_THRESHOLD_MS = 100;

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    const start = performance.now();
    try {
        const result = await tauriInvoke<T>(cmd, args);
        const elapsed = performance.now() - start;
        if (elapsed > IPC_SLOW_THRESHOLD_MS) {
            console.warn(`[ipc] Slow command: ${cmd} took ${elapsed.toFixed(1)}ms`, args);
        }
        return result;
    } catch (error) {
        const elapsed = performance.now() - start;
        console.error(`[ipc] Failed command: ${cmd} after ${elapsed.toFixed(1)}ms`, error);
        throw error;
    }
}
```

### 9.5 Implementation: Automated Performance Regression Detection in CI

Extend the existing `benchmark.yml` workflow:

```yaml
# .github/workflows/benchmark.yml — additions
- name: Run benchmarks with comparison
  run: |
    cargo bench -p tracepilot-bench -- --save-baseline current
    # Compare against stored baseline
    cargo bench -p tracepilot-bench -- --baseline previous --save-baseline current

- name: Check binary size
  run: |
    cargo build --release -p tracepilot-desktop
    SIZE=$(stat -c%s target/release/tracepilot-desktop || echo "0")
    echo "binary_size=$SIZE" >> $GITHUB_OUTPUT
    echo "Binary size: $(numfmt --to=iec $SIZE)"

- name: Check bundle size
  run: |
    cd apps/desktop && pnpm build
    BUNDLE_SIZE=$(du -sb dist | cut -f1)
    echo "bundle_size=$BUNDLE_SIZE" >> $GITHUB_OUTPUT
    echo "Bundle size: $(numfmt --to=iec $BUNDLE_SIZE)"
```

### 9.6 Making This AI-Agent Friendly

For AI agents (like Copilot, Cursor, or custom agents) to effectively find and fix performance issues, the infrastructure should expose:

1. **Structured benchmark output** (JSON, not just HTML) — the current CI workflow already does this via `benchmark-output.json`

2. **Performance budget files** that agents can read and validate:

```json
// perf-budget.json
{
    "rust": {
        "parse_typed_events/1000": { "max_ns": 5000000, "unit": "ns/iter" },
        "query_analytics/100": { "max_ns": 1000000, "unit": "ns/iter" },
        "upsert_session": { "max_ns": 10000000, "unit": "ns/iter" }
    },
    "frontend": {
        "initial_bundle_size_kb": 500,
        "vendor_chunk_size_kb": 200,
        "filteredSessions_1000_ms": 10
    },
    "binary": {
        "release_size_mb": 15
    }
}
```

3. **`cargo perf-check` script** that agents can run:

```powershell
# scripts/perf-check.ps1
cargo bench -p tracepilot-bench --quiet 2>&1 | Select-String "time:"
cargo build --release 2>$null
$size = (Get-Item target/release/tracepilot-desktop.exe -ErrorAction SilentlyContinue)?.Length
Write-Host "Binary size: $([math]::Round($size / 1MB, 2)) MB"
```

4. **Inline performance annotations** in code comments that agents can reference:

```rust
/// Parse events from JSONL.
///
/// PERF: Hot path — called once per session during indexing.
/// Benchmark: `parse_typed_events` in tracepilot-bench.
/// Budget: <5ms for 1000 events.
pub fn parse_typed_events(path: &Path) -> Result<ParsedEvents> { ... }
```

---

## 10. Implementation Roadmap

### Phase 1: Quick Wins (Low effort, high impact)

| Item | Effort | Impact | Bottleneck | Description |
|------|--------|--------|------------|-------------|
| Change `opt-level = "s"` → `"2"` | 1 line | ~10% faster runtime | B5 | Balanced size/speed optimization |
| Add `Vec::with_capacity` to JSONL parser | 3 lines | Reduces reallocations | B2 | Estimate capacity from file size |
| Single-pass filter in `filteredSessions` | 20 lines | Fewer intermediate arrays | B7 | Combine 4 filter calls into one loop |
| Add `rollup-plugin-visualizer` | 5 lines | Bundle size visibility | B9 | Add to vite.config.ts |
| Debounce search input in sessions store | 10 lines | No recompute per keystroke | B7 | Use `watchDebounced` or `useDebounceFn` |
| Reduce turn cache lock scope | 10 lines | Less contention | B12 | Clone outside Mutex guard |

### Phase 2: Instrumentation & Measurement (Establish baselines before optimizing)

| Item | Effort | Impact | Description |
|------|--------|--------|-------------|
| IPC timing wrapper in client package | 1 hour | IPC latency visibility | Instrument `invoke()` — see §9.4 |
| Add `tracing::instrument` spans to hot paths | 1 day | Full profiling capability | Annotate ~20 key functions — see §9.2 |
| Add `rollup-plugin-visualizer` for bundle analysis | 30 min | Understand chunk composition | Measure before splitting |
| Run existing Criterion benchmarks and record baselines | 1 hour | Ground truth for all claims | `cargo bench -p tracepilot-bench` |
| Profile `get_session_turns` lock hold time | 1 hour | Validate B12 impact | Add timing around cache operations |

### Phase 3: Structural Improvements (Medium effort)

| Item | Effort | Impact | Bottleneck | Description |
|------|--------|--------|------------|-------------|
| Virtual scrolling for session list | 1-2 days | 95% fewer DOM nodes for large lists | B6 | `@tanstack/vue-virtual` — depends on row height strategy + keyboard nav |
| Vite manual chunks configuration | 1 hour | Better caching, smaller initial load | B9 | Split vendor/feature/markdown chunks — measure first |
| Lazy-load markdown-it/dompurify | 1 hour | ~150KB off initial bundle | B9 | Dynamic import in `@tracepilot/ui` |
| Pre-compute lowercased search fields | 1 hour | Faster search filtering | B7 | Cache on session load |
| Fix CSS `transition: all` to target specific properties | 2 hours | Smoother animations | B14 | Audit and replace |

### Phase 4: Advanced Optimizations (Higher effort, measure impact first)

| Item | Effort | Impact | Bottleneck | Description |
|------|--------|--------|------------|-------------|
| Parallel session indexing with rayon | 3-5 days | 2-4× faster bulk reindex | B3 | Parse in parallel, write sequentially; see §7.1.2 |
| Refactor `typed_data_from_raw` to take owned `Value` | 1-2 days | Fewer allocations in parsing | B1 | Change function signature; update call site |
| Tagged enum deserialization (long-term) | 3-5 days | ~50% fewer allocations in parsing | B1 | Major refactor with compatibility concerns |
| `iai-callgrind` CI benchmarks | 1 day | Deterministic regression detection | — | Linux-only CI job |
| `dhat-rs` memory profiling feature flag | 1 day | Memory allocation visibility | — | Gate behind `profile` feature |
| Frontend performance test suite | 2 days | Automated perf regression detection | — | Vitest perf assertions |
| Performance budget CI check | 1 day | Prevent regressions | — | JSON budget + validation script |
| Virtual scrolling for conversation tab | 2-3 days | Handle 500+ turn sessions | B6 | Variable-height virtual list; impacts multiple views |
| Turn pagination over IPC | 2-3 days | Smaller IPC payloads | B13 | Impacts API contract (`packages/client`) + views |
| Add `ANALYZE` scheduling after significant index changes | 2 hours | Better SQLite query plans | B16 | Run after bulk reindex |

### Phase 5: Continuous Improvement

| Item | Effort | Impact | Description |
|------|--------|--------|-------------|
| `usePerfMonitor` composable | 1 day | Component-level timing in dev | Mount time, render tracking |
| Long task observer in production | 2 hours | Detect UI jank | Alert on >50ms main thread blocks |
| SQLite query profiling with `connection.profile()` | 1 day | Query-level timing | Log slow queries |
| Real-world session fixtures for benchmarks | 1 day | Realistic benchmark data | Capture anonymized real sessions |
| `tokio-console` integration for dev | 2 hours | Async task debugging | Add console-subscriber feature flag |
| Profile-Guided Optimization (PGO) | 1-2 days | 5-15% additional runtime speedup | Collect profiles from benchmark runs, feed back into compiler |
| Throttle/batch indexing progress events | 2 hours | Less IPC overhead during indexing | Currently emits per-session progress |

---

## Appendix A: Tool Reference Matrix

### Rust Profiling Tools

| Tool | Type | Platform | Install | Usage |
|------|------|----------|---------|-------|
| `cargo-flamegraph` | CPU profiler | All | `cargo install flamegraph` | `cargo flamegraph --bench parsing` |
| `samply` | CPU profiler | Linux/macOS | `cargo install samply` | `samply record cargo bench` |
| `dhat-rs` | Heap profiler | All | Add to Cargo.toml | Feature-gated `#[global_allocator]` |
| `tokio-console` | Async profiler | All | `cargo install tokio-console` | Add `console-subscriber` |
| `cargo build --timings` | Compile time | All | Built-in | `cargo build --timings --release` |
| `cargo bloat` | Binary size | All | `cargo install cargo-bloat` | `cargo bloat --release` |
| `cargo udeps` | Unused deps | All | `cargo install cargo-udeps` | `cargo udeps --workspace` |
| `cargo-show-asm` | Assembly inspection | All | `cargo install cargo-show-asm` | `cargo asm tracepilot_core::parsing::events::parse_typed_events` |
| `iai-callgrind` | Instruction count | Linux | Add to Cargo.toml | CI-only deterministic benchmarks |

### Frontend Profiling Tools

| Tool | Type | Install | Usage |
|------|------|---------|-------|
| Vue DevTools | Component profiler | Browser extension | Open in Chromium DevTools |
| Chrome DevTools Performance | Runtime profiler | Built-in | Record → Analyze flame chart |
| Chrome DevTools Memory | Heap profiler | Built-in | Take heap snapshot |
| `rollup-plugin-visualizer` | Bundle analyzer | `pnpm add -D` | Add to vite.config.ts |
| `vite-plugin-inspect` | Build analyzer | `pnpm add -D` | Visit `/__inspect` in dev |
| `source-map-explorer` | Source map analyzer | `npx` | `npx source-map-explorer dist/**/*.js` |

### Benchmarking Frameworks

| Framework | Language | Type | Strengths | Weaknesses |
|-----------|----------|------|-----------|------------|
| Criterion 0.5 | Rust | Statistical | Gold standard, HTML reports, CI integration | Noisy on shared CI runners |
| `divan` | Rust | Attribute-based | Simple API, fast iteration | Less mature ecosystem |
| `iai-callgrind` | Rust | Instruction-count | Deterministic, CI-stable | Linux-only, slow |
| Vitest | TypeScript | Unit test-based | Integrated with existing test suite | Not a true profiler |
| `tinybench` | TypeScript | Microbenchmark | Lightweight, fast | Limited analysis |

---

*This report was generated through comprehensive static analysis of the TracePilot codebase (v0.5.1) and cross-validated by three independent AI reviewers (Claude Opus 4.6, GPT 5.4, GPT 5.3 Codex). All file paths and line numbers reference the codebase as of 2026-03-27. Recommendations are prioritized by impact-to-effort ratio and ordered for incremental adoption.*

---

## Appendix B: CLI App Performance Notes

The TypeScript CLI app (`apps/cli/`) operates independently from the Rust backend:

| Command | Approach | Performance Characteristic |
|---------|----------|--------------------------|
| `list` | Scans session directory directly in TypeScript | O(total sessions) — reads `workspace.yaml` per session |
| `search` | Streams `events.jsonl` line-by-line | O(total events across all sessions) — memory-friendly but CPU-intensive |
| `show` | Reads single session | Fast for individual sessions |
| `index` | Stub — not yet implemented | N/A |
| `versions` | Version analysis | Lightweight |

**Key insight**: Rust backend optimizations (SQL-based analytics, incremental indexing) **do not benefit the CLI app**, which bypasses the Rust indexer entirely and uses `better-sqlite3` directly. If CLI performance becomes a concern, consider:
- Implementing the `index` command to build a shared SQLite index
- Reusing the Rust indexer via NAPI bindings or a CLI binary
- Adding FTS search to the CLI via the existing index DB
