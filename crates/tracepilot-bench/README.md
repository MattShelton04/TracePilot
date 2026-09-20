# tracepilot-bench

Synthetic fixture generators and Criterion benchmarks for the TracePilot Rust
backend. Publishing is disabled (`publish = false`) — this crate exists to
keep performance regressions out of `tracepilot-core` and
`tracepilot-indexer`.

## Public API

The library surface is intentionally small; it lives in `src/lib.rs` and
exposes fixture builders that produce on-disk `workspace.yaml` +
`events.jsonl` pairs deterministically. Benchmarks live under `benches/` and
are discovered by Criterion via `Cargo.toml`.

See rustdoc for the exact function list:

```bash
cargo doc -p tracepilot-bench --no-deps --open
```

## Usage

```bash
cargo bench -p tracepilot-bench                          # run every bench
cargo bench -p tracepilot-bench -- session_scan          # filter by name
cargo bench -p tracepilot-bench --bench ipc_hot_path     # IPC hot-path only
cargo bench -p tracepilot-bench --features dhat-heap     # heap profile
```

Profiling output (`dhat-heap.json`) can be loaded in the
[dh_view](https://nnethercote.github.io/dh_view/dh_view.html) viewer.

## IPC hot-path harness (w121)

The `ipc_hot_path` bench measures the Rust service-layer functions that back
the hottest Tauri IPC commands (`list_sessions`, `search_content`, `facets`,
`fts_health`, `get_tool_analysis`, `get_code_impact`, plus the serialization
leg of `get_analytics`). The `ipc.*` values in `perf-budget.json` are product
latency targets; these service-only Criterion cases provide diagnostic context
but do not measure or enforce end-to-end IPC latency.

The Tauri runtime is intentionally **not** involved: benches call the pure
`IndexDb` methods directly against a freshly built, read-only DB. That isolates
backend latency from the IPC bridge and keeps benches reproducible on CI
runners without a display server. Native release measurement through the real
Windows app remains manual: after starting the isolated production harness,
run `node scripts/perf/desktop.mjs --manifest=<fixture-manifest> --out=<result-dir>`.
See `docs/reports/performance-mission.md` for its scope and limitations.

Historical pre-correction results are retained in
[`BASELINE.md`](./BASELINE.md) for provenance, but are invalidated because the
old multi-session fixture names were rejected by production discovery.
Criterion reports an estimate of the mean and an approximate 95% confidence
interval around that mean. The upper confidence bound is not a P95 latency
percentile.

## CI result contract

The nightly and manually dispatched `Benchmarks` workflow runs Criterion on a
shared Ubuntu runner. It requires the corrected `parse_typed_events/1000`,
`compute_analytics/100`, and `ipc_search_content/fts_common_term/100` results,
recording the fixture identity `v2-nonempty-fixtures`, the mean estimate, and
its confidence interval. Missing or malformed results fail the run. Timing
threshold exceedances are advisory because shared-runner variance is
unsuitable for a hard performance gate.

Each run uploads `benchmark-output.json`, `benchmark-summary.md`, and the full
Criterion report tree as a 90-day Actions artifact. The workflow also writes
the summary into the run page. It does not publish to Pages or comment on pull
requests, and it does not run the native Windows desktop harness.

## Workspace dependencies

- `tracepilot-core` — the code under measurement.
- `tracepilot-indexer` — indexing benchmarks.

## Features

| Feature     | Purpose                                             |
| ----------- | --------------------------------------------------- |
| `dhat-heap` | Forwards to `tracepilot-core/dhat-heap` for profiling |

## Layout

- `src/lib.rs` — deterministic session fixture generators.
- `benches/` — Criterion benchmark harnesses (one `*.rs` per scenario).
- `BASELINE.md` — recorded IPC hot-path numbers (see `ipc_hot_path` bench).

## Frontend render budgets (w122)

While this crate covers Rust/IPC budgets, complementary **frontend render
budgets** live under `render.*` in `perf-budget.json` and are enforced
passively at runtime by the `useRenderBudget` composable
(`apps/desktop/src/composables/useRenderBudget.ts`).

| Budget key                         | View                         | Budget |
| ---------------------------------- | ---------------------------- | ------ |
| `render.sessionListViewMs`         | `SessionListView.vue`        | 120ms  |
| `render.chatViewModeMs`            | `ChatViewMode.vue`           | 200ms  |
| `render.analyticsDashboardViewMs`  | `AnalyticsDashboardView.vue` | 180ms  |
| `render.orchestrationHomeViewMs`   | `OrchestrationHomeView.vue`  | 150ms  |

The composable times from Vue's `onMounted` to the second nested
`requestAnimationFrame` (i.e. the first paint commit) and emits a
`console.warn` in DEV when the budget is exceeded. Production bundles
tree-shake the instrumentation away via `import.meta.env.DEV`; QA can
opt in at runtime in a shipped build by setting `window.__tracepilot_perf`.

## Related

- Budgets: `perf-budget.json` at the repo root.
- File-size guard-rails: `scripts/check-file-sizes.mjs`.

## Flamegraph profiling (FU-07)

Flamegraph a single Criterion bench with:

```bash
just bench-flamegraph ipc_hot_path
```

Output lands in `target/flamegraphs/<bench>.svg`. The recipe is an opt-in
dev tool wrapper — **not** a workspace dependency — so install
`cargo-flamegraph` yourself:

```bash
cargo install flamegraph
```

Platform notes:

- **Linux** — requires `perf` (`apt install linux-tools-$(uname -r)`).
- **macOS** — uses `dtrace`; may require disabling SIP for kernel probes.
- **Windows** — `cargo flamegraph` support is experimental. Prefer
  [`samply`](https://github.com/mstange/samply)
  (`cargo install samply`) for a cross-platform equivalent; on macOS,
  `cargo install cargo-instruments` hooks into Xcode Instruments.

The recipe prints a helpful install hint (and exits 0) when the tool is
missing, so it's safe to run speculatively.
