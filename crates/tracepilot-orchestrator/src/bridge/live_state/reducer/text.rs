use super::super::{PendingDelta, SessionLiveState, SessionRuntimeStatus};
use super::shared::{
    MAX_TEXT_PREVIEW_CHARS, append_capped, drain_to_tail, event_text_field, string_field, turn_id,
};
use crate::bridge::BridgeEvent;

// Reorder window for delta events. Pinned Copilot SDK `tokio::spawn`s a fresh
// task per notification so adjacent deltas can race into `event_tx.send` in
// non-source order. Mirror the frontend `DELTA_REORDER_WINDOW`.
const DELTA_REORDER_WINDOW: usize = 4;

pub(super) enum TextKind {
    Assistant,
    Reasoning,
}

/// Apply an `assistant.message_delta` / `assistant.reasoning_delta` event by
/// inserting its delta payload into a small reorder buffer keyed by
/// `event.timestamp`, then committing entries that drop out of the window.
/// The visible `*_text` is recomputed as `committed + pending sorted joined`.
pub(super) fn append_delta(state: &mut SessionLiveState, event: &BridgeEvent, kind: TextKind) {
    state.status = SessionRuntimeStatus::Running;
    if !belongs_to_active_turn(state, event) {
        return;
    }
    let finalized = match kind {
        TextKind::Assistant => state.assistant_finalized,
        TextKind::Reasoning => state.reasoning_finalized,
    };
    if finalized {
        // Final event already drained + snap-replaced this stream. A late
        // delta would re-corrupt the canonical text — drop it.
        return;
    }
    let Some(delta) = event_text_field(
        &event.data,
        &[
            "deltaContent",
            "delta_content",
            "chunkContent",
            "chunk_content",
            "delta",
        ],
    ) else {
        return;
    };
    let incoming = PendingDelta {
        delta,
        timestamp: event.timestamp.clone(),
    };
    let (committed, pending, visible) = match kind {
        TextKind::Assistant => (
            &mut state.assistant_committed,
            &mut state.assistant_pending,
            &mut state.assistant_text,
        ),
        TextKind::Reasoning => (
            &mut state.reasoning_committed,
            &mut state.reasoning_pending,
            &mut state.reasoning_text,
        ),
    };
    insert_pending_sorted(pending, incoming);
    while pending.len() > DELTA_REORDER_WINDOW {
        let drained = pending.remove(0);
        append_capped(committed, &drained.delta);
    }
    rebuild_visible(committed, pending, visible);
}

pub(super) fn insert_pending_sorted(pending: &mut Vec<PendingDelta>, incoming: PendingDelta) {
    // Stable insertion in ascending timestamp order.
    let pos = pending
        .iter()
        .position(|p| incoming.timestamp < p.timestamp)
        .unwrap_or(pending.len());
    pending.insert(pos, incoming);
}

pub(super) fn rebuild_visible(committed: &str, pending: &[PendingDelta], visible: &mut String) {
    visible.clear();
    visible.push_str(committed);
    for p in pending {
        visible.push_str(&p.delta);
    }
    drain_to_tail(visible, MAX_TEXT_PREVIEW_CHARS);
}

/// Apply a final `assistant.message` / `assistant.reasoning` event. Drains the
/// reorder buffer into `committed`, then snap-replaces if the canonical
/// `content` is longer than what we accumulated (covers tail garble).
pub(super) fn apply_full_text(state: &mut SessionLiveState, event: &BridgeEvent, kind: TextKind) {
    state.status = SessionRuntimeStatus::Running;
    if !belongs_to_active_turn(state, event) {
        return;
    }
    let Some(content) = event_text_field(
        &event.data,
        &[
            "content",
            "chunkContent",
            "chunk_content",
            "text",
            "message",
            "value",
        ],
    ) else {
        return;
    };
    let (committed, pending, visible) = match kind {
        TextKind::Assistant => (
            &mut state.assistant_committed,
            &mut state.assistant_pending,
            &mut state.assistant_text,
        ),
        TextKind::Reasoning => (
            &mut state.reasoning_committed,
            &mut state.reasoning_pending,
            &mut state.reasoning_text,
        ),
    };
    // Drain pending into committed.
    for p in pending.drain(..) {
        append_capped(committed, &p.delta);
    }
    // Snap-replace if the final content is longer (in chars).
    if content.chars().count() > committed.chars().count() {
        committed.clear();
        append_capped(committed, &content);
    }
    rebuild_visible(committed, pending, visible);
    // Mark this stream finalized so any straggler delta arriving after the
    // canonical text is dropped instead of re-corrupting it.
    match kind {
        TextKind::Assistant => state.assistant_finalized = true,
        TextKind::Reasoning => state.reasoning_finalized = true,
    }
}

/// Returns true if `event` belongs to the currently active turn (or no active
/// turn has been observed yet, in which case we accept everything to remain
/// permissive on connection-attach / reattach paths).
pub(super) fn belongs_to_active_turn(state: &SessionLiveState, event: &BridgeEvent) -> bool {
    let Some(active) = state.current_turn_id.as_deref() else {
        return true;
    };
    let event_turn = turn_id(event);
    match event_turn.as_deref() {
        Some(t) => t == active,
        // Event has no parent/turn id of its own — accept it on the active
        // turn (deltas/finals without parentId can't be cross-turn anyway).
        None => true,
    }
}

pub(super) fn start_turn(state: &mut SessionLiveState, event: &BridgeEvent) {
    state.status = SessionRuntimeStatus::Running;
    state.current_turn_id = turn_id(event);
    state.assistant_text.clear();
    state.reasoning_text.clear();
    state.assistant_committed.clear();
    state.reasoning_committed.clear();
    state.assistant_pending.clear();
    state.reasoning_pending.clear();
    state.assistant_finalized = false;
    state.reasoning_finalized = false;
    state.tools.clear();
    state.usage = None;
    state.pending_permission = None;
    state.pending_user_input = None;
    state.last_error = None;
    state.reducer_warnings.clear();
}

pub(super) fn record_error(state: &mut SessionLiveState, event: &BridgeEvent) {
    state.status = SessionRuntimeStatus::Error;
    state.last_error = Some(
        string_field(&event.data, &["message", "error", "details"])
            .unwrap_or_else(|| event.data.to_string()),
    );
}
