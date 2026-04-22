# tracepilot-bench — IPC hot-path baselines

Captured on Windows from `cargo bench -p tracepilot-bench --bench ipc_hot_path`
at wave **w121** (commit to be recorded once landed). Numbers are the Criterion
mean (middle of the `[low mean high]` interval) at the indicated corpus size.

Measurement was short-sampled (`--warm-up-time 1 --measurement-time 2
--sample-size 10`) to keep the bench run under a couple of minutes; re-run with
Criterion defaults for a tighter interval. Values will drift with Rust toolchain
and hardware — treat the shape (orders of magnitude) as the contract, not the
individual digit. See `perf-budget.json` (`ipc.*`) for the P95 targets these
feed into.

## Corpus

`tracepilot_bench::create_multi_session_fixture(count, 80)` → N synthetic
sessions × ~80 events each, fully reindexed (Phase 1 metadata + Phase 2 FTS
content). Corpora: **50 / 100 / 200** sessions. The `perf-budget.json` notes
target ~100 sessions.

## Results (mean)

All times **microseconds** (µs) unless stated. Budgets in `perf-budget.json`
are **milliseconds** — current values are **3–4 orders of magnitude under
budget**, so regressions that land here will still look green at the IPC layer
until they add up to ~100×.

### `ipc_list_sessions` → `ipc.listSessionsMs` (budget: 200 ms)

| sessions | no_filter | hide_empty | repo_filter |
| -------- | --------- | ---------- | ----------- |
| 50       | 16.9 µs   | 21.3 µs    | 26.5 µs     |
| 100      | 18.4 µs   | 20.7 µs    | 23.4 µs     |
| 200      | 16.8 µs   | 19.6 µs    | 24.0 µs     |

### `ipc_search_content` → `ipc.searchContentMs` (budget: 500 ms)

| sessions | browse  | fts common | fts rare |
| -------- | ------- | ---------- | -------- |
| 50       | 26.0 µs | 58.6 µs    | 60.5 µs  |
| 100      | 25.5 µs | 65.8 µs    | 59.8 µs  |
| 200      | 27.2 µs | 55.5 µs    | 57.2 µs  |

### `ipc_search_facets` → `ipc.getSearchFacetsMs` (budget: 500 ms, warm cache)

| sessions | browse  | fts      |
| -------- | ------- | -------- |
| 50       | 81.8 µs | 119.1 µs |
| 100      | 76.2 µs | 107.3 µs |
| 200      | 71.3 µs | 104.1 µs |

### `ipc_fts_health` → `ipc.ftsHealthMs` (budget: 200 ms)

| sessions | mean    |
| -------- | ------- |
| 50       | 55.9 µs |
| 100      | 58.0 µs |
| 200      | 58.8 µs |

### `ipc_tool_analysis` → `ipc.getToolAnalysisMs` (budget: 300 ms)

| sessions | mean    |
| -------- | ------- |
| 50       | 33.8 µs |
| 100      | 34.0 µs |
| 200      | 34.2 µs |

### `ipc_code_impact` → `ipc.getCodeImpactMs` (budget: 300 ms)

| sessions | mean    |
| -------- | ------- |
| 50       | 87.0 µs |
| 100      | 84.2 µs |
| 200      | 79.5 µs |

### `ipc_analytics_serialize` → serialization leg of `ipc.getAnalyticsMs`

| sessions | analytics_data | tool_analysis_data | code_impact_data |
| -------- | -------------- | ------------------ | ---------------- |
| 50       | 1.25 µs        | 9.28 µs            | 1.41 µs          |
| 100      | 1.23 µs        | 9.65 µs            | 0.26 µs\*        |
| 200      | 1.20 µs        | 9.28 µs            | 0.27 µs\*        |

\* The `code_impact_data` shrinks sharply above 50 sessions because the synthetic
corpus produces identical per-session code-change numbers; `serde_json` elides
repeated zero fields cheaply. Real corpora will track closer to the 50-session
row.

## How to compare to the budget

1. Run the bench: `cargo bench -p tracepilot-bench --bench ipc_hot_path`.
2. Pick the **P95** (upper bound of the `time:` interval) for the 100-session
   row — `perf-budget.json` notes are "Measured on a corpus of ~100 sessions …
   P95 targets".
3. Convert µs → ms and compare to the matching `ipc.*Ms` key. Anything within
   2× of the budget should be investigated — the current baseline leaves
   orders-of-magnitude headroom, so even a 10× regression is a real signal.

CI wiring that automates step 3 is tracked in the Wave 121 future-improvements
notes (`docs/tech-debt-future-improvements-2026-04.md`).
