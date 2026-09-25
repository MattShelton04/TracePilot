# Performance and concurrency review — 25 September 2026

Profiling of the real Windows release app (Tauri/WebView2), the Rust backend and the
frontend, followed by fixes for the five largest bottlenecks. It also hardens concurrent
indexing and reads, and adds same-runner CI performance comparisons. Starting revision
`202fff8f`.

## Summary

| # | Bottleneck | Before → after | Confidence |
|---|---|---|---|
| 1 | First run with "Skip setup": each view scans every session from disk, concurrently | Session list visible after **189 s → 11 s**; Rust peak memory **11.5 GB committed / 6.6 GB resident → 2.3 GB resident** | High |
| 2 | Opening a 4,000-turn conversation lays out the entire history repeatedly | **7.8 s → 3.5 s** warm (−54%), 8.7 → 4.4 s first open | High |
| 3 | Scrolling long conversations | Every frame >20 ms, p95 66–78 ms → **p50 5.9 ms, p95 6.2 ms, 0 frames >20 ms** | High |
| 4 | Incremental search indexing rebuilds the whole FTS index once ≥10 sessions changed | 10 new sessions on the real corpus: **6.0 s → 0.28 s** (−95%) | High |
| 5 | Session list grid lays out every card | 500 sessions: **290 → 175 ms** warm (−40%) | High |

Environment: Ryzen 5 3600 (6 cores / 12 threads), 16 GB RAM (~4.7 GB free during tests),
Windows 11, WebView2. Corpora:

- Real: your 590 sessions / 6.9 GB, only read, with scratch databases.
- Synthetic `massive`: 500 sessions / 3.1 GB, including 4,000-turn / 12,000-tool
  "monster" sessions.
- Synthetic `large`: 1,000 sessions / 48 MB.

UI numbers come from `scripts/perf/desktop.mjs` (5 samples). "Warm" is the median of
samples 2–5. All before/after ranges were disjoint. Baseline and candidate binaries were
swapped over the same isolated data root and index.

## 1. Concurrent disk-scan fallbacks on first run (the "skip setup" storm)

**Reproduction.** Fresh data root with no index → "Skip setup" → Analytics → click
7d/30d/90d/This Month/All → Tools → Code → Models → Search → Analytics → Tools → Sessions.

**Root cause** (traced through code, confirmed live):

- "Skip setup" goes straight to the app with no index. `list_sessions`, `get_analytics`,
  `get_tool_analysis` and `get_code_impact` each fell back to a **full disk scan**
  whenever the index was missing or had 0 sessions (`helpers/db.rs::open_index_db`,
  `commands/analytics_executor.rs`, `commands/session/list.rs`).
- These scans parse every `events.jsonl`, even the "summaries only" loader. On your
  corpus that is 11–13 s of CPU each.
- The analytics loaders keep every session's reconstructed turns in memory at once, and
  the fallback also reconstructed turns twice.
- Nothing bounded them. Each filter change is a new frontend cache key, so each click
  started another full scan in parallel. Superseded requests were never cancelled
  server-side.
- Indexing only started *after* the list's own disk scan finished
  (`SessionListView` awaits `fetchSessions` before `ensureIndex`).
- Once the first batch of 100 sessions was committed, analytics read a **partial index**.
  The frontend then cached those partial numbers, and nothing invalidated them after
  indexing.

**Measured (massive corpus, same scripted click path, release app):**

| | Baseline | Candidate |
|---|---:|---:|
| Session list populated | 189.4 s | 11.3 s |
| `get_analytics` / `get_code_impact` / `get_tool_analysis` | 218 s / 187 s / still running when sampling ended (240 s) | ≤10.9 s / 8.4 s / 8.8 s |
| Rust process peak | 6.6 GB resident, **11.5 GB committed** (machine paging; CPU starved at ~25% of one core) | 2.25 GB resident over the whole run, including full search indexing |
| Analytics after the storm | partial and cached | complete (500 sessions) |

