//! Parsers for session data files.
//!
//! Each submodule handles one file type within a Copilot CLI session directory:
//!
//! | Module | File | Output |
//! |--------|------|--------|
//! | [`events`] | `events.jsonl` | [`ParsedEvents`](events::ParsedEvents) (typed events + diagnostics) |
//! | [`workspace`] | `workspace.yaml` | [`WorkspaceMetadata`](workspace::WorkspaceMetadata) |
//! | [`session_db`] | `session.db` | Todos, custom tables |
//! | [`checkpoints`] | `checkpoints/` | Checkpoint index |
//! | [`rewind_snapshots`] | `rewind-snapshots/` | Rewind snapshot index |
//! | [`diagnostics`] | *(internal)* | Parse warnings and aggregated diagnostics |

pub mod checkpoints;
pub mod diagnostics;
pub mod events;
pub mod rewind_snapshots;
pub mod session_db;
pub mod workspace;
