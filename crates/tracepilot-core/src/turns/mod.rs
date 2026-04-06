//! Conversation turn reconstruction from flat typed event streams.
//!
//! ## Architecture
//!
//! [`TurnReconstructor`] is an encapsulated state machine that processes a
//! chronologically-ordered stream of [`TypedEvent`]s and produces a
//! `Vec<ConversationTurn>`.
//!
//! ## State Machine
//!
//! Turn reconstruction has two logical states: **idle** (`current_turn == None`)
//! and **in-turn** (`current_turn == Some(...)`):
//!
//! 1. A `UserMessage` opens a new turn (finalizing any previous one)
//! 2. `AssistantTurnStart` / `AssistantTurnEnd` bracket the assistant's response
//! 3. `ToolExecutionStart` / `ToolExecutionComplete` are paired into `TurnToolCall`s
//! 4. `SubagentStarted` / `SubagentCompleted` / `SubagentFailed` are treated as
//!    nested tool calls within the enclosing turn
//! 5. `AssistantMessage` appends content to the current turn
//! 6. `SessionModelChange` sets the turn-level model when no tool completion has
//! 7. `Abort` finalizes the current turn as incomplete
//!
//! Events that don't affect turn state (e.g. `SessionInfo`, `SystemNotification`)
//! are silently skipped.
//!
//! ## Tool Call Indexing
//!
//! Tool calls are tracked by `tool_call_id` in a `HashMap<String, (usize, usize)>`
//! mapping `id → (turn_index, tool_call_index)` for O(1) lookups. This replaces
//! the previous O(T×C) reverse linear scan pattern.
//!
//! ## Assumptions
//!
//! - Events are ordered chronologically (as written to `events.jsonl`)
//! - `parentId` links are used for subagent nesting, not for turn ordering
//! - A session may end mid-turn (no `TurnEnd`); the final turn is still emitted
//!
//! ## Module Structure
//!
//! This module is organized into focused sub-modules:
//! - [`reconstructor`]: Core state machine for turn reconstruction
//! - [`postprocess`]: Post-processing functions (model inference, name resolution)
//! - [`ipc`]: IPC preparation utilities (args summaries, payload optimization)
//! - [`utils`]: Shared utility functions (duration, truncation, etc.)

mod ipc;
mod postprocess;
mod reconstructor;
mod utils;

use crate::models::conversation::ConversationTurn;
use crate::parsing::events::TypedEvent;

// Re-export public items
pub use ipc::{compute_args_summary, prepare_turns_for_ipc};
pub use reconstructor::TurnReconstructor;

/// Aggregate statistics for reconstructed turns.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TurnStats {
    pub total_turns: usize,
    pub complete_turns: usize,
    pub incomplete_turns: usize,
    pub total_tool_calls: usize,
    pub total_messages: usize,
    pub models_used: Vec<String>,
}

/// Reconstruct conversation turns from a flat stream of typed events.
///
/// PERF: CPU-bound single pass — O(n) over events. For large sessions (>1000 events)
/// this can take 5-50ms. Called once per session load, then cached in TurnCache.
///
/// This is the public entry point — it delegates to [`TurnReconstructor`].
#[tracing::instrument(skip_all, fields(event_count = events.len()))]
pub fn reconstruct_turns(events: &[TypedEvent]) -> Vec<ConversationTurn> {
    let mut reconstructor = TurnReconstructor::new();
    for (idx, event) in events.iter().enumerate() {
        reconstructor.process(event, idx);
    }
    reconstructor.finalize()
}

/// Compute summary statistics for reconstructed turns.
pub fn turn_stats(turns: &[ConversationTurn]) -> TurnStats {
    let mut models_set = std::collections::HashSet::new();

    for model in turns.iter().filter_map(|turn| turn.model.as_ref()) {
        models_set.insert(model.clone());
    }
    let models_used: Vec<String> = models_set.into_iter().collect();

    TurnStats {
        total_turns: turns.len(),
        complete_turns: turns.iter().filter(|turn| turn.is_complete).count(),
        incomplete_turns: turns.iter().filter(|turn| !turn.is_complete).count(),
        total_tool_calls: turns.iter().map(|turn| turn.tool_calls.len()).sum(),
        total_messages: turns.iter().map(|turn| turn.assistant_messages.len()).sum(),
        models_used,
    }
}

#[cfg(test)]
mod tests;
