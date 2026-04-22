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
cargo bench -p tracepilot-bench --features dhat-heap     # heap profile
```

Profiling output (`dhat-heap.json`) can be loaded in the
[dh_view](https://nnethercote.github.io/dh_view/dh_view.html) viewer.

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

## Related

- Budgets: `perf-budget.json` at the repo root.
- File-size guard-rails: `scripts/check-file-sizes.mjs`.
