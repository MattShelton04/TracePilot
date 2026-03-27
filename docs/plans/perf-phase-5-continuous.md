# Performance Phase 5: Continuous Improvement

**Parent report**: [`docs/performance-analysis-report.md`](../performance-analysis-report.md)
**Effort**: Ongoing — 1–2 days per task, done incrementally
**Prerequisites**: Phases 1–3 complete; Phase 4 in progress or complete
**Nature**: These are recurring practices, infrastructure additions, and later-stage optimizations

---

## Overview

Phase 5 is not a "phase" in the traditional sense — it's a collection of ongoing practices and tools that maintain performance health over time. These tasks create a culture of performance awareness rather than one-off fixes.

---

## Task 5.1 — `usePerfMonitor` Composable for Component Profiling

| Field | Value |
|-------|-------|
| **Effort** | 1 day |
| **Impact** | Component mount time, render duration, and custom marks visible in dev tools |
| **Risk** | None — dev-only instrumentation |
| **Dependencies** | None |

### Files to Create

- **`apps/desktop/src/composables/usePerfMonitor.ts`**

### Implementation

```typescript
import { onMounted, onUnmounted, getCurrentInstance } from 'vue';
import { logDebug } from '@/utils/logger';

interface PerfEntry {
  name: string;
  duration: number;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

const PERF_LOG: PerfEntry[] = [];
const SLOW_MOUNT_THRESHOLD_MS = 50;
const MAX_LOG_SIZE = 1000;

export function usePerfMonitor(label?: string) {
  const instance = getCurrentInstance();
  const componentName = label || instance?.type.__name || 'Unknown';
  let mountStart: number;

  // Record mount start immediately (before any async setup)
  mountStart = performance.now();

  onMounted(() => {
    const duration = performance.now() - mountStart;
    recordEntry(`${componentName}:mount`, duration);

    if (duration > SLOW_MOUNT_THRESHOLD_MS) {
      logDebug(`[perf] Slow mount: ${componentName} took ${duration.toFixed(1)}ms`);
    }
  });

  function mark(name: string) {
    performance.mark(`${componentName}:${name}`);
  }

  function measure(name: string, startMark: string): number {
    try {
      const m = performance.measure(
        `${componentName}:${name}`,
        `${componentName}:${startMark}`,
      );
      recordEntry(`${componentName}:${name}`, m.duration);
      return m.duration;
    } catch {
      return -1;
    }
  }

  function timeAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const start = performance.now();
    return fn().then(
      (result) => {
        recordEntry(`${componentName}:${name}`, performance.now() - start);
        return result;
      },
      (error) => {
        recordEntry(`${componentName}:${name}:error`, performance.now() - start);
        throw error;
      },
    );
  }

  return { mark, measure, timeAsync };
}

function recordEntry(name: string, duration: number, metadata?: Record<string, unknown>) {
  PERF_LOG.push({ name, duration, timestamp: Date.now(), metadata });
  if (PERF_LOG.length > MAX_LOG_SIZE) {
    PERF_LOG.splice(0, MAX_LOG_SIZE / 2);
  }
}

/** Get performance log — accessible from browser console */
export function getPerfLog(): readonly PerfEntry[] {
  return PERF_LOG;
}

/** Get slow entries (above threshold) */
export function getSlowEntries(thresholdMs = 50): PerfEntry[] {
  return PERF_LOG.filter(e => e.duration > thresholdMs);
}

/** Clear performance log */
export function clearPerfLog() {
  PERF_LOG.length = 0;
}

/** Dump performance summary to console */
export function dumpPerfSummary() {
  const grouped = new Map<string, number[]>();
  for (const entry of PERF_LOG) {
    const base = entry.name.split(':').slice(0, 2).join(':');
    const durations = grouped.get(base) || [];
    durations.push(entry.duration);
    grouped.set(base, durations);
  }

  const summary = [...grouped.entries()].map(([name, durations]) => ({
    name,
    count: durations.length,
    avg: (durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(1),
    max: Math.max(...durations).toFixed(1),
    min: Math.min(...durations).toFixed(1),
  }));

  console.table(summary.sort((a, b) => parseFloat(b.avg) - parseFloat(a.avg)));
}
```

### Usage in Views

