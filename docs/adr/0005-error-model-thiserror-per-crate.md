# ADR-0005: Error model — thiserror enums per crate, no anyhow in production code

Date: 2026-04-22
Status: Accepted

## Context

TracePilot's Rust code spans seven production crates. Early on, errors
were a mix of `anyhow::Error`, `Box<dyn Error>`, and ad-hoc `String`
messages. Two concrete problems emerged:

1. **IPC error surface.** The Tauri plugin needs to map Rust errors
   into a stable wire shape (`BindingsErrorIpc`) the UI can match on.
   `anyhow::Error` erases type information — the UI ended up
   substring-matching on error messages, which broke every time we
   tweaked wording.
2. **Library-vs-application confusion.** Our crates are libraries —
   `tracepilot-core`, `tracepilot-indexer`, etc. `anyhow` is an
   application-level type and hides the error taxonomy from callers.
   Callers should be able to pattern-match on `ParseError` vs
   `DatabaseError` without guessing.

## Decision

1. **Per-crate `thiserror` enums** named `<Crate>Error`, each with a
   crate-local `type Result<T> = std::result::Result<T, XError>`:
   - `tracepilot_core::error::TracePilotError` (`core::error::Result`).
   - `tracepilot_indexer::error::IndexerError`.
   - `tracepilot_export::error::ExportError`.
   - `tracepilot_orchestrator::error::OrchestratorError` (plus
     scoped sub-enums `mcp::error` and `skills::error`).
   - `tracepilot_tauri_bindings::error::<BindingsError variants>`.
2. **No `anyhow` in production code.** `anyhow` remains available as a
   dev-dependency for tests, benches, and binaries where a trait-
   object error is fine. Production crates (`src/`) must not use it.
   `thiserror` variants use `#[from]` for transparent conversions
   (`std::io::Error`, `rusqlite::Error`, `serde_json::Error`,
   `serde_yml::Error`, …).
3. **Structured IPC envelope.** The bindings crate maps its error
   enum into `BindingsErrorIpc` (a Specta-generated wire shape, see
   ADR-0002). UI code pattern-matches on the envelope's `code` field,
   never on free-form text.
4. **Best-effort emits are explicit.** When the backend pushes an
   event to a webview that may no longer exist (window closed mid-
   operation), the helper
   `tracepilot_tauri_bindings::helpers::emit::emit_best_effort`
   swallows the error at `debug!` level with a clear rationale in its
   doc comment. This is the single sanctioned seam for "I know this
   may fail and I do not care" — every other error path must be
   propagated.
5. **Context carriers.** `TracePilotError::io_context(path, source)`
   and siblings exist so IO errors carry the path they failed on —
   avoiding the classic "No such file or directory" with no filename.

## Consequences

- **Positive**: UI code can `switch (err.code)` on a stable Specta
  enum. No more substring matching.
- **Positive**: Upstream crate changes show up as compiler errors in
  consumers (new enum variants or renamed fields), not at runtime.
- **Positive**: `emit_best_effort` is grep-able; a sweep for other
  swallowed errors is trivial.
- **Negative**: Boilerplate — each crate has an `error.rs`. Accepted;
  `thiserror` keeps it minimal.
- **Negative**: A few legacy call sites still box errors through
  `Box<dyn Error + Send + Sync>` (see `TracePilotError::ParseError`'s
  `source` field). These are acceptable as bridge points for
  third-party errors we don't want to enumerate.

## Alternatives considered

- **Keep `anyhow` everywhere.** Rejected — erases types at the IPC
  boundary and the UI consequently couples to error-message wording.
- **`eyre` / `color-eyre`.** Rejected — same category as `anyhow` for
  our purposes; nicer reports but no better for structured
  pattern-matching.
- **Single repo-wide error enum**. Rejected — would force
  `tracepilot-core` to know about orchestrator-only failure modes,
  inverting the dependency graph.
- **`snafu`**. Rejected — `thiserror` is lower-ceremony for the
  shape we want, and is already a workspace dependency.

## Consequences for reviewers

A PR that adds `use anyhow::...` to a production `src/` file should be
sent back. Tests and `bin/` are fine. New crate-level errors should
start with a `thiserror` enum and a local `Result` alias, mirroring
the pattern in `crates/tracepilot-core/src/error.rs`.

## References

- `crates/tracepilot-core/src/error.rs` — canonical pattern.
- `crates/tracepilot-indexer/src/error.rs`,
  `crates/tracepilot-export/src/error.rs`,
  `crates/tracepilot-orchestrator/src/error.rs`,
  `crates/tracepilot-orchestrator/src/mcp/error.rs`,
  `crates/tracepilot-orchestrator/src/skills/error.rs`,
  `crates/tracepilot-tauri-bindings/src/error.rs`.
- `crates/tracepilot-tauri-bindings/src/helpers/emit.rs` —
  `emit_best_effort`.
- ADR-0002 — IPC contract (where `BindingsErrorIpc` comes from).
