# Performance Phase 4: Advanced Optimizations

**Parent report**: [`docs/performance-analysis-report.md`](../performance-analysis-report.md)
**Effort**: 3–5 weeks total (tasks can be parallelized)
**Prerequisites**: Phases 1–3 complete, baselines recorded
**Bottlenecks addressed**: B1, B3, B6, B13, B16
**Risk level**: Medium to High — these tasks involve architectural changes

---

## Overview

Phase 4 contains the higher-effort optimizations that require deeper refactoring, new dependencies, or changes to the IPC contract. Each task should be individually measured and justified by profiling data from Phase 2 before starting.

**Critical rule**: Do not start any Phase 4 task unless profiling shows it addresses a measurable bottleneck. The Phase 2 instrumentation exists specifically to avoid speculative optimization.

---

## Task 4.1 — Parallel Session Indexing with Rayon

| Field | Value |
|-------|-------|
| **Bottleneck** | B3 |
| **Effort** | 3–5 days |
| **Impact** | 2–4× faster bulk reindex (initial index of 500+ sessions) |
| **Risk** | High — `rusqlite::Connection` is `!Send`; requires careful architecture |
| **Dependencies** | Phase 2 baselines, B3 confirmed as measurable bottleneck |

### Background

The current `reindex_incremental` loop processes sessions sequentially. For bulk reindexing (first launch, full rebuild), this means the CPU does I/O-bound JSON parsing one session at a time, then writes to SQLite one session at a time.

### Architecture Constraint

`rusqlite::Connection` is **NOT `Send`** — it cannot be shared across threads. This means:
- ❌ Cannot pass `Connection` into rayon's thread pool
- ❌ Cannot call `db.upsert_session()` from rayon workers
- ✅ **Can** parse files in parallel, then write to DB sequentially

### Design: Parse-Parallel, Write-Sequential

```
                  ┌──────────────────────────────┐
                  │  Input: Vec<DiscoveredSession> │
                  └──────────┬───────────────────┘
                             │
                    ┌────────▼────────┐
                    │  rayon par_iter  │
                    │  (CPU-parallel)  │
                    └───┬────┬────┬───┘
                        │    │    │
                   ┌────▼┐┌──▼─┐┌─▼───┐
                   │parse││parse││parse│  ← File I/O + JSON parsing
                   │sess1││sess2││sessN│    (no DB access)
                   └──┬──┘└──┬─┘└──┬──┘
                      │      │     │
                    ┌─▼──────▼─────▼──┐
                    │  Collect results │
                    │  Vec<ParsedData> │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  Sequential DB  │  ← Single thread, batched transactions
                    │  upsert loop    │
                    └─────────────────┘
```

### Files to Modify

1. **`Cargo.toml`** (workspace) — add rayon dependency
2. **`crates/tracepilot-indexer/Cargo.toml`** — add rayon
3. **`crates/tracepilot-indexer/src/lib.rs`** — refactor `reindex_incremental`
4. **`crates/tracepilot-core/Cargo.toml`** — possibly add rayon for parsing parallelism

### Implementation

#### Step 1: Add rayon dependency

```toml
# crates/tracepilot-indexer/Cargo.toml
[dependencies]
rayon = "1.10"
```

#### Step 2: Split parsing from writing

The current `upsert_session` does everything: parse → analyze → write. We need to factor out the parsing step:

```rust
// New struct for parsed-but-not-written session data
pub struct ParsedSessionData {
    pub session_id: String,
    pub path: PathBuf,
    pub events: ParsedEvents,
    pub summary: SessionSummary,
    pub analytics: Option<AnalyticsData>,
}

/// Parse a session (CPU-bound, thread-safe, no DB access)
pub fn parse_session(path: &Path) -> Result<ParsedSessionData> {
    let events = parse_typed_events(&path.join("events.jsonl"))?;
    let summary = extract_summary(&events);
    let analytics = compute_analytics_for_session(&events);
    Ok(ParsedSessionData { /* ... */ })
}

/// Write a pre-parsed session to the database (single-threaded)
pub fn write_parsed_session(db: &IndexDb, data: &ParsedSessionData) -> Result<SessionInfo> {
    // DB writes only — no file I/O
}
```

#### Step 3: Refactor reindex_incremental

