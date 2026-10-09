# tracepilot-export

Export TracePilot sessions to Markdown or JSON with optional secret
redaction and per-section content filtering. Importers for portable session
archives live here too.

## Pipeline

```text
Session dir(s) / provider snapshots ──▶ builder ──▶ SessionArchive ──▶ filters ──▶ redaction ──▶ renderer ──▶ ExportFile(s)
```

`SessionArchive` is the canonical intermediate representation consumed by
every renderer.

Copilot sessions are read from their directory. Other sources export from
their provider's `ProviderSnapshot` and artifacts (`ExportInput::Provider`).
Each session's `metadata.source` names its source and is omitted for Copilot,
so Copilot output is unchanged and older archives read as Copilot. The records
behind translated events always lose their private fields
(`tracepilot_core::provider::redact_native_record`). Import accepts Copilot
sessions only. `tests/copilot_export_golden.rs` holds Copilot output
byte-for-byte; regenerate it with `TRACEPILOT_UPDATE_GOLDEN=1` only after an
intentional change.

The v1.0 JSON content hash covers the sessions array in its original field order,
using serde_json's two-space pretty layout. Import normalizes insignificant JSON
whitespace but preserves strings and numeric spelling when verifying that payload.
It never derives the hash from deserialized HashMaps, whose iteration order can
change. Existing exports keep the same hash format; altered payloads still fail
verification.

## Public API

Re-exported from `src/lib.rs`:

| Name                                                              | Purpose                                   |
| ----------------------------------------------------------------- | ----------------------------------------- |
| `export_session(session_dir, options)`                            | Export a single session                   |
| `export_sessions_batch(dirs, options)`                            | Export many sessions into one archive     |
| `preview_export(session_dir, options, max_bytes)`                 | Render to a string without writing        |
| `export_inputs(inputs, options)`                                  | Export sessions of any source             |
| `preview_export_input(input, options, max_bytes)`                 | Preview a session of any source           |
| `ExportInput`, `ProviderSession`                                  | A Copilot directory or a provider session |
| `SessionArchive`, `PortableSession`, `SectionId`                  | Document model                            |
| `ExportFormat`, `ExportOptions`, `OutputTarget`                   | Format + destination selection            |
| `ContentDetailOptions`, `RedactionOptions`                        | Filter + redaction toggles                |
| `ExportFile`, `ExportRenderer`                                    | Renderer contract for new formats         |
| `ExportError`, `Result`                                           | Crate error type (per ADR 0005)           |

Modules: `builder`, `content_filter`, `document`, `error`, `import`,
`options`, `redaction`, `render`, `schema`.

## Usage

```rust
use tracepilot_export::{export_session, ExportFormat, ExportOptions};

let options = ExportOptions {
    format: ExportFormat::Markdown,
    ..Default::default()
};
let files = export_session(session_dir, &options)?;
for f in files { std::fs::write(&f.path, &f.bytes)?; }
```

## Workspace dependencies

- `tracepilot-core` — session parsing.

## Layout

- `src/lib.rs` — public API + pipeline helper.
- `src/builder/` — builds `SessionArchive` from a session directory or a
  provider snapshot (`provider.rs`).
- `src/document.rs` — archive shape + portable JSON schema types.
- `src/options.rs` — format/redaction/content-detail options.
- `src/content_filter.rs` — applies `ContentDetailOptions` to an archive.
- `src/redaction/` — secret-masking passes.
- `src/render/` — per-format renderers (Markdown, JSON).
- `src/import/` — parse `PortableSession` archives back into the model.
- `src/schema.rs` — versioned schema constants for portable archives.

## Related ADRs

- [0005 — Error model](../../docs/adr/0005-error-model-thiserror-per-crate.md)