```typescript
// In SessionDetailView.vue
import { usePerfMonitor } from '@/composables/usePerfMonitor';

const { mark, measure, timeAsync } = usePerfMonitor('SessionDetailView');

// Time an IPC call
const session = await timeAsync('loadSession', () => store.loadSession(id));

// Manual marks
mark('renderStart');
// ... rendering logic
const renderTime = measure('render', 'renderStart');
```

### Browser Console Access

```javascript
// In dev tools console:
import('@/composables/usePerfMonitor').then(m => m.dumpPerfSummary());
import('@/composables/usePerfMonitor').then(m => console.table(m.getSlowEntries()));
```

### Acceptance Criteria

- [ ] Composable created with full TypeScript types
- [ ] Added to at least 3 views (SessionListView, ConversationTab, SessionDetailView)
- [ ] `dumpPerfSummary()` produces readable console table
- [ ] `pnpm --filter @tracepilot/desktop test` passes
- [ ] `pnpm --filter @tracepilot/desktop typecheck` passes

---

## Task 5.2 — Long Task Observer for UI Jank Detection

| Field | Value |
|-------|-------|
| **Effort** | 2 hours |
| **Impact** | Automatically detects >50ms main thread blocks in production |
| **Risk** | None — observational only |
| **Dependencies** | None |

### Files to Create

- **`apps/desktop/src/utils/longTaskObserver.ts`**

### Implementation

```typescript
import { logWarn } from '@/utils/logger';

let observer: PerformanceObserver | null = null;

export function startLongTaskObserver() {
  if (typeof PerformanceObserver === 'undefined') return;
  if (observer) return; // already running

  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration > 50) {
          logWarn(
            `[perf] Long task detected: ${entry.duration.toFixed(1)}ms ` +
            `(${entry.name}, started at ${entry.startTime.toFixed(0)}ms)`,
          );
        }
      }
    });

    observer.observe({ type: 'longtask', buffered: false });
  } catch {
    // PerformanceObserver 'longtask' not supported in this WebView
  }
}

export function stopLongTaskObserver() {
  observer?.disconnect();
  observer = null;
}
```

### Integration

In `apps/desktop/src/main.ts`:

```typescript
import { startLongTaskObserver } from '@/utils/longTaskObserver';

// Start after app initialization
if (import.meta.env.DEV) {
  startLongTaskObserver();
}
```

### Notes

- WebView2 (Windows) supports the Long Tasks API
- Threshold of 50ms matches the W3C "long task" definition
- Only enabled in dev mode to avoid noise in production
- Can be promoted to production if needed (the observer itself is lightweight)

### Acceptance Criteria

- [ ] Long tasks >50ms produce console warnings in dev mode
- [ ] No console noise in production builds
- [ ] Observer is properly cleaned up (no memory leaks)

---

## Task 5.3 — SQLite Query Profiling with `connection.profile()`

| Field | Value |
|-------|-------|
| **Effort** | 1 day |
| **Impact** | Identifies slow SQL queries automatically |
| **Risk** | Very low — logging only, feature-gated |
| **Dependencies** | None |

### Background

rusqlite's `Connection::profile()` registers a callback that fires after every SQL statement, receiving the query text and execution duration.

### Files to Modify

- **`crates/tracepilot-indexer/src/db.rs`** (or wherever `Connection` is created)

### Implementation

```rust
use std::time::Duration;

const SLOW_QUERY_THRESHOLD: Duration = Duration::from_millis(10);

impl IndexDb {
    pub fn new(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)?;
        
        // Enable query profiling in debug builds
        #[cfg(debug_assertions)]
        conn.profile(Some(|query, duration| {
            if duration > SLOW_QUERY_THRESHOLD {
                tracing::warn!(
                    duration_ms = duration.as_millis(),
                    query = %query,
                    "Slow SQL query"
                );
            }
        }));

        // ... rest of setup
        Ok(Self { conn })
    }
}
```

### Notes

- `connection.profile()` is `#[cfg(debug_assertions)]` gated — zero cost in release
- 10ms threshold catches meaningful slow queries without noise
- Output goes through `tracing` so it's visible in logs and flamegraphs
- Useful for identifying queries that need index optimization or ANALYZE

### Acceptance Criteria

- [ ] Slow queries (>10ms) appear in debug logs
- [ ] Release builds have zero profiling overhead
- [ ] `cargo test -p tracepilot-indexer` passes

---

