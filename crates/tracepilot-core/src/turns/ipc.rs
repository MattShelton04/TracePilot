//! IPC preparation utilities for turn reconstruction.
//!
//! This module contains functions to optimize turn data for transfer to the frontend
//! via Tauri IPC, including computing human-readable argument summaries and stripping
//! unused fields to reduce payload size.

use super::args_summary::compute_args_summary;
use crate::models::conversation::ConversationTurn;

/// Prepare turns for IPC transfer: compute args summaries and strip
/// `transformed_user_message` (never displayed, saves ~10-20% payload).
///
/// PERF: Mutates in place to avoid cloning. Iterates all turns × tool calls.
/// Lock scope on TurnCache should be minimized — clone data, drop lock, then call this.
#[tracing::instrument(skip_all, fields(turn_count = turns.len()))]
pub fn prepare_turns_for_ipc(turns: &mut [ConversationTurn]) {
    for turn in turns.iter_mut() {
        turn.transformed_user_message = None;

        for tc in turn.tool_calls.iter_mut() {
            if tc.args_summary.is_none()
                && let Some(ref args) = tc.arguments
            {
                let summary = compute_args_summary(&tc.tool_name, args);
                if !summary.is_empty() {
                    tc.args_summary = Some(summary);
                }
            }
        }
    }
}
