# Performance Phase 1: Quick Wins

**Parent report**: [`docs/performance-analysis-report.md`](../performance-analysis-report.md)
**Effort**: 1–2 days total
**Prerequisites**: None — all items are independent and can be done in any order
**Bottlenecks addressed**: B2, B5, B7, B9, B12, B14

---

## Overview

Phase 1 targets low-effort, high-impact changes that require minimal code modification and carry near-zero risk of behavioral regressions. Every item here is a surgical edit — no new dependencies, no architectural changes.

**Guiding principle**: Make the obvious fixes first so that subsequent profiling measurements reflect the *real* remaining hotspots, not easily-avoidable overhead.

---

## Task 1.1 — Change Release `opt-level` from `"s"` to `"2"`

| Field | Value |
|-------|-------|
| **Bottleneck** | B5 |
| **Effort** | 5 minutes |
| **Impact** | ~10-15% faster runtime across all Rust code |
| **Risk** | Binary grows ~0.5-1 MB (acceptable for desktop app) |

### Files to Modify

- **`Cargo.toml`** (workspace root, line 48)

### Current Code

```toml
[profile.release]
lto = true
codegen-units = 1
opt-level = "s"
strip = true
```

### Change

```toml
[profile.release]
lto = true
codegen-units = 1
opt-level = 2
strip = true
```

### Rationale

`opt-level = "s"` optimizes for binary size at the expense of runtime speed. For a desktop app where the binary is bundled locally (no network download on every use), there's no meaningful benefit to size optimization. Level `2` enables full optimization passes including loop unrolling and inlining that `"s"` skips.

### Acceptance Criteria

- [ ] `cargo build --release` succeeds
- [ ] Binary size increase is documented (measure before/after with `(Get-Item target\release\tracepilot-desktop.exe).Length`)
- [ ] Existing benchmarks show improvement or no regression: `cargo bench -p tracepilot-bench`

### Testing

```powershell
# Before change — record baseline
cargo bench -p tracepilot-bench -- --save-baseline opt-level-s

# After change — compare
cargo bench -p tracepilot-bench -- --baseline opt-level-s
```

---

## Task 1.2 — Add `Vec::with_capacity` to JSONL Parser (Raw Stage)

| Field | Value |
|-------|-------|
| **Bottleneck** | B2 |
| **Effort** | 15 minutes |
| **Impact** | Reduces Vec reallocations during parsing; ~5-10% fewer allocations for large sessions |
| **Risk** | None — behavioral no-op |

### Files to Modify

- **`crates/tracepilot-core/src/parsing/events.rs`** — `parse_events_jsonl` function (~line 121)

### Current Code

The function currently uses `Vec::new()` which starts with zero capacity and grows via doubling:

```rust
pub fn parse_events_jsonl(path: &Path) -> Result<(Vec<Value>, usize)> {
    let file = File::open(path)?;
    let reader = BufReader::new(file);
    let mut events = Vec::new();  // ← starts empty, reallocates as it grows
    let mut malformed = 0;
    // ...
```

### Change

Estimate capacity from file size. A typical JSONL event is ~500-2000 bytes, so `file_size / 1000` is a reasonable heuristic that avoids over-allocation:

```rust
pub fn parse_events_jsonl(path: &Path) -> Result<(Vec<Value>, usize)> {
    let file = File::open(path)?;
    let estimated_events = (file.metadata().map(|m| m.len()).unwrap_or(0) / 1000) as usize;
    let reader = BufReader::new(file);
    let mut events = Vec::with_capacity(estimated_events.max(16));
    let mut malformed = 0;
    // ...
```

### Notes

- The typed parsing stage (`parse_typed_events`, line 306) already uses `Vec::with_capacity(raw_events.len())` at line 312. This task only fixes the raw stage.
- The `file.metadata()` call is essentially free since `file` is already open.
- `.max(16)` ensures a minimum allocation to avoid pathological zero-capacity paths for empty files.

### Acceptance Criteria

- [ ] `cargo test -p tracepilot-core` passes
- [ ] `cargo bench -p tracepilot-bench -- parse` shows no regression (ideally slight improvement)
- [ ] `cargo clippy -p tracepilot-core` has no new warnings

### Testing

Existing tests cover parsing correctness. The benchmark `parse_typed_events` validates performance.

---

## Task 1.3 — Single-Pass Filter in `filteredSessions`

| Field | Value |
|-------|-------|
| **Bottleneck** | B7 |
| **Effort** | 30 minutes |
| **Impact** | Eliminates 3 intermediate arrays; ~2-3× faster for 500+ sessions |
| **Risk** | Low — same filtering logic, just combined |

### Files to Modify

- **`apps/desktop/src/stores/sessions.ts`** — `filteredSessions` computed (lines 25–68)

### Current Code

The computed property applies 4 sequential filter passes, each creating a new array:

```typescript
const filteredSessions = computed(() => {
    let result = [...sessions.value]; // copy

    // Pass 1: Search query filter
    if (searchQuery.value) {
        const q = searchQuery.value.toLowerCase();
        result = result.filter(s => /* matches */);
    }

    // Pass 2: Repository filter
    if (repositoryFilter.value) {
        result = result.filter(s => s.repository === repositoryFilter.value);
    }

    // Pass 3: Branch filter
    if (branchFilter.value) {
        result = result.filter(s => s.branch === branchFilter.value);
    }

    // Pass 4: Model filter
    if (modelFilter.value) {
        result = result.filter(s => s.model === modelFilter.value);
    }

    // Sort
    result.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
    return result;
});
```

### Change

Combine all filter conditions into a single pass. Build a predicate array and apply them in one `.filter()` call:

```typescript
const filteredSessions = computed(() => {
    const q = searchQuery.value?.toLowerCase();
    const repo = repositoryFilter.value;
    const branch = branchFilter.value;
    const model = modelFilter.value;

    const result = sessions.value.filter(s => {
        if (q && !(
            s.id.toLowerCase().includes(q) ||
            (s.summary?.toLowerCase().includes(q)) ||
            (s.repository?.toLowerCase().includes(q)) ||
            (s.branch?.toLowerCase().includes(q)) ||
            (s.model?.toLowerCase().includes(q))
        )) return false;

        if (repo && s.repository !== repo) return false;
        if (branch && s.branch !== branch) return false;
        if (model && s.model !== model) return false;

        return true;
    });

    result.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
    return result;
});
```

### Notes

- This eliminates 3 intermediate array allocations per recomputation.
- The search query fields must match the current implementation exactly — verify by reading the actual filter logic in `sessions.ts` before implementing.
- The sort remains at the end since it mutates in place.
- `sessions.value.filter(...)` already creates a new array, so the original isn't mutated.

### Acceptance Criteria

- [ ] `pnpm --filter @tracepilot/desktop test` — all existing session store tests pass
- [ ] `pnpm --filter @tracepilot/desktop typecheck` — no type errors
- [ ] Manual test: verify filtering still works correctly with search, repo, branch, and model filters active simultaneously

### Testing

Run existing session store tests. If no filter-specific tests exist, add a basic one:

```typescript
it('filteredSessions applies all filters in one pass', () => {
    // Set sessions with various combinations
    // Apply multiple filters
    // Assert only matching sessions remain
});
```

---

## Task 1.4 — Add `rollup-plugin-visualizer` for Bundle Analysis

| Field | Value |
|-------|-------|
| **Bottleneck** | B9 (visibility, not a fix) |
| **Effort** | 15 minutes |
| **Impact** | Enables informed bundle optimization decisions |
| **Risk** | None — dev dependency only, does not affect production build |

### Files to Modify

- **`apps/desktop/package.json`** — add dev dependency
- **`apps/desktop/vite.config.ts`** — add plugin conditionally

### Changes

#### 1. Install dependency

```powershell
pnpm --filter @tracepilot/desktop add -D rollup-plugin-visualizer
```

#### 2. Update vite.config.ts

```typescript
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";
import { visualizer } from "rollup-plugin-visualizer";

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    ...(process.env.ANALYZE === 'true' ? [visualizer({
      filename: 'dist/bundle-stats.html',
      open: true,
      gzipSize: true,
      template: 'treemap',
    })] : []),
  ],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
```

#### 3. Add npm script

In `apps/desktop/package.json`, add:

```json
"scripts": {
    "analyze": "ANALYZE=true vite build"
}
```

On Windows (PowerShell):

```powershell
$env:ANALYZE = "true"; pnpm --filter @tracepilot/desktop build
```

### Acceptance Criteria

- [ ] `ANALYZE=true pnpm --filter @tracepilot/desktop build` generates `dist/bundle-stats.html`
- [ ] The HTML report opens and shows treemap of all chunks
- [ ] Normal `pnpm --filter @tracepilot/desktop build` does NOT generate the report (no runtime impact)

---

## Task 1.5 — Debounce Search Input in Sessions Store

| Field | Value |
|-------|-------|
| **Bottleneck** | B7 (secondary) |
| **Effort** | 20 minutes |
| **Impact** | Eliminates per-keystroke recomputation of `filteredSessions` |
| **Risk** | Very low — 200ms delay is imperceptible for search |

### Files to Modify

- **`apps/desktop/src/stores/sessions.ts`** — add debounced intermediary

### Approach

Check if `@vueuse/core` is already a dependency. If so, use `watchDebounced` or `useDebounceFn`. If not, implement a simple `setTimeout`-based debounce (do not add a dependency for one function).

### Change

```typescript
// In the session store setup
const searchQuery = ref('');
const debouncedQuery = ref('');

// Debounce the search query (200ms)
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
watch(searchQuery, (val) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        debouncedQuery.value = val;
    }, 200);
});

// Update filteredSessions to use debouncedQuery instead of searchQuery
const filteredSessions = computed(() => {
    const q = debouncedQuery.value?.toLowerCase();
    // ... rest of filter logic
});
```

### Notes

- The `searchQuery` ref remains the source of truth for the input binding (so the UI feels instant).
- Only the expensive `filteredSessions` computation uses the debounced value.
- Verify that existing code that reads `searchQuery` (e.g., for clearing) still works correctly.
- If `@vueuse/core` is present, prefer `refDebounced` instead — it's a one-liner.