**Fix.**

- **`ensure_index_ready`** (`commands/search/reindex.rs`): the session list and all three
  analytics commands build the index on demand instead of scanning disk. Every
  concurrent caller shares that one build. Readers wait while an index is being
  populated from empty, so they never see partial data.
- Disk scans remain only as a fallback when the index cannot be built. They are now
  serialised by a new `disk_scan` gate.
- Incremental reindex requests **queue and coalesce**. A caller that arrives during a
  running job waits for it, and is satisfied by the next job that started after it
  arrived, so N concurrent callers cost at most two passes (`concurrency/index_jobs.rs`).
- Frontend: analytics caches are dropped, and mounted pages refetch once, when
  `indexing-finished` fires. Filter changes use the per-filter cache instead of forcing
  a refetch every time.
- While the first build runs, the session list shows real indexing progress instead of a
  bare spinner.
- The analytics fallback reuses the turns that summary enrichment already reconstructed
  (it previously reconstructed them twice).

## 2 and 3. Long-conversation rendering and scrolling

**Root causes** (CPU profiles plus Chromium traces of the real app):

- **Forced full-document layout.** `useChatViewPanelOffset` (`getBoundingClientRect`, 2.4 s)
  and `useAutoScroll` (`scrollHeight`, 1.1 s) forced synchronous layout of all 4,000
  turns at mount.
- **Per-frame paint and hit-testing of the whole history while scrolling.** Paint cost
  ~31 ms/frame and hover hit-testing ~29 ms/frame.
- **`panelTopPx` re-rendered the entire chat view on every scroll frame** while the page
  header scrolled away. `ChatViewMode`'s template read it to pass to `SubagentPanel`,
  costing ~120 ms/frame for the first ~280 px of scrolling.
- The scroll handler rewrote CSS custom properties on every scroll event, invalidating
  style for the whole subtree.
- The turn list was a deep `ref`, so ~20 MB of turn data was wrapped in reactive proxies
  as components read it.

**Fix.**

- Turns render in chunks of 10, each a **`content-visibility: auto`** container. This
  covers chat, compact and timeline views.
  - Chunks rather than per-turn containers, because the browser checks every such element
    each frame. At ~12k elements that alone cost ~12 ms/frame.
  - All turns stay mounted: **find-in-page, selection, copy and deep links are
    unaffected** (verified below).
- `SubagentPanel` accepts a getter for its offset, so only the panel re-renders. The
  offset is tracked only while the panel is open.
- Breakout CSS variables are written only when they change.
- Turns are held in a `shallowRef`; the in-place live merge calls `triggerRef` explicitly.

**Measured (4,000-turn / 12,000-tool session, 1440×960):**

| | Baseline | Candidate |
|---|---:|---:|
| Open, first / warm median | 8,682 / 7,760 ms | 4,444 / 3,535 ms |
| Scroll 40 px/frame from top, 360 frames, chat view | p50 26 ms, p95 66–78 ms, **360/360 frames >20 ms**, 45–61 >33 ms | p50 5.9 ms, p95 6.2 ms, max 13 ms, **0 >20 ms** |
| Wheel scrolling (same build, containment disabled vs enabled) | 326/977 frames >33 ms | 0/1,104 |
| Scrollbar-style jump into unrendered history | 117 ms | 25 ms |
| Timeline view scroll | p50 22 ms, 35 frames >33 ms | p50 5.9 ms, 0 >33 ms |
| Switch to compact / timeline view | 2.6 s / 4.7 s | 1.5 s / 2.1 s |
| 200-turn session (reference) | p50 6.5 ms | unchanged |

**UX checks.**

- Screenshots at 1440×960 of all three views mid-conversation: no clipping of the hover
  turn labels or timeline markers.