```rust
use rayon::prelude::*;

pub fn reindex_incremental(
    sessions: &[DiscoveredSession],
    db: &IndexDb,
    on_progress: impl Fn(&IndexingProgress) + Send + Sync,
) -> Result<IndexStats> {
    // Phase 1: Determine which sessions need reindexing
    let needs_reindex: Vec<_> = sessions.iter()
        .filter(|s| db.needs_reindex(&s.id, &s.path))
        .collect();

    // Phase 2: Parse in parallel (no DB access)
    let parsed: Vec<_> = needs_reindex.par_iter()
        .map(|session| parse_session(&session.path))
        .collect();

    // Phase 3: Write sequentially (DB is !Send)
    let mut indexed = 0;
    db.begin_transaction()?;
    for (i, result) in parsed.into_iter().enumerate() {
        match result {
            Ok(data) => {
                write_parsed_session(db, &data)?;
                indexed += 1;
                if indexed % BATCH_SIZE == 0 {
                    db.commit_transaction()?;
                    db.begin_transaction()?;
                }
            }
            Err(e) => tracing::warn!(error = %e, "Failed to parse session"),
        }
        on_progress(&IndexingProgress { current: i + 1, total: needs_reindex.len(), /* ... */ });
    }
    db.commit_transaction()?;
    // ... pruning, stats
}
```

### Progress Reporting

With parallel parsing, progress is no longer strictly sequential. Options:
1. **Two-phase progress**: "Parsing: 50/100" then "Writing: 50/100"
2. **AtomicUsize counter** in the parallel phase for real-time parsing progress
3. **Simplify**: Only report progress during the sequential write phase

Recommended: Option 1 — it's the most informative without adding complexity.

### Testing Strategy

```rust
#[test]
fn test_parallel_reindex_matches_sequential() {
    // Parse 100 sessions both ways, compare results
    let sequential = reindex_sequential(sessions, db);
    let parallel = reindex_incremental(sessions, db); // new parallel impl
    assert_eq!(sequential.indexed, parallel.indexed);
    assert_eq!(sequential.total_tokens, parallel.total_tokens);
}
```

### Benchmarks

Add to `tracepilot-bench`:

```rust
fn bench_parallel_reindex(c: &mut Criterion) {
    let mut group = c.benchmark_group("reindex");
    for count in [10, 50, 100, 500] {
        let sessions = generate_session_fixtures(count);
        group.bench_with_input(
            BenchmarkId::new("parallel", count),
            &sessions,
            |b, sessions| b.iter(|| reindex_incremental(sessions, &db, |_| {})),
        );
    }
}
```

### Acceptance Criteria

