# tracepilot-test-support

Shared test-only helpers and fixtures for the TracePilot Rust workspace.
`publish = false`; consumed exclusively from `[dev-dependencies]`.

Promoting shared helpers here keeps `#[cfg(test)]` modules across crates from
drifting and lets integration tests reuse the same builders as unit tests.
Background: `docs/tech-debt-plan-revised-2026-04.md` §3-safety.5 and wave
w127 of `docs/tech-debt-master-plan-2026-04.md`.

## Public API

Currently:

| Module       | Purpose                                                       |
| ------------ | ------------------------------------------------------------- |
| `fixtures`   | Session-directory fixture builders (`TempDir` + on-disk YAML / JSONL) |

Consumers add the crate as a dev-dep and import what they need:

```toml
[dev-dependencies]
tracepilot-test-support = { workspace = true }
```

```rust
use tracepilot_test_support::fixtures;

let session_dir = fixtures::minimal_session(&tmp)?;
```

## Workspace dependencies

None at runtime. Other `[dependencies]` are deliberately avoided so that
dev-deps don't leak into release builds of downstream crates.

## Layout

- `src/lib.rs` — crate-level docs + `pub mod fixtures;`.
- `src/fixtures.rs` — fixture builders (session directories, YAML/JSONL helpers).

Future consolidations tracked in the tech-debt plan may add analytics /
export builder modules behind cargo features so downstream crates opt in only
to what they use.

## Related ADRs

- [0001 — Tauri + Vue + Rust workspace](../../docs/adr/0001-tauri-vue-rust-workspace.md)
- [0005 — Error model](../../docs/adr/0005-error-model-thiserror-per-crate.md)
