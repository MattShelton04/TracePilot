//! Generic broadcast → Tauri-event forwarder.
//!
//! Centralises the pattern where a `tokio::sync::broadcast::Receiver<T>` is
//! drained in a background task and each message is re-emitted to the
//! frontend via [`tauri::AppHandle::emit`]. Prior to this helper, the
//! `setup` closure in `lib.rs` hand-rolled the same recv/emit/Lagged/Closed
//! state machine twice (SDK bridge events + SDK connection status).

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::broadcast::Receiver;
use tokio::sync::broadcast::error::RecvError;
use tracing::warn;

/// Forward every message from a broadcast channel to a Tauri frontend event.
///
/// - On `Ok(msg)`: emit as `event_name`; log a warning on emit failure.
/// - On `Lagged(n)`: log a warning reporting the skipped-frame count and
///   keep draining (matches the legacy `continue` behaviour, but surfaces
///   lag to diagnostics instead of silently dropping it).
/// - On `Closed`: terminate the loop — the sender side is gone.
pub(crate) async fn forward_broadcast<T>(
    mut rx: Receiver<T>,
    app: AppHandle,
    event_name: &'static str,
) where
    T: Serialize + Clone + Send + 'static,
{
    loop {
        match rx.recv().await {
            Ok(msg) => {
                if let Err(e) = app.emit(event_name, msg) {
                    warn!(
                        target: "tracepilot::bindings",
                        event = %event_name,
                        error = %e,
                        "failed to emit broadcast frame to frontend"
                    );
                }
            }
            Err(RecvError::Lagged(n)) => {
                warn!(
                    target: "tracepilot::bindings",
                    event = %event_name,
                    skipped = n,
                    "broadcast receiver lagged"
                );
            }
            Err(RecvError::Closed) => break,
        }
    }
}
