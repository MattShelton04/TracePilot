# tracepilot-export

Export TracePilot sessions to Markdown, JSON, or CSV with optional secret
redaction and per-section content filtering. Importers for portable session
archives live here too.

## Pipeline

```text
Session dir(s) ──▶ builder ──▶ SessionArchive ──▶ filters ──▶ redaction ──▶ renderer ──▶ ExportFile(s)
```

`SessionArchive` is the canonical intermediate representation consumed by
every renderer.

## Public API

Re-exported from `src/lib.rs`:

| Name                                                              | Purpose                                   |
| ----------------------------------------------------------------- | ----------------------------------------- |
| `export_session(session_dir, options)`                            | Export a single session                   |
| `export_sessions_batch(dirs, options)`                            | Export many sessions into one archive     |
| `preview_export(session_dir, options, max_bytes)`                 | Render to a string without writing        |
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
- `src/builder.rs` — builds `SessionArchive` from a session directory.
- `src/document.rs` — archive shape + portable JSON schema types.
- `src/options.rs` — format/redaction/content-detail options.
- `src/content_filter.rs` — applies `ContentDetailOptions` to an archive.
- `src/redaction/` — secret-masking passes.
- `src/render/` — per-format renderers (Markdown, JSON, CSV).
- `src/import/` — parse `PortableSession` archives back into the model.
- `src/schema.rs` — versioned schema constants for portable archives.

## Related ADRs

- [0005 — Error model](../../docs/adr/0005-error-model-thiserror-per-crate.md)