## Task 5.4 — Real-World Session Fixtures for Benchmarks

| Field | Value |
|-------|-------|
| **Effort** | 1 day |
| **Impact** | Benchmarks reflect real-world performance instead of synthetic data |
| **Risk** | Low — need to anonymize/sanitize fixture data |
| **Dependencies** | None |

### Background

Current benchmarks use synthetic fixtures generated in code. Real sessions have different characteristics:
- Variable event sizes (tool calls with large code blocks)
- Realistic distribution of event types
- Actual JSONL formatting (whitespace, ordering)

### Approach

1. **Capture real sessions** from the developer's own usage
2. **Anonymize** — strip file paths, code content, user names
3. **Categorize** — small (50 events), medium (500 events), large (5000 events)
4. **Store** in `crates/tracepilot-bench/fixtures/`

### Anonymization Script

```powershell
# scripts/anonymize-session.ps1
param([string]$InputPath, [string]$OutputPath)

$content = Get-Content $InputPath -Raw
# Replace file paths
$content = $content -replace '"(/[^"]+|[A-Z]:\\[^"]+)"', '"/anonymized/path/file.ts"'
# Replace usernames
$content = $content -replace '"user":\s*"[^"]+"', '"user": "developer"'
# Replace code content (keep structure, replace content)
# ... additional sanitization

$content | Set-Content $OutputPath
```

### Fixture Categories

| Fixture | Events | Turns | Use Case |
|---------|--------|-------|----------|
| `fixtures/small-session/` | 50 | 5 | Quick unit test fixture |
| `fixtures/medium-session/` | 500 | 30 | Standard benchmark |
| `fixtures/large-session/` | 5000 | 200 | Stress test |
| `fixtures/agent-heavy-session/` | 2000 | 50 | Many subagents + tool calls |

### Acceptance Criteria

- [ ] At least 3 fixture categories exist
- [ ] Fixtures are fully anonymized (no personal data, no real code)
- [ ] Benchmarks updated to use real fixtures alongside synthetic data
- [ ] `cargo bench -p tracepilot-bench` uses new fixtures

---

## Task 5.5 — `tokio-console` Integration for Dev

| Field | Value |
|-------|-------|
| **Effort** | 2 hours |
| **Impact** | Real-time async task debugging (spawn counts, poll times, waker behavior) |
| **Risk** | None — feature-gated, dev-only |
| **Dependencies** | None |

### Files to Modify

1. **`apps/desktop/src-tauri/Cargo.toml`** — add console-subscriber
2. **`apps/desktop/src-tauri/src/main.rs`** — conditional subscriber setup

### Implementation

```toml
# apps/desktop/src-tauri/Cargo.toml
[features]
tokio-console = ["console-subscriber"]

[dependencies]
console-subscriber = { version = "0.4", optional = true }
```

```rust
// apps/desktop/src-tauri/src/main.rs
fn main() {
    #[cfg(feature = "tokio-console")]
    console_subscriber::init();

    // ... rest of Tauri setup
}
```

### Usage

```powershell
# Build with tokio-console support
cargo tauri dev --features tokio-console

# In another terminal:
tokio-console
```

### Acceptance Criteria

- [ ] `cargo build --features tokio-console` compiles
- [ ] `tokio-console` connects and shows task list
- [ ] Default build (no feature) is unaffected

---

## Task 5.6 — Profile-Guided Optimization (PGO)

| Field | Value |
|-------|-------|
| **Effort** | 1–2 days |
| **Impact** | 5–15% additional runtime speedup (free performance) |
| **Risk** | Low — build process change only, no code changes |
| **Dependencies** | Phase 1 (opt-level 2), benchmark fixtures |

### Background

PGO uses runtime profiling data to guide compiler optimizations. The compiler sees which code paths are hot, which branches are taken, and optimizes accordingly.

### Process

```powershell
# Step 1: Build with instrumentation
$env:RUSTFLAGS = "-Cprofile-generate=target/pgo-profiles"
cargo build --release -p tracepilot-desktop

# Step 2: Run workload to collect profiles
# Run benchmarks as the workload
cargo bench -p tracepilot-bench

# Step 3: Merge profiles
llvm-profdata merge -o target/pgo-profiles/merged.profdata target/pgo-profiles/*.profraw

# Step 4: Build with PGO data
$env:RUSTFLAGS = "-Cprofile-use=target/pgo-profiles/merged.profdata"
cargo build --release -p tracepilot-desktop
```

