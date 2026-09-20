# tracepilot-bench — IPC hot-path baselines

> **Invalidated historical data:** these measurements predate the corrected
> `v2-nonempty-fixtures` corpus. The old directory names were rejected by
> production session discovery, so database-backed cases could measure an
> empty database. Retain these numbers for provenance only; do not compare new
> results against them.

Captured on Windows from `cargo bench -p tracepilot-bench --bench ipc_hot_path`
at wave **w121** (commit to be recorded once landed). Numbers are the Criterion
mean (middle of the `[low mean high]` interval) labelled with the requested
corpus size; the discovered corpus could be empty.

Measurement was short-sampled (`--warm-up-time 1 --measurement-time 2
--sample-size 10`) to keep the bench run under a couple of minutes; re-run with
Criterion defaults for a tighter interval. Values will drift with Rust toolchain
and hardware — treat the shape (orders of magnitude) as the contract, not the
individual digit. The `ipc.*` values in `perf-budget.json` are separate
end-to-end product targets; these service-only results provide diagnostic
context rather than an automated IPC budget gate.

## Corpus

The intended corpus was
`tracepilot_bench::create_multi_session_fixture(count, 80)` → N synthetic
sessions × ~80 events each. The pre-v2 fixture directory names were not valid
production session IDs, so discovery could yield zero sessions instead of the
intended **50 / 100 / 200**. The tables below therefore are not populated
corpus baselines.

## Historical results (invalidated mean estimates)

All times **microseconds** (µs) unless stated. These values must not be used to
claim budget headroom because the database-backed fixtures could be empty.

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
| 100      | 1.23 µs        | 9.65 µs            | 0.26 µs         |
| 200      | 1.20 µs        | 9.28 µs            | 0.27 µs         |

## How to interpret the baseline

1. Do not compare a corrected run to the invalidated values above.
2. Run the corrected bench: `cargo bench -p tracepilot-bench --bench ipc_hot_path`.
3. Read the Criterion mean point estimate and its approximate 95% confidence
   interval. The interval describes uncertainty around the mean; its upper
   bound is not a latency percentile.
4. Compare the same named case and corpus size across like-for-like machines.
   Convert µs to ms only when using the `ipc.*Ms` product targets as broad
   diagnostic context.

CI validates and retains three required mean estimates from the parsing,
analytics, and indexer suites. It does not treat these historical
`ipc_hot_path` rows as end-to-end IPC measurements.
