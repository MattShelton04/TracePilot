# Performance Phase 2: Instrumentation & Measurement

**Parent report**: [`docs/performance-analysis-report.md`](../performance-analysis-report.md)
**Effort**: 2–3 days total
**Prerequisites**: None (Phase 1 is recommended first but not required)
**Philosophy**: Measure first, optimize second. This phase establishes the infrastructure to identify what's actually slow before making speculative changes.

---

## Overview

Phase 2 creates the measurement layer — instrumentation, profiling infrastructure, and baseline recording — that informs all subsequent optimization phases. Without this layer, optimization effort is guesswork.

Every tool and annotation added here should be:
- **Zero-cost in production** (compile-time or feature-gated)
- **Self-documenting** (span names, budget files)
- **AI-agent friendly** (structured output, machine-readable budgets)

---

## Task 2.1 — Add `tracing::instrument` Spans to Hot Paths

| Field | Value |
|-------|-------|
| **Effort** | 3–4 hours |
| **Impact** | Enables flamegraph / trace profiling of all critical code paths |
| **Risk** | None — `tracing` spans are no-ops when no subscriber is attached (current production behavior) |
| **Dependencies** | None |

### Background

TracePilot already depends on `tracing` (via `tauri-plugin-log`). The `tracing` crate's `#[instrument]` attribute adds structured spans that integrate with `cargo-flamegraph`, `tokio-console`, and custom subscribers — all with zero overhead when no subscriber is active.

### Files to Modify

#### 1. `crates/tracepilot-core/src/parsing/events.rs`

```rust
use tracing::instrument;

#[instrument(skip(path), fields(path = %path.display()))]
pub fn parse_events_jsonl(path: &Path) -> Result<(Vec<Value>, usize)> {
    // existing code...
}

#[instrument(skip(path), fields(path = %path.display()))]
pub fn parse_typed_events(path: &Path) -> Result<ParsedEvents> {
    let (raw_events, malformed) = parse_events_jsonl(path)?;

    let _dispatch = tracing::info_span!("type_dispatch", count = raw_events.len()).entered();
    // existing typed_data_from_raw loop...
}
```

#### 2. `crates/tracepilot-indexer/src/lib.rs`

```rust
#[instrument(skip_all, fields(total = sessions.len()))]
pub fn reindex_incremental(
    sessions: &[DiscoveredSession],
    db: &IndexDb,
    on_progress: impl Fn(&IndexingProgress),
) -> Result<IndexStats> {
    // existing code...
}

// Also instrument upsert_session if it's a public method:
#[instrument(skip(self, path), fields(path = %path.display()))]
pub fn upsert_session(&self, path: &Path) -> Result<SessionInfo> {
    // existing code...
}
```

#### 3. `crates/tracepilot-tauri-bindings/src/commands/session.rs`

```rust
#[instrument(skip(state, turn_cache))]
pub async fn get_session_turns(
    state: State<'_, SharedConfig>,
    turn_cache: State<'_, TurnCache>,
    session_id: String,
) -> CmdResult<TurnsResponse> {
    // existing code...
}
```

#### 4. `crates/tracepilot-tauri-bindings/src/commands/analytics.rs`

```rust
#[instrument(skip(state))]
pub async fn get_analytics(
    state: State<'_, SharedConfig>,
    // ...
) -> CmdResult<AnalyticsData> {
    // existing code...
}
```

#### 5. `crates/tracepilot-core/src/analytics/` modules

Add `#[instrument]` to:
- `compute_analytics` in `dashboard.rs`
- `compute_tool_analysis` in `tools.rs`
- `compute_code_impact` in `code_impact.rs`

### Full List of Functions to Instrument (~20 total)

