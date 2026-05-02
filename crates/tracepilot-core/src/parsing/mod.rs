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

/// File name for the JSONL event log.
pub const EVENTS_JSONL: &str = "events.jsonl";
/// File name for the YAML workspace metadata.
pub const WORKSPACE_YAML: &str = "workspace.yaml";
/// File name for the SQLite session database.
pub const SESSION_DB: &str = "session.db";
/// Directory name for checkpoints.
pub const CHECKPOINTS_DIR: &str = "checkpoints";
/// Directory name for rewind snapshots.
pub const REWIND_SNAPSHOTS_DIR: &str = "rewind-snapshots";