- `window.find` locates text inside off-screen turns.
- Deep-link `scrollIntoView` lands the target in view, and scroll-to-bottom stays pinned.
- JS heap after forced GC across four visits: 73 → 90 → 91 → 107 → 123 MB. The
  +300 MB/visit seen earlier was deferred GC, not a leak.

**Known difference.** `innerText` skips off-screen chunks (`textContent` does not). No app
code reads conversation `innerText`.

## 4. Incremental search indexing cliff

**Root cause.** `reindex_search_content` switched to its "bulk" path once ≥10 sessions
needed indexing. That path drops the FTS triggers and rebuilds **the entire FTS index**,
so its cost scaled with the whole corpus rather than with what changed. On your real
index (605k rows): 9 changed small sessions took 0.11 s, while 10 took 5.8 s.

**Fix.** Choose bulk mode from a row-based cost model measured on the real index: triggers
sustain ~18k rows/s, while the bulk rebuild runs at ~108k rows of *total* index per
second. So bulk is used only when the new rows are ≥20% of the index; this still covers
first index, rebuilds and extractor upgrades. The writer connection also gets a 64 MiB
page cache and in-memory temp storage (one writer at a time).

**Measured** (real corpus; ABBA-alternated base/head builds via `probe-compare.mjs`):

| Phase | Base | Head |
|---|---:|---:|
| 10 small sessions changed | 5.99 s | 0.28 s |
| 3 large sessions changed | 4.31 s | 3.02 s |
| Full search index | 24.3 s | 22.9 s (within noise) |
| Fresh session index | 6.66 s | 6.65 s |

## 5. Session list

All session cards are laid out even though a few dozen are visible. The same
`content-visibility` treatment gives 290 → 175 ms warm on 500 sessions. Filtering,
keyboard focus and find still work because the cards stay mounted.

## Concurrency hardening (found by reading the code and trying to break it)

| Issue | Consequence | Fix | Confidence |
|---|---|---|---|
| Full rebuild deleted the DB while a background search pass could still be writing | Windows sharing violation, or search writes into a deleted file | Full rebuild cancels the search pass and holds its gate until done | High |
| Factory reset deleted DB files with no gate held | Same as above, from Settings | Waits for session jobs and cancels search first | High |
| A search pass requested while another ran was silently dropped | Newly indexed sessions unsearchable until the next reindex | Rerun flag; the running pass loops once more (race-safe hand-off) | High |
| `reindex_sessions` returned `AlreadyIndexing` to background callers | List not refreshed after a concurrent index | Callers queue and coalesce (see §1) | High |
| DB deletion failed immediately if any reader had it open | The "sharing violation" noted in the previous report | Bounded retry (2 s) on sharing/lock violations | Medium–high |
| Two concurrent misses for one session parsed the same event log twice | 2× CPU/memory when prefetch races an open (logs up to 68 MB) | Per-session single-flight in the event cache | High |
| A dropped cancel request could leave the cancel flag set | Every later search pass cancelled | Flag cleared by a drop guard | High |

Unit tests cover the job state, queueing, cancel/rerun, the guard, the parse lock, the bulk
heuristic, analytics invalidation, the panel-offset behaviour and turn-merge reactivity.

## CI benchmarking changes

The existing lane runs Criterion nightly on `main` with absolute timings on a shared runner,
checked against loose advisory budgets. No PR is compared with its base, and memory is not
measured, so a 50% regression can pass unnoticed.

Added:

- **`.github/workflows/benchmark-compare.yml`** (PRs touching Rust, read-only permissions).
  It measures base and head **on the same runner, back to back**:
  - Criterion `--save-baseline` / `--baseline-lenient`, summarised by
    **`scripts/perf/criterion-compare.mjs`**. A verdict requires the whole confidence
    interval beyond ±10%.
  - **`scripts/perf/probe-compare.mjs`** runs ABBA-alternated `index_probe` builds over a
    generated 1,000-session corpus. It reports wall time and **peak RSS** for: fresh
    session index, fresh search index, incremental passes, and the analytics disk-scan
    fallback.
  - Both post annotations and a job summary and are advisory, matching the existing
    policy.