| Crate | Function | Why |
|-------|----------|-----|
| `tracepilot-core` | `parse_events_jsonl` | Hot path: I/O + JSON parsing |
| `tracepilot-core` | `parse_typed_events` | Hot path: deserialization bottleneck (B1) |
| `tracepilot-core` | `compute_analytics` | CPU: aggregation |
| `tracepilot-core` | `compute_tool_analysis` | CPU: tool aggregation |
| `tracepilot-core` | `compute_code_impact` | CPU: code impact analysis |
| `tracepilot-indexer` | `reindex_incremental` | Hot path: bulk indexing (B3) |
| `tracepilot-indexer` | `upsert_session` | Hot path: per-session indexing |
| `tracepilot-indexer` | `search_content` | Hot path: FTS search |
| `tracepilot-tauri-bindings` | `get_session_turns` | IPC: turn loading + cache (B12) |
| `tracepilot-tauri-bindings` | `get_session_list` | IPC: list rendering |
| `tracepilot-tauri-bindings` | `get_analytics` | IPC: dashboard data |
| `tracepilot-tauri-bindings` | `get_search_results` | IPC: search |
| `tracepilot-tauri-bindings` | `get_session_todos` | IPC: session detail tab |
| `tracepilot-tauri-bindings` | `get_session_plan` | IPC: session detail tab |
| `tracepilot-tauri-bindings` | `get_session_metrics` | IPC: session detail tab |
| `tracepilot-tauri-bindings` | `get_session_incidents` | IPC: session detail tab |
| `tracepilot-tauri-bindings` | `get_session_checkpoints` | IPC: session detail tab |
| `tracepilot-export` | `render_markdown` | Export: markdown generation |
| `tracepilot-export` | `render_json` | Export: JSON generation |
| `tracepilot-orchestrator` | `discover_sessions` | I/O: file system scan |

### Acceptance Criteria

- [ ] `cargo test --workspace` passes (spans are no-ops without subscriber)
- [ ] `cargo clippy --workspace` has no new warnings
- [ ] When a `tracing-subscriber` is enabled (e.g., `RUST_LOG=info`), spans appear in log output
- [ ] `cargo flamegraph --bench parsing` produces a flamegraph with span names visible

### Notes

- Use `skip` to avoid logging large data structures (state, file contents, turn vectors)
- Use `fields()` to add useful metadata (path, count, session_id)
- Don't instrument trivial getters or functions called millions of times per invocation

---

## Task 2.2 — IPC Timing Wrapper in Client Package

| Field | Value |
|-------|-------|
| **Effort** | 1 hour |
| **Impact** | Identifies slow IPC commands in development; enables perf budget enforcement |
| **Risk** | None — logging only, no behavioral change |
| **Dependencies** | None |

### Files to Modify

- **`packages/client/src/invoke.ts`**

### Current Code

```typescript
export async function invokePlugin<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(`plugin:tracepilot|${cmd}`, args);
}
```

### Change

Add timing instrumentation that logs slow commands and optionally reports to a performance collector:

```typescript
const IPC_SLOW_THRESHOLD_MS = 100;
const IPC_PERF_LOG: Array<{ cmd: string; duration: number; timestamp: number }> = [];

export async function invokePlugin<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  const start = performance.now();
  try {
    const result = await tauriInvoke<T>(`plugin:tracepilot|${cmd}`, args);
    recordIpcTiming(cmd, start);
    return result;
  } catch (error) {
    recordIpcTiming(cmd, start, true);
    throw error;
  }
}

function recordIpcTiming(cmd: string, start: number, failed = false) {
  const duration = performance.now() - start;
  IPC_PERF_LOG.push({ cmd, duration, timestamp: Date.now() });

  // Keep log bounded
  if (IPC_PERF_LOG.length > 500) IPC_PERF_LOG.splice(0, 250);

  if (duration > IPC_SLOW_THRESHOLD_MS) {
    const prefix = failed ? '[ipc:FAIL]' : '[ipc:SLOW]';
    console.warn(`${prefix} ${cmd} took ${duration.toFixed(1)}ms`);
  }
}

/** Retrieve IPC performance log (for dev tools / debugging) */
export function getIpcPerfLog() {
  return [...IPC_PERF_LOG];
}

/** Clear IPC performance log */
export function clearIpcPerfLog() {
  IPC_PERF_LOG.length = 0;
}
```

