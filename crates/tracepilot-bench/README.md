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
leg of `get_analytics`). Each case maps 1:1 to a key under `ipc.*` in
`perf-budget.json`.

The Tauri runtime is intentionally **not** involved: benches call the pure
`IndexDb` methods directly against a freshly built, read-only DB. That isolates
backend latency from the IPC bridge and keeps benches reproducible on CI
runners without a display server. End-to-end measurement through the real
bridge is tracked as a future improvement in
`docs/tech-debt-future-improvements-2026-04.md`.

Baselines captured in [`BASELINE.md`](./BASELINE.md). Compare the P95 (upper
bound of the Criterion `time:` interval) against the matching `ipc.*Ms` budget
— any regression that pushes a number within 2× of budget is worth
investigating. Current numbers are in microseconds, budgets in milliseconds,
so there is ample headroom.

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
