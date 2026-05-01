use std::collections::HashMap;

use super::super::SearchContentRow;

pub(super) struct ExtractionState {
    /// Track turn number matching the reconstructor's turnIndex (0-based).
    /// The reconstructor creates new turns on: UserMessage (always), and
    /// ensure_current_turn (when current_turn is None after TurnEnd/Abort).
    pub(super) current_turn: i64,
    pub(super) turn_is_open: bool,
    /// Map tool_call_id → (tool_name, turn_number) for carrying to completion events.
    pub(super) tool_info: HashMap<String, (String, i64)>,
    /// Session-level rows emitted between turns, flushed into the next turn.
    pub(super) pending_session_rows: Vec<SearchContentRow>,
}

impl ExtractionState {
    pub(super) fn new() -> Self {
        Self {
            current_turn: -1,
            turn_is_open: false,
            tool_info: HashMap::new(),
            pending_session_rows: Vec::new(),
        }
    }

    /// Open a new turn if none is currently open (mirrors `ensure_current_turn`).
    /// Returns true if a new turn was opened.
    #[inline]
    pub(super) fn ensure_turn(&mut self) -> bool {
        if !self.turn_is_open {
            self.current_turn += 1;
            self.turn_is_open = true;
            true
        } else {
            false
        }
    }

    /// Flush buffered session-level rows, assigning them to the current turn.
    #[inline]
    pub(super) fn flush_pending(&mut self, rows: &mut Vec<SearchContentRow>) {
        for mut row in self.pending_session_rows.drain(..) {
            row.turn_number = Some(self.current_turn);
            rows.push(row);
        }
    }

    /// Append any session rows still pending; they keep turn_number: None.
    #[inline]
    pub(super) fn finish(&mut self, rows: &mut Vec<SearchContentRow>) {
        rows.append(&mut self.pending_session_rows);
    }
}