### Acceptance Criteria

- [ ] `pnpm --filter @tracepilot/client build` succeeds (if client has a build step)
- [ ] `pnpm --filter @tracepilot/desktop typecheck` passes
- [ ] In dev mode, slow IPC commands (>100ms) appear in console
- [ ] `getIpcPerfLog()` can be called from browser console for debugging

### Notes

- The `IPC_PERF_LOG` array is bounded to 500 entries to prevent memory leaks
- Consider making the threshold configurable via environment variable for CI testing
- The log is accessible from browser DevTools: `import('@tracepilot/client').then(m => console.table(m.getIpcPerfLog()))`

---

## Task 2.3 — Bundle Size Analysis and Baseline Recording

| Field | Value |
|-------|-------|
| **Effort** | 30 minutes |
| **Impact** | Establishes ground truth for bundle optimization decisions |
| **Risk** | None — analysis only |
| **Dependencies** | Task 1.4 (rollup-plugin-visualizer) recommended but can use `source-map-explorer` as alternative |

### Process

1. **Build production bundle and record sizes:**

```powershell
# Build
cd apps/desktop
pnpm build

# Record chunk sizes
Get-ChildItem dist/assets -Recurse | 
    Select-Object Name, @{N='SizeKB';E={[math]::Round($_.Length/1KB,1)}} | 
    Sort-Object SizeKB -Descending |
    Format-Table -AutoSize
```

2. **Generate treemap visualization:**

```powershell
$env:ANALYZE = "true"
pnpm --filter @tracepilot/desktop build
# Opens bundle-stats.html automatically
```

3. **Record baseline in a machine-readable format:**

Create `docs/plans/perf-baselines.json`:

```json
{
  "recorded_at": "YYYY-MM-DD",
  "git_sha": "<current HEAD>",
  "frontend": {
    "total_bundle_kb": 0,
    "largest_chunk_kb": 0,
    "chunk_count": 0,
    "chunks": {}
  },
  "backend": {
    "binary_size_mb": 0,
    "criterion_baselines": {}
  }
}
```

4. **Run Criterion benchmarks and record:**

```powershell
cargo bench -p tracepilot-bench -- --save-baseline phase2-baseline
```

### Acceptance Criteria

- [ ] `docs/plans/perf-baselines.json` exists with all fields populated
- [ ] Bundle visualization (treemap) has been inspected — note the top 5 largest modules
- [ ] Criterion baseline saved as `phase2-baseline`

---

## Task 2.4 — Profile `get_session_turns` Lock Hold Time

| Field | Value |
|-------|-------|
| **Effort** | 1 hour |
| **Impact** | Validates B12 impact — confirms whether lock contention is actually measurable |
| **Risk** | None — diagnostic code, removed after measurement |
| **Dependencies** | None |

### Approach

Add temporary timing instrumentation around the cache lock operations to measure actual lock hold time:

### Files to Modify

- **`crates/tracepilot-tauri-bindings/src/commands/session.rs`**

### Temporary Instrumentation

```rust
pub async fn get_session_turns(/* ... */) -> CmdResult<TurnsResponse> {
    // Add temporary timing
    let lock_start = std::time::Instant::now();
    let mut cache = turn_cache.lock().unwrap();
    let lock_acquired = lock_start.elapsed();

    if let Some(cached) = cache.get(&session_id) {
        if cached.events_file_size == current_size {
            let turns = cached.turns.clone();
            let clone_time = lock_start.elapsed() - lock_acquired;

            drop(cache); // explicit drop to measure
            let lock_total = lock_start.elapsed();

            let prep_start = std::time::Instant::now();
            let prepared = prepare_turns_for_ipc(&turns);
            let prep_time = prep_start.elapsed();

            tracing::info!(
                lock_acquire_us = lock_acquired.as_micros(),
                clone_us = clone_time.as_micros(),
                lock_total_us = lock_total.as_micros(),
                prep_us = prep_time.as_micros(),
                turn_count = turns.len(),
                "get_session_turns cache hit timing"
            );

            return Ok(TurnsResponse { turns: prepared, events_file_size: current_size });
        }
    }
    drop(cache);
    // ... rest of function
}
```

