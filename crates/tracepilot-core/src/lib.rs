//! # tracepilot-core
//!
//! Core library for parsing, modeling, and analyzing GitHub Copilot CLI sessions.
//!
//! ## Architecture
//!
//! ```text
//! Session Directory (~/.copilot/session-state/<uuid>/)
//! ├── workspace.yaml    → parse_workspace_yaml()  → WorkspaceMetadata
//! ├── events.jsonl      → parse_typed_events()     → ParsedEvents { events, diagnostics }
//! │   ├── RawEvent (envelope: type + data + id + timestamp)
//! │   ├── SessionEventType (24 known + Unknown catch-all)
//! │   └── TypedEventData (strongly-typed per event, fallback to Other)
//! ├── session.db        → read_todos()             → Vec<TodoItem>
//! ├── plan.md           → (presence check only)
//! ├── checkpoints/      → parse_checkpoints()      → CheckpointIndex
//! └── rewind-snapshots/ → parse_rewind_snapshots() → RewindIndex
//! ```
//!
//! ## Event Pipeline
//!
//! 1. **Raw parsing**: `events.jsonl` → `Vec<RawEvent>` (line-by-line, malformed lines
//!    are skipped and counted)
//! 2. **Type dispatch**: `RawEvent.type` → [`SessionEventType`] via `parse_wire()`
//!    (uses [`strum::EnumString`] with `#[strum(default)]` for unknown types)
//! 3. **Data deserialization**: `RawEvent.data` → [`TypedEventData`] variant
//!    (falls back to `Other(Value)` on failure)
//! 4. **Diagnostics**: Unknown types and deserialization failures are tracked in
//!    [`ParseDiagnostics`](parsing::diagnostics::ParseDiagnostics) — never crossing
//!    the Tauri FFI boundary. The health module consumes them.
//! 5. **Turn reconstruction**: `Vec<TypedEvent>` → `Vec<ConversationTurn>`
//!    (state machine in [`turns`])
//! 6. **Summary building**: Orchestrates all parsers → [`SessionSummary`]
//!
//! ## Adding a New Event Type
//!
//! 1. Define a data struct in [`models::event_types`] (all fields `Option<T>` for
//!    forward compat)
//! 2. Add a variant to [`SessionEventType`] with `#[strum(serialize = "wire.name")]`
//! 3. Add a corresponding variant to [`TypedEventData`]
//! 4. Add a match arm in `typed_data_from_raw()` (in `parsing/events.rs`)
//! 5. Handle the new variant in [`turns`] if it affects turn state
//!
//! That's it — strum generates all string conversion code automatically.
//!
//! ## Crate Modules
//!
//! | Module | Purpose |
//! |--------|---------|
//! | [`analytics`] | Cross-session aggregation (tokens, tools, code impact) |
//! | [`error`] | Crate-wide error types |
//! | [`health`] | Session health scoring with diagnostics-based heuristics |
//! | [`models`] | Domain types: events, summaries, conversations |
//! | [`parsing`] | Event parsing pipeline, diagnostics, workspace/DB parsers |
//! | [`session`] | Session discovery (scan, resolve, filter) |
//! | [`summary`] | Session summary orchestration |
//! | [`turns`] | Turn reconstruction state machine |

pub mod analytics;
pub mod error;
pub mod health;
pub mod models;
pub mod parsing;
pub mod session;
pub mod summary;
pub mod turns;

#[cfg(test)]
pub mod testing;

pub use error::{Result, TracePilotError};
pub use models::{ConversationTurn, SessionEvent, SessionSummary, ShutdownMetrics, TurnToolCall};
pub use session::discovery::{discover_sessions, resolve_session_path};
pub use summary::{load_session_summary, load_session_summary_with_events, SessionLoadResult};
pub use turns::{TurnStats, reconstruct_turns, turn_stats};