### CI Integration

Add PGO to release builds:

```yaml
# .github/workflows/release.yml
- name: PGO instrumented build
  run: |
    RUSTFLAGS="-Cprofile-generate=target/pgo" cargo build --release
- name: Collect PGO profiles
  run: cargo bench -p tracepilot-bench
- name: Merge profiles
  run: llvm-profdata merge -o merged.profdata target/pgo/*.profraw
- name: PGO optimized build
  run: RUSTFLAGS="-Cprofile-use=$(pwd)/merged.profdata" cargo build --release
```

### Notes

- PGO requires two compilation passes — build time roughly doubles
- Only worth it for release builds (not dev)
- Profiles should represent realistic workloads (benchmarks are a good proxy)
- Can be combined with LTO for maximum effect (already enabled)

### Acceptance Criteria

- [ ] PGO build script exists and works
- [ ] Benchmark comparison shows measurable improvement
- [ ] CI release workflow includes PGO step

---

## Task 5.7 — Throttle/Batch Indexing Progress Events

| Field | Value |
|-------|-------|
| **Effort** | 2 hours |
| **Impact** | Fewer IPC round-trips during indexing (currently 1 event per session) |
| **Risk** | Low — UI shows less granular progress, but still updates regularly |
| **Dependencies** | None |

### Current Behavior

`reindex_incremental` calls `on_progress()` for every session, which emits a Tauri event over IPC. For 500 sessions, that's 500 IPC events in rapid succession.

### Change

Throttle to at most one event per 100ms:

```rust
use std::time::Instant;

const PROGRESS_THROTTLE: Duration = Duration::from_millis(100);

pub fn reindex_incremental(/* ... */) -> Result<IndexStats> {
    let mut last_progress = Instant::now();

    for (i, session) in sessions.iter().enumerate() {
        // ... indexing logic

        // Throttled progress reporting
        let now = Instant::now();
        if now.duration_since(last_progress) >= PROGRESS_THROTTLE || i + 1 == total {
            on_progress(&IndexingProgress { current: i + 1, total, /* ... */ });
            last_progress = now;
        }
    }
}
```

### Notes

- Always emit the final progress event (when `i + 1 == total`)
- 100ms throttle means 10 updates/second — smooth progress bar
- For parallel indexing (Task 4.1), this throttle is even more important

### Acceptance Criteria

- [ ] Progress bar still updates smoothly during indexing
- [ ] Total IPC events during 500-session reindex drops from 500 to ~50
- [ ] Final progress event is always emitted

---

## Ongoing Practices

### Monthly Performance Review

```powershell
# Run all benchmarks and compare against baseline
cargo bench -p tracepilot-bench -- --baseline monthly-baseline

# Check binary size trend
(Get-Item target/release/tracepilot-desktop.exe).Length / 1MB

# Check bundle size
pnpm --filter @tracepilot/desktop build
(Get-ChildItem apps/desktop/dist/assets -Filter "*.js" | Measure-Object Length -Sum).Sum / 1KB

# Update perf-budget.json if baselines have improved
```

### PR Performance Checklist

Before merging performance-sensitive PRs:

- [ ] Benchmarks show no regression (`cargo bench -- --baseline main`)
- [ ] Binary size within budget (`perf-budget.json`)
- [ ] Bundle size within budget
- [ ] No new `transition: all` in CSS
- [ ] No new unbounded `v-for` without virtual scrolling consideration
- [ ] New IPC commands have appropriate response size limits
- [ ] New SQLite queries have appropriate indexes

---

## Completion Checklist

| Task | Status | Nature |
|------|--------|--------|
| 5.1 — usePerfMonitor composable | ⬜ | One-time setup |
| 5.2 — Long task observer | ⬜ | One-time setup |
| 5.3 — SQLite query profiling | ⬜ | One-time setup |
| 5.4 — Real-world fixtures | ⬜ | Ongoing collection |
| 5.5 — tokio-console integration | ⬜ | One-time setup |
| 5.6 — Profile-Guided Optimization | ⬜ | Release process |
| 5.7 — Throttle progress events | ⬜ | One-time fix |
| Monthly performance review | ⬜ | Recurring practice |
| PR performance checklist | ⬜ | Recurring practice |