### Measurement Protocol

1. Start the app in dev mode with `RUST_LOG=info`
2. Open a session with ~100+ turns
3. Switch away and back 10 times (trigger cache hits)
4. Open a second session and switch between both (trigger contention)
5. Record lock_acquire_us, clone_us, prep_us from logs

### Expected Findings

- If `lock_acquire_us` is consistently <10μs: low contention, B12 is theoretical
- If `lock_acquire_us` spikes to >1ms during rapid switching: B12 is real
- If `prep_us` > `clone_us`: prepare_turns_for_ipc is the real bottleneck (optimize that, not the lock)
- If `clone_us` is dominant: consider Arc<Vec> sharing instead of cloning

### Acceptance Criteria

- [ ] Timing data collected from at least 20 cache hits
- [ ] Results documented in perf-baselines.json under `"lock_contention"` key
- [ ] Temporary instrumentation either kept as permanent `tracing` spans or removed

---

## Task 2.5 — Add Performance Budget File

| Field | Value |
|-------|-------|
| **Effort** | 30 minutes |
| **Impact** | Machine-readable performance expectations; enables automated regression detection and AI-agent optimization |
| **Risk** | None — documentation artifact |
| **Dependencies** | Task 2.3 (baseline recording) |

### Files to Create

- **`perf-budget.json`** (workspace root)