- [ ] `cargo test --workspace` passes
- [ ] Benchmark shows >2× improvement for 100+ sessions on 4+ core machine
- [ ] Progress events are emitted correctly (no ordering issues)
- [ ] Error handling: individual session parse failures don't abort the batch
- [ ] Thread count respects system resources (rayon defaults to #CPUs, which is fine)

---

## Task 4.2 — Refactor `typed_data_from_raw` to Take Owned `Value`

| Field | Value |
|-------|-------|
| **Bottleneck** | B1 |
| **Effort** | 1–2 days |
| **Impact** | Eliminates `serde_json::from_value` internal clone (~30% fewer allocations in parsing) |
| **Risk** | Medium — changes public function signature, affects all callers |
| **Dependencies** | Phase 2 baselines, B1 confirmed as top allocation source |

### Background

`try_deser!` macro calls `serde_json::from_value(data.clone())` because `typed_data_from_raw` takes `&Value`. The `from_value` function takes ownership, so cloning is structurally required.

### Current Signature

```rust
// crates/tracepilot-core/src/parsing/events.rs (line ~159)
fn typed_data_from_raw(event_type: &str, data: &Value) -> Option<TypedEventData> {
    // ...
    match event_type {
        "copilot_agent.turn_start" => try_deser!(data, TurnStartData),
        // ... many arms
    }
}

// try_deser! macro (line ~164)
macro_rules! try_deser {
    ($data:expr, $type:ty) => {
        serde_json::from_value::<$type>($data.clone()).ok().map(TypedEventData::from)
    };
}
```

### Change

Take ownership of `Value` to avoid cloning:

```rust
fn typed_data_from_raw(event_type: &str, data: Value) -> Option<TypedEventData> {
    macro_rules! try_deser {
        ($data:expr, $type:ty) => {
            serde_json::from_value::<$type>($data).ok().map(TypedEventData::from)
        };
    }

    match event_type {
        "copilot_agent.turn_start" => try_deser!(data, TurnStartData),
        // ... same arms, but `data` is now owned
    }
}
```

### Caller Update

In `parse_typed_events`, the call site currently passes `&event.data`:

```rust
// Before:
if let Some(typed) = typed_data_from_raw(&event_type, &data) {
    // ...
}

// After — take ownership of data from the raw event:
if let Some(typed) = typed_data_from_raw(&event_type, data) {
    // `data` is moved, not borrowed
}
```

This requires that the raw `Value` is consumed during typed parsing. Since `parse_typed_events` already discards raw events after processing, this is safe.

### Impact on LRU Cache

The LRU cache stores `CachedTurns` which contains `ConversationTurn` (already typed). The raw `Value` is only used during parsing and never cached. Therefore, ownership transfer is safe — the `Value` is consumed during the parse → type → discard pipeline.

### Testing

All existing parsing tests validate correctness. The change is purely about ownership — output is identical.

```powershell
cargo test -p tracepilot-core -- parsing
cargo bench -p tracepilot-bench -- parse_typed_events
```

### Acceptance Criteria

- [ ] `cargo test --workspace` passes
- [ ] `cargo bench` shows measurable allocation reduction (ideally ~30% fewer allocs in parsing benchmarks)
- [ ] No behavior change in any parsing output
- [ ] `cargo clippy --workspace` clean

---

## Task 4.3 — Tagged Enum Deserialization (Long-Term B1 Fix)

| Field | Value |
|-------|-------|
| **Bottleneck** | B1 (comprehensive fix) |
| **Effort** | 3–5 days |
| **Impact** | ~50% fewer allocations by avoiding trial-and-error deserialization |
| **Risk** | High — major refactor of event model, compatibility concerns |
| **Dependencies** | Task 4.2 (owned Value), Phase 2 baselines |

### Background

The current `try_deser!` approach tries each event type's deserializer in sequence (via match arms). While each arm is O(1) lookup, `serde_json::from_value` still does allocation work even on the successful path.

The ideal fix: use a tagged enum where serde can dispatch directly to the correct variant:

```rust
#[derive(Deserialize)]
#[serde(tag = "type", content = "data")]
enum TypedEventData {
    #[serde(rename = "copilot_agent.turn_start")]
    TurnStart(TurnStartData),
    #[serde(rename = "copilot_agent.turn_end")]
    TurnEnd(TurnEndData),
    // ... all event types
}
```

### Why This Is Complex

1. **Not all events have a `data` field** — some use `properties`, others have data inline
2. **The JSONL format is not consistently tagged** — event types are extracted from various fields
3. **Unknown event types must be preserved** — not every event maps to a known variant
4. **Backward compatibility** — existing sessions on disk have the current format

### Approach

1. Audit all event type strings and their corresponding data shapes
2. Create the tagged enum with `#[serde(other)]` for unknown variants
3. Implement a custom deserializer that handles format inconsistencies
4. Add a compatibility layer for legacy session formats
5. Benchmark against the current try_deser approach

### This Task Is a Design + Implementation Task

Given the complexity, this should be preceded by a detailed design document that maps every event type to its data structure. Only proceed with implementation after the design is reviewed.

### Acceptance Criteria

- [ ] Design document covers all event types (audit `typed_data_from_raw` match arms)
- [ ] All existing parsing tests pass with the new deserializer
- [ ] Benchmark shows >30% allocation reduction vs current approach
- [ ] Unknown event types are preserved (not silently dropped)
- [ ] Legacy session files still parse correctly

---

## Task 4.4 — `iai-callgrind` CI Benchmarks

| Field | Value |
|-------|-------|
| **Effort** | 1 day |
| **Impact** | Deterministic CI regression detection (no noise from CPU frequency scaling) |
| **Risk** | Low — additive, doesn't replace Criterion |
| **Dependencies** | None |

### Platform Constraint

`iai-callgrind` requires Valgrind, which is **Linux-only**. It works perfectly on GitHub Actions `ubuntu-latest` but cannot be used for local development on Windows.

### Files to Create/Modify

1. **`crates/tracepilot-bench/Cargo.toml`** — add iai-callgrind as optional dependency
2. **`crates/tracepilot-bench/benches/iai_parsing.rs`** — new benchmark file
3. **`.github/workflows/benchmark.yml`** — add iai-callgrind job (Linux only)

### Implementation

```toml
# crates/tracepilot-bench/Cargo.toml
[dev-dependencies]
iai-callgrind = { version = "0.14", optional = true }

[features]
iai = ["iai-callgrind"]

[[bench]]
name = "iai_parsing"
harness = false
required-features = ["iai"]
```

```rust
// crates/tracepilot-bench/benches/iai_parsing.rs
use iai_callgrind::{library_benchmark, library_benchmark_group, main};
use tracepilot_core::parsing::events::parse_typed_events;
use std::path::Path;

#[library_benchmark]
fn bench_parse_100_events() {
    let path = Path::new("fixtures/100-events/events.jsonl");
    let _ = parse_typed_events(path);
}

#[library_benchmark]
fn bench_parse_1000_events() {
    let path = Path::new("fixtures/1000-events/events.jsonl");
    let _ = parse_typed_events(path);
}

library_benchmark_group!(
    name = parsing;
    benchmarks = bench_parse_100_events, bench_parse_1000_events
);

main!(library_benchmark_groups = parsing);
```

```yaml
# .github/workflows/benchmark.yml — add job
  iai-benchmarks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - name: Install Valgrind
        run: sudo apt-get install -y valgrind
      - name: Run iai-callgrind benchmarks
        run: cargo bench -p tracepilot-bench --features iai --bench iai_parsing
```

### Acceptance Criteria

- [ ] `cargo bench -p tracepilot-bench --features iai --bench iai_parsing` runs on Linux CI
- [ ] Results show instruction counts (not wall-clock time)
- [ ] CI job runs on PRs and reports instruction count changes

---

## Task 4.5 — `dhat-rs` Memory Profiling Feature Flag

| Field | Value |
|-------|-------|
| **Effort** | 1 day |
| **Impact** | Allocation profiling for any Rust code path |
| **Risk** | Low — feature-gated, not active by default |
| **Dependencies** | None |

### Approach

Add `dhat-rs` behind a cargo feature flag so it can be activated for profiling without affecting production builds.

### Files to Modify

1. **`crates/tracepilot-bench/Cargo.toml`**
2. **`crates/tracepilot-bench/src/lib.rs`** or a new `benches/memory.rs`

```toml
[features]
dhat-heap = ["dhat"]

[dependencies]
dhat = { version = "0.3", optional = true }
```

```rust
// benches/memory.rs
#[cfg(feature = "dhat-heap")]
#[global_allocator]
static ALLOC: dhat::Alloc = dhat::Alloc;

fn main() {
    #[cfg(feature = "dhat-heap")]
    let _profiler = dhat::Profiler::builder().testing().build();

    // Run the workload
    let result = parse_typed_events(Path::new("fixtures/1000-events/events.jsonl")).unwrap();
    std::hint::black_box(&result);

    #[cfg(feature = "dhat-heap")]
    {
        let stats = dhat::HeapStats::get();
        println!("Total blocks: {}", stats.total_blocks);
        println!("Total bytes: {}", stats.total_bytes);
        println!("Max blocks: {}", stats.max_blocks);
        println!("Max bytes: {}", stats.max_bytes);
    }
}
```

### Usage

```powershell
cargo run --release --features dhat-heap --bin memory-profile
# Opens dhat-viewer in browser with allocation flamegraph
```

### Acceptance Criteria

- [ ] `cargo build --features dhat-heap` compiles
- [ ] Profiling shows allocation statistics
- [ ] Default build (`cargo build`) is unaffected

---

## Task 4.6 — Frontend Performance Test Suite

| Field | Value |
|-------|-------|
| **Effort** | 2 days |
| **Impact** | Automated regression detection for frontend perf |
| **Risk** | Low — additive tests |
| **Dependencies** | Phase 2 baselines |

### Files to Create

- **`apps/desktop/src/__tests__/performance.test.ts`**

### Tests to Write

```typescript
import { describe, it, expect } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

describe('Performance Budgets', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('filteredSessions computes in <10ms for 1000 sessions', () => {
    const store = useSessionStore();
    store.$patch({ sessions: generateSessions(1000) });
    store.searchQuery = 'refactor';

    const start = performance.now();
    const result = store.filteredSessions;
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(10);
    expect(result.length).toBeGreaterThan(0);
  });

  it('filteredSessions handles 5000 sessions in <50ms', () => {
    const store = useSessionStore();
    store.$patch({ sessions: generateSessions(5000) });

    const start = performance.now();
    const _ = store.filteredSessions;
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(50);
  });

  it('session sort is stable for equal updatedAt values', () => {
    const sessions = generateSessions(100);
    sessions.forEach(s => s.updatedAt = '2024-01-01T00:00:00Z');
    // Verify sort doesn't produce random order
  });
});

function generateSessions(count: number): SessionListItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `session-${i}`,
    summary: `Session ${i} about ${i % 2 === 0 ? 'refactor' : 'bugfix'}`,
    repository: `repo-${i % 10}`,
    branch: `branch-${i % 5}`,
    model: `model-${i % 3}`,
    updatedAt: new Date(Date.now() - i * 3600000).toISOString(),
    // ... required fields
  }));
}
```

### Acceptance Criteria

- [ ] `pnpm --filter @tracepilot/desktop test` includes performance tests
- [ ] Tests pass on CI
- [ ] Tests use `perf-budget.json` values as thresholds (or document why they differ)

---

## Task 4.7 — Virtual Scrolling for Conversation Tab

| Field | Value |
|-------|-------|
| **Bottleneck** | B6 |
| **Effort** | 2–3 days |
| **Impact** | Handle sessions with 500+ turns without DOM explosion |
| **Risk** | High — variable-height items (turns have different content lengths) |
| **Dependencies** | Task 3.1 (session list virtual scrolling — validates the pattern) |

### Why This Is Harder Than Session List

Session list cards have roughly consistent heights (140px ± 20px). Conversation turns vary wildly:
- Short user message: ~80px
- Long assistant response with code blocks: 500-2000px
- Turn with 20 tool calls expanded: 3000px+

### Approach: `@tanstack/vue-virtual` with Dynamic Measurement

TanStack Virtual supports dynamic measurement via `measureElement`. The virtualizer measures each item after render and adjusts positions accordingly.

### Key Concern: Scroll Anchoring

When a new turn is rendered (streaming), the scroll should stay at the bottom. With virtual scrolling, this requires explicit `scrollToIndex(turns.length - 1)` calls.

### Files to Modify

1. **`apps/desktop/src/views/tabs/ConversationTab.vue`** — template + script
2. **New**: `apps/desktop/src/composables/useVirtualConversation.ts`

### Implementation Sketch

```typescript
export function useVirtualConversation(
  turns: Ref<ConversationTurn[]>,
  containerRef: Ref<HTMLElement | null>,
) {
  const virtualizer = useVirtualizer({
    count: computed(() => turns.value.length),
    getScrollElement: () => containerRef.value,
    estimateSize: (index) => {
      // Rough estimate based on content
      const turn = turns.value[index];
      const hasToolCalls = turn.toolCalls?.length > 0;
      return hasToolCalls ? 400 : 150;
    },
    overscan: 3,
  });

  return { virtualizer };
}
```

### Acceptance Criteria

- [ ] 500-turn session renders with <50 DOM turn elements
- [ ] Scroll performance maintains 60fps
- [ ] "Scroll to bottom" button works
- [ ] Turn expansion (tool calls, reasoning) triggers re-measurement
- [ ] View mode toggle (chat/compact/timeline) works correctly

---

## Task 4.8 — Turn Pagination Over IPC

| Field | Value |
|-------|-------|
| **Bottleneck** | B13 |
| **Effort** | 2–3 days |
| **Impact** | Dramatically smaller IPC payloads for large sessions |
| **Risk** | Medium — changes IPC contract between Rust and TypeScript |
| **Dependencies** | Task 4.7 (virtual scrolling needs pagination) |

### Approach

Instead of sending all turns at once, send them in pages:

```rust
// Rust side
#[tauri::command]
pub async fn get_session_turns_page(
    session_id: String,
    offset: usize,
    limit: usize,
) -> CmdResult<TurnsPageResponse> {
    // Return turns[offset..offset+limit] + total_count
}
```

```typescript
// TypeScript side
interface TurnsPageResponse {
  turns: ConversationTurn[];
  totalCount: number;
  offset: number;
  hasMore: boolean;
}
```

The virtual scrolling composable requests pages as the user scrolls, keeping only visible + overscan turns in memory.

### Acceptance Criteria

- [ ] New IPC command `get_session_turns_page` works correctly
- [ ] Existing `get_session_turns` still works (backward compatible)
- [ ] Virtual scrolling uses paginated loading
- [ ] Initial page loads in <50ms (vs potentially 500ms+ for full turn payload)

---

## Task 4.9 — Add SQLite ANALYZE Scheduling

| Field | Value |
|-------|-------|
| **Bottleneck** | B16 |
| **Effort** | 2 hours |
| **Impact** | Better query plans after bulk index changes |
| **Risk** | Very low — SQLite standard maintenance |
| **Dependencies** | None |

### Files to Modify

- **`crates/tracepilot-indexer/src/lib.rs`** — after `reindex_incremental` completes

### Change

```rust
// After bulk reindex completes:
if indexed > 50 {
    db.execute("ANALYZE")?;
    tracing::info!(indexed, "Ran ANALYZE after bulk index");
}
```

### Notes

- Only run `ANALYZE` after significant changes (>50 sessions indexed)
- `ANALYZE` updates SQLite's internal statistics used by the query planner
- This is already partially done (`PRAGMA optimize` is called) — `ANALYZE` provides more comprehensive statistics
- Takes <100ms even for large databases

### Acceptance Criteria

- [ ] `ANALYZE` runs after bulk reindex (>50 sessions)
- [ ] No impact on small incremental reindex operations
- [ ] `cargo test -p tracepilot-indexer` passes

---

## Task 4.10 — Performance Budget CI Check

| Field | Value |
|-------|-------|
| **Effort** | 1 day |
| **Impact** | Prevents performance regressions from being merged |
| **Risk** | Low — can be advisory (warn) before being mandatory (fail) |
| **Dependencies** | Task 2.5 (perf-budget.json) |

### Files to Create/Modify

1. **`scripts/check-perf-budget.ps1`** — validation script
2. **`.github/workflows/benchmark.yml`** — add budget check step

### Script

```powershell
# scripts/check-perf-budget.ps1
$budget = Get-Content perf-budget.json | ConvertFrom-Json

# Check binary size
$binaryPath = "target/release/tracepilot-desktop.exe"
if (Test-Path $binaryPath) {
    $sizeMB = [math]::Round((Get-Item $binaryPath).Length / 1MB, 2)
    $maxMB = $budget.binary.release_size_mb.max
    if ($sizeMB -gt $maxMB) {
        Write-Error "Binary size ${sizeMB}MB exceeds budget ${maxMB}MB"
        exit 1
    }
    Write-Host "✅ Binary size: ${sizeMB}MB (budget: ${maxMB}MB)"
}

# Check frontend bundle
$distPath = "apps/desktop/dist/assets"
if (Test-Path $distPath) {
    $totalKB = [math]::Round((Get-ChildItem $distPath -Filter "*.js" | Measure-Object Length -Sum).Sum / 1KB, 1)
    $maxKB = $budget.frontend.initial_bundle_size_kb.max
    if ($totalKB -gt $maxKB) {
        Write-Error "Bundle size ${totalKB}KB exceeds budget ${maxKB}KB"
        exit 1
    }
    Write-Host "✅ Bundle size: ${totalKB}KB (budget: ${maxKB}KB)"
}
```

### Acceptance Criteria

- [ ] `scripts/check-perf-budget.ps1` runs without errors
- [ ] CI runs the check on every PR
- [ ] Clear error messages when budgets are exceeded

---

## Completion Checklist

| Task | Status | Effort | Risk |
|------|--------|--------|------|
| 4.1 — Parallel indexing (rayon) | ⬜ | 3-5 days | High |
| 4.2 — Owned Value refactor | ⬜ | 1-2 days | Medium |
| 4.3 — Tagged enum deserialization | ⬜ | 3-5 days | High |
| 4.4 — iai-callgrind CI | ⬜ | 1 day | Low |
| 4.5 — dhat-rs profiling | ⬜ | 1 day | Low |
| 4.6 — Frontend perf tests | ⬜ | 2 days | Low |
| 4.7 — Virtual scroll (conversation) | ⬜ | 2-3 days | High |
| 4.8 — Turn pagination IPC | ⬜ | 2-3 days | Medium |
| 4.9 — SQLite ANALYZE | ⬜ | 2 hours | Very Low |
| 4.10 — Perf budget CI | ⬜ | 1 day | Low |

**Parallelization opportunities:**
- Tasks 4.4, 4.5, 4.6, 4.9 can all be done in parallel (independent)
- Task 4.2 → 4.3 is sequential (4.3 builds on 4.2)
- Task 4.7 → 4.8 is sequential (pagination needs virtual scrolling)
- Task 4.1 is independent of all others
