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
//!    the Tauri FFI boundary.
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
//! | [`models`] | Domain types: events, summaries, conversations |
//! | [`parsing`] | Event parsing pipeline, diagnostics, workspace/DB parsers |
//! | [`session`] | Session discovery (scan, resolve, filter) |
//! | [`summary`] | Session summary orchestration |
//! | [`turns`] | Turn reconstruction state machine |

pub mod analytics;
pub mod constants;
pub mod error;
pub mod ids;
pub mod models;
pub mod parsing;
pub mod paths;
pub mod session;
pub mod summary;
pub mod turns;
pub mod utils;

/// Heap profiling with dhat-rs (opt-in via `dhat-heap` feature).
///
/// Enable with: `cargo test -p tracepilot-core --features dhat-heap`
/// or `cargo run --features dhat-heap`
///
/// When enabled, the `#[global_allocator]` is replaced with dhat's profiling
/// allocator. On drop, it writes `dhat-heap.json` in the current directory,
/// which can be viewed in Firefox at <https://nnethercote.github.io/dh_view/dh_view.html>.
#[cfg(feature = "dhat-heap")]
#[global_allocator]
static ALLOC: dhat::Alloc = dhat::Alloc;

#[cfg(test)]
pub mod testing;

pub use error::{Result, TracePilotError};
pub use ids::{SessionId, SkillName};
pub use models::{ConversationTurn, SessionEvent, SessionSummary, ShutdownMetrics, TurnToolCall};
pub use session::discovery::{
    discover_sessions, resolve_session_path, resolve_session_path_direct,
};
pub use summary::{SessionLoadResult, load_session_summary, load_session_summary_with_events};
pub use turns::{TurnStats, reconstruct_turns, turn_stats};

#[cfg(test)]
mod dhat_tests {
    #[cfg(feature = "dhat-heap")]
    #[test]
    fn profile_heap_session_parsing() {
        use std::io::Write;
        let _profiler = dhat::Profiler::builder().testing().build();

        // Write a temp events.jsonl file
        let dir = std::env::temp_dir().join("dhat_test_session");
        std::fs::create_dir_all(&dir).unwrap();
        let events_path = dir.join("events.jsonl");
        {
            let mut f = std::fs::File::create(&events_path).unwrap();
            for i in 0..50 {
                writeln!(f, r#"{{"type":"user_message","timestamp":"2024-01-01T00:00:{:02}Z","data":{{"content":"Turn {} user message with some content to allocate"}}}}"#, i, i).unwrap();
                writeln!(f, r#"{{"type":"assistant_message","timestamp":"2024-01-01T00:00:{:02}Z","data":{{"content":"Turn {} assistant response with generated text","model":"claude-sonnet-4-20250514"}}}}"#, i, i).unwrap();
            }
        }

        let parsed = crate::parsing::events::parse_typed_events(&events_path).unwrap();
        let _turns = crate::turns::reconstruct_turns(&parsed.events);

        let stats = dhat::HeapStats::get();
        eprintln!("\n=== DHAT HEAP PROFILING RESULTS ===");
        eprintln!("Total bytes allocated:   {}", stats.total_bytes);
        eprintln!("Total allocations:       {}", stats.total_blocks);
        eprintln!("Peak bytes (max live):   {}", stats.max_bytes);
        eprintln!("Peak allocations:        {}", stats.max_blocks);
        eprintln!("Currently live bytes:    {}", stats.curr_bytes);
        eprintln!("Currently live allocs:   {}", stats.curr_blocks);
        eprintln!("====================================\n");

        std::fs::remove_dir_all(&dir).ok();
    }
}
