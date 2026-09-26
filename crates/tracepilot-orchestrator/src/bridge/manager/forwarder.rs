//! Per-session SDK event forwarder.
//!
//! One task per tracked session reads the SDK [`EventSubscription`], reduces
//! every event into the [`LiveStateStore`], and forwards it on the bridge
//! broadcast channel. Two things keep the IPC volume bounded while a live
//! turn streams (hundreds of deltas and ~3 cumulative tool-output snapshots per
//! second, see the live attach plan F6/F7):
//!
//! - **Snapshot coalescing.** High-frequency events (token deltas, partial tool
//!   output, usage ticks) update the reducer immediately, but the resulting
//!   [`SessionLiveState`](crate::bridge::SessionLiveState) snapshot is broadcast
//!   at most once per [`STATE_EMIT_INTERVAL`], with a trailing emit so the
//!   final state is never lost. Every other event emits immediately.
//! - **Diagnostic payload trimming.** `model.*` and `system.message` events
//!   carry full prompts, message snapshots, and billing metadata. The reducer
//!   ignores them and the renderer only needs their type, so their `data` is
//!   replaced before it crosses IPC.

use crate::bridge::BridgeEvent;
use crate::bridge::live_state::{LiveStateStore, SessionLiveState, SessionRuntimeStatus};
use crate::bridge::manager::BridgeMetrics;
use github_copilot_sdk::subscription::{EventSubscription, RecvErrorKind};
use serde_json::json;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::Duration;
use tokio::sync::broadcast;
use tokio::time::Instant;
use tracing::{debug, warn};

/// Minimum spacing between coalesced live-state snapshots (≤ 20/s/session).
pub(crate) const STATE_EMIT_INTERVAL: Duration = Duration::from_millis(50);

/// Error recorded on the live state when the event stream ends on its own
/// (the hosting terminal exited or the connection dropped).
pub(crate) const STREAM_CLOSED_MESSAGE: &str = "Live connection closed";

pub(super) struct ForwarderChannels {
    pub event_tx: broadcast::Sender<BridgeEvent>,
    pub state_tx: broadcast::Sender<SessionLiveState>,
    pub live_state: Arc<LiveStateStore>,
    pub metrics: Arc<BridgeMetrics>,
}

/// Events whose snapshot can be coalesced: they arrive in bursts and only
/// grow text or tool output that the next snapshot will carry anyway.
pub(crate) fn is_high_frequency(event_type: &str) -> bool {
    event_type.ends_with("_delta")
        || matches!(
            event_type,
            "tool.execution_partial_result"
                | "tool.execution_progress"
                | "session.usage_info"
                | "assistant.usage"
                | "pending_messages.modified"
        )
}

/// Diagnostic events whose payload is replaced before IPC.
pub(crate) fn is_bulky_diagnostic(event_type: &str) -> bool {
    event_type.starts_with("model.") || event_type == "system.message"
}

pub(super) async fn run(
    session_id: String,
    mut events: EventSubscription,
    channels: ForwarderChannels,
) {
    let mut last_emit: Option<Instant> = None;
    let mut pending: Option<SessionLiveState> = None;

    loop {
        let flush_at = pending
            .as_ref()
            .and(last_emit)
            .map(|at| at + STATE_EMIT_INTERVAL);
        let received = tokio::select! {
            received = events.recv() => received,
            () = sleep_until_opt(flush_at) => {
                if let Some(state) = pending.take() {
                    emit_state(&channels, state, &session_id);
                    last_emit = Some(Instant::now());
                }
                continue;
            }
        };

        match received {
            Ok(event) => {
                let mut bridge_event = BridgeEvent {
                    session_id: session_id.clone(),
                    event_type: event.event_type,
                    timestamp: event.timestamp,
                    id: Some(event.id),
                    parent_id: event.parent_id,
                    ephemeral: event.ephemeral.unwrap_or(false),
                    data: event.data,
                };
                let state = channels.live_state.apply_event(&bridge_event);
                let throttled = is_high_frequency(&bridge_event.event_type)
                    && last_emit.is_some_and(|at| at.elapsed() < STATE_EMIT_INTERVAL);
                if throttled {
                    pending = Some(state);
                } else {
                    pending = None;
                    emit_state(&channels, state, &session_id);
                    last_emit = Some(Instant::now());
                }

                if is_bulky_diagnostic(&bridge_event.event_type) {
                    bridge_event.data = json!({ "omitted": true });
                }
                if channels.event_tx.send(bridge_event).is_ok() {
                    channels
                        .metrics
                        .events_forwarded
                        .fetch_add(1, Ordering::Relaxed);
                } else {
                    debug!("No bridge event receivers for {}", session_id);
                }
            }
            Err(e) => match e.kind() {
                RecvErrorKind::Lagged(lagged) => {
                    let n = lagged.skipped();
                    warn!(
                        "Bridge event receiver lagged by {} for session {}",
                        n, session_id
                    );
                    channels
                        .metrics
                        .events_dropped_due_to_lag
                        .fetch_add(n, Ordering::Relaxed);
                    channels
                        .metrics
                        .lag_occurrences
                        .fetch_add(1, Ordering::Relaxed);
                }
                // `Closed` and any future non-exhaustive kinds end the stream.
                other => {
                    debug!("SDK event stream for {} ended: {:?}", session_id, other);
                    if let Some(state) = pending.take() {
                        emit_state(&channels, state, &session_id);
                    }
                    if let Some(state) = channels.live_state.mark_existing(
                        &session_id,
                        SessionRuntimeStatus::Shutdown,
                        Some(STREAM_CLOSED_MESSAGE.to_string()),
                    ) {
                        emit_state(&channels, state, &session_id);
                    }
                    break;
                }
            },
        }
    }
}

fn emit_state(channels: &ForwarderChannels, state: SessionLiveState, session_id: &str) {
    if channels.state_tx.send(state).is_err() {
        debug!("No SDK session-state receivers for {}", session_id);
    }
}

async fn sleep_until_opt(deadline: Option<Instant>) {
    match deadline {
        Some(at) => tokio::time::sleep_until(at).await,
        None => std::future::pending().await,
    }
}