- `crates/tracepilot-bench/examples/index_probe.rs`: the phase probe used above. It uses
  only public APIs so it also builds against the base revision.
- `scripts/perf/desktop.mjs` gains a `conversation-scroll` sample (per-frame p50/p95/max,
  dropped frames). `compare.mjs` compares it when both runs have it.

Validation and lessons:

- A local dry run exercised the full flow.
- It first measured **the same binary twice**, because Cargo does not re-copy an
  up-to-date example into `target/release/examples`. The workflow now builds each probe
  into its own target directory; the playbook documents this.
- Those accidental A/A runs are useful evidence for the flag threshold. At 3 repeats,
  noise was ≤2% on the synthetic corpus, but one phase showed 18–25% on the real corpus.
  Hence 6 repeats and a ±15% band in CI.
- An `incremental_search` Criterion bench was tried and **discarded**. Synthetic
  fixtures don't carry enough text for a whole-index rebuild to dominate, so it could not
  detect the cliff. The probe lane on the generated corpus does detect it (347 → 195 ms).

## Remaining opportunities (not implemented)

| Opportunity | Evidence / expected effect | Confidence |
|---|---|---|
| Append-only parsing for live sessions | Each auto-refresh tick (5 s) re-parses a changed session in full and deletes/reinserts all its search rows: ~0.4–1 s of writes per large session per tick | Medium (magnitude measured on the 9 largest sessions) |
| Stream search rows into the bulk write in chunks | Phase 2 holds every extracted row before writing: ~1.1–1.3 GB peak on the real corpus | Medium |
| Mount turns near the viewport first when opening huge conversations | The remaining 3.5 s is Vue component creation for 4,000 turns. Would help first paint, but unmounted text isn't findable, so it needs a find-aware design | Medium |
| Stop deep-cloning cached turns on every `get_session_turns` | Memory churn on large sessions | Medium–low |
| Headless frontend render/scroll benchmark in CI | Mock mode has no large-session fixture yet; the scroll probe in `desktop.mjs` is a starting point | Medium |
| Small residual heap growth on repeat visits (~16 MB/visit after GC) | Likely the per-session cache; not a leak at this rate | Low |
| Analytics warm time also fell 510 → 316 ms | Probably less GC pressure from the `shallowRef` change; not directly attributable | Low |

## Behaviour changes to review

- **Skip setup:** the session list now shows "Building the session index" with a progress
  bar until the first build finishes (~9–11 s here), instead of an empty page for minutes.
- **`reindex_sessions` queues instead of returning `AlreadyIndexing`.** The Settings full
  rebuild still fails fast with `AlreadyIndexing`.
- **Changing the data directory during a search pass** now cancels that pass instead of
  refusing the change.
- **Scrollbar thumb size on long conversations** is approximate until regions have been
  rendered once; heights are then remembered.

Also noted: pre-existing Biome findings in `packages/ui/src/components/TabNav.vue` and
`scripts/perf/bundle-markdown.test.mjs` are not touched by this change.

## Reproduce

```powershell
cargo run --release -p tracepilot-bench --example index_probe -- phase2-stale <session-state> <scratch.db> 10 small
node scripts/perf/probe-compare.mjs --base=<base probe> --head=<head probe> --sessions=<session-state> --work=<scratch> --repeats=4
pnpm app:start -Runtime production -DataRoot <corpus>
node scripts/perf/desktop.mjs --manifest=<corpus>/fixture-manifest.json --out=<dir> --samples=5 --session=<id>
```

The skip-setup scenario needs a data root with `setupComplete = false` and no `index.db`.
Raw local evidence (IPC logs, CPU profiles, traces, samples, screenshots) stays out of the
repository.