### Content

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "description": "TracePilot performance budgets — machine-readable targets for CI and AI agents",
  "version": "1.0.0",
  "updated_at": "YYYY-MM-DD",
  "rust_benchmarks": {
    "parse_typed_events_100": {
      "max_ms": 5,
      "benchmark": "tracepilot-bench::parsing::parse_typed_events_100",
      "notes": "100-event JSONL parsing"
    },
    "parse_typed_events_1000": {
      "max_ms": 50,
      "benchmark": "tracepilot-bench::parsing::parse_typed_events_1000",
      "notes": "1000-event JSONL parsing (target workload)"
    },
    "compute_analytics_100": {
      "max_ms": 10,
      "benchmark": "tracepilot-bench::analytics::compute_analytics_100",
      "notes": "Analytics aggregation for 100 sessions"
    },
    "upsert_session": {
      "max_ms": 100,
      "benchmark": "tracepilot-bench::indexer::bench_upsert_session",
      "notes": "Single session index upsert"
    },
    "ipc_turn_serialization_100": {
      "max_ms": 5,
      "benchmark": "TBD — add in Phase 4",
      "notes": "Serializing 100 turns for IPC"
    }
  },
  "frontend": {
    "initial_bundle_size_kb": {
      "max": 800,
      "notes": "Total JS bundle size (gzipped: ~200KB target)"
    },
    "largest_chunk_kb": {
      "max": 300,
      "notes": "Single largest JS chunk"
    },
    "filteredSessions_1000_ms": {
      "max": 10,
      "notes": "Computed property with 1000 sessions and active search"
    },
    "component_mount_ms": {
      "SessionListView": { "max": 100 },
      "ConversationTab": { "max": 200 },
      "SessionDetailView": { "max": 150 }
    }
  },
  "binary": {
    "release_size_mb": {
      "max": 15,
      "notes": "Release binary size (stripped, LTO)"
    }
  },
  "ipc": {
    "get_session_turns_cache_hit_ms": { "max": 10 },
    "get_session_list_ms": { "max": 50 },
    "get_analytics_ms": { "max": 100 },
    "search_content_ms": { "max": 200 }
  }
}
```

### How AI Agents Use This

1. **Before optimizing**: Read `perf-budget.json` to understand targets
2. **After benchmarking**: Compare results against budgets
3. **In CI**: Fail the build if any budget is exceeded (Phase 4 task)
4. **For prioritization**: Focus on metrics furthest from their budget

### Acceptance Criteria

- [ ] `perf-budget.json` exists at workspace root
- [ ] All values are filled with realistic baselines (not aspirational targets)
- [ ] File is valid JSON (parseable by `jq` or equivalent)
- [ ] Document references from `performance-analysis-report.md` §9.6 are consistent

---

## Task 2.6 — Add PERF Comments to Hot-Path Functions

| Field | Value |
|-------|-------|
| **Effort** | 1 hour |
| **Impact** | Self-documenting performance expectations; helps developers and AI agents prioritize |
| **Risk** | None — comment-only changes |
| **Dependencies** | Task 2.3 (need baselines to set budgets) |

### Approach

Add structured `PERF:` doc comments to the ~10 most critical functions. This convention helps AI agents identify hot paths and developers understand performance expectations.

### Format

```rust
/// Brief description.
///
/// PERF: Hot path — called [frequency].
/// Benchmark: `[benchmark name]` in tracepilot-bench.
/// Budget: [target].
/// Bottleneck: [B-ID] — [brief description].
```

### Functions to Annotate

| Function | Comment |
|----------|---------|
| `parse_events_jsonl` | PERF: Hot path — called once per session during indexing and turn loading. Budget: <5ms/1000 events. |
| `parse_typed_events` | PERF: Hot path — bottleneck B1 (serde_json::from_value clones). Budget: <50ms/1000 events. |
| `reindex_incremental` | PERF: Hot path — called on app startup and manual reindex. Budget: <100ms per session. |
| `upsert_session` | PERF: Hot path — called per-session during indexing. Budget: <100ms. |
| `get_session_turns` | PERF: Hot path — called on every session view. Bottleneck B12 (lock contention). Budget: <10ms cache hit. |
| `compute_analytics` | PERF: Called on dashboard load. Budget: <100ms for 100 sessions. |
| `search_content` | PERF: Called on every search keystroke (debounced). Budget: <200ms. |
| `filteredSessions` (TS) | PERF: Computed on every filter/search change. Budget: <10ms for 1000 sessions. |
| `prepare_turns_for_ipc` | PERF: Called on every turn load. Budget: <5ms for 100 turns. |
| `discover_sessions` | PERF: I/O-bound — scans filesystem. Budget: <1s for 1000 sessions. |

### Acceptance Criteria

- [ ] All 10 functions have `PERF:` doc comments
- [ ] Budgets match `perf-budget.json` values
- [ ] `cargo doc --workspace` generates clean documentation
- [ ] `grep -r "PERF:" crates/` returns ~10 matches

---

## Completion Checklist

| Task | Status | Output |
|------|--------|--------|
| 2.1 — tracing::instrument spans | ⬜ | ~20 annotated functions |
| 2.2 — IPC timing wrapper | ⬜ | Instrumented invoke.ts |
| 2.3 — Bundle analysis baseline | ⬜ | perf-baselines.json |
| 2.4 — Lock hold time profiling | ⬜ | Timing data in baselines |
| 2.5 — Performance budget file | ⬜ | perf-budget.json |
| 2.6 — PERF doc comments | ⬜ | 10 annotated functions |

**After completing Phase 2:**
1. All baseline measurements are recorded and documented
2. The `tracing` layer enables profiling on demand
3. IPC timing identifies slow commands automatically
4. Performance budgets exist for CI and AI-agent consumption
5. The codebase is self-documenting about performance expectations
6. Phase 3 structural changes can be measured against these baselines