### Acceptance Criteria

- [ ] `pnpm --filter @tracepilot/desktop test` passes
- [ ] `pnpm --filter @tracepilot/desktop typecheck` passes
- [ ] Manual test: typing in session search is responsive; results update after ~200ms pause

---

## Task 1.6 — Reduce Turn Cache Mutex Lock Scope

| Field | Value |
|-------|-------|
| **Bottleneck** | B12 |
| **Effort** | 30 minutes |
| **Impact** | Reduces lock contention on concurrent IPC requests; prevents UI stalls during cache reads |
| **Risk** | Low — same behavior, narrower critical section |

### Files to Modify

- **`crates/tracepilot-tauri-bindings/src/commands/session.rs`** — `get_session_turns` function (lines 170–230)

### Current Code (Simplified)

```rust
// Currently: clones turns + runs prepare_turns_for_ipc while holding the lock
let mut cache = turn_cache.lock().unwrap();
if let Some(cached) = cache.get(&session_id) {
    if cached.events_file_size == current_size {
        let turns = cached.turns.clone();
        let prepared = prepare_turns_for_ipc(&turns);
        return Ok(TurnsResponse { turns: prepared, events_file_size: current_size });
    }
}
```

### Change

Clone the data and drop the lock before doing any work:

```rust
// Step 1: Quick cache lookup — clone data and release lock immediately
let cached_turns = {
    let mut cache = turn_cache.lock().unwrap();
    cache.get(&session_id).and_then(|cached| {
        if cached.events_file_size == current_size {
            Some(cached.turns.clone())
        } else {
            None
        }
    })
};

// Step 2: Process outside the lock
if let Some(turns) = cached_turns {
    let prepared = prepare_turns_for_ipc(&turns);
    return Ok(TurnsResponse { turns: prepared, events_file_size: current_size });
}
```

### Notes

- The key insight: `prepare_turns_for_ipc` can be expensive (it trims payloads, applies formatting). Holding the Mutex while that runs blocks all other IPC commands that need the cache.
- This pattern — "lock, clone, unlock, process" — is a standard Rust concurrent pattern. The clone cost is dwarfed by the lock contention cost.
- Verify the exact current implementation before editing, as the lock scope may have shifted since analysis.

### Acceptance Criteria

- [ ] `cargo test -p tracepilot-tauri-bindings` passes
- [ ] `cargo clippy -p tracepilot-tauri-bindings` has no new warnings
- [ ] Manual test: open a session, switch tabs rapidly — no stalls or missing data

---

## Task 1.7 — Fix CSS `transition: all` Anti-Pattern

| Field | Value |
|-------|-------|
| **Bottleneck** | B14 |
| **Effort** | 30 minutes |
| **Impact** | Smoother animations, reduced layout thrashing |
| **Risk** | Very low — visual-only change |

### Files to Modify

- **`apps/desktop/src/styles.css`** — 9 instances of `transition: all`

### Current Code

```css
/* Multiple locations using transition: all */
transition: all var(--transition-fast);
transition: all 0.3s ease;
transition: all var(--transition-normal);
```

### Change

Replace each `transition: all` with the specific properties being animated. For most UI interactions, this is:

```css
/* For color/opacity state changes (buttons, links) */
transition: color var(--transition-fast), background-color var(--transition-fast), opacity var(--transition-fast);

/* For card hover elevation */
transition: transform var(--transition-normal), box-shadow var(--transition-normal);

/* For slide animations */
transition: transform 0.3s ease, opacity 0.3s ease;
```

### Approach

1. Audit each of the 9 instances (lines 305, 461, 543, 663, 711, 748, 819, 1385, 1607)
2. For each, determine which properties actually change (inspect the surrounding `:hover`, `:active`, or Vue `<Transition>` states)
3. Replace `all` with only those properties
4. Visual regression test each change

### Acceptance Criteria

- [ ] No `transition: all` remains in `styles.css` (verified with `grep -c "transition: all" apps/desktop/src/styles.css` returning 0)
- [ ] Visual inspection: all hover effects, transitions, and animations still work correctly
- [ ] Chrome DevTools Performance tab: no "Recalculate Style" spikes during hover interactions

---

## Completion Checklist

| Task | Status |
|------|--------|
| 1.1 — opt-level `"2"` | ✅ Done |
| 1.2 — Vec::with_capacity | ✅ Done |
| 1.3 — Single-pass filter | ✅ Done |
| 1.4 — Bundle visualizer | ✅ Done |
| 1.5 — Debounce search | ⏭️ Skipped (user preference: keep instant search) |
| 1.6 — Reduce lock scope | ✅ Done |
| 1.7 — CSS transitions | ✅ Done |

**Implementation completed 2026-03-27. All tasks verified:**
- `cargo test --workspace` — 366 tests passing (0 failures)
- `pnpm --filter @tracepilot/desktop typecheck` — clean
- `pnpm --filter @tracepilot/desktop test` — 417 tests passing (0 failures)
- `pnpm --filter @tracepilot/ui test` — 639 tests passing (0 failures)
