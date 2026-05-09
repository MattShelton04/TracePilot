//! Generic broadcast → Tauri-event forwarder.
//!
//! Centralises the pattern where a `tokio::sync::broadcast::Receiver<T>` is
//! drained in a background task and each message is re-emitted to the
//! frontend via [`tauri::AppHandle::emit`]. Prior to this helper, the
//! `setup` closure in `lib.rs` hand-rolled the same recv/emit/Lagged/Closed
//! state machine twice (SDK bridge events + SDK connection status).

use serde::Serialize;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::sync::broadcast::Receiver;
use tokio::sync::broadcast::error::RecvError;
use tracing::warn;

/// Minimum interval between successive `broadcast receiver lagged` warn
/// lines for the same forwarder. Prevents log spam when a slow consumer
/// produces a sustained burst of `RecvError::Lagged(n)` errors.
///
/// Counter callbacks (`on_lag`) still fire on every lag observation; only
/// the human-readable WARN line is debounced.
const LAG_WARN_DEBOUNCE: Duration = Duration::from_secs(5);

/// Forward every message from a broadcast channel to a Tauri frontend event.
///
/// - On `Ok(msg)`: emit as `event_name`; log a warning on emit failure.
/// - On `Lagged(n)`: invoke `on_lag(n)` (always), and log a debounced WARN
///   line reporting the skipped-frame count, then keep draining (matches
///   the legacy `continue` behaviour, but surfaces lag to metrics + the
///   diagnostics panel instead of silently dropping it).
/// - On `Closed`: terminate the loop — the sender side is gone.
///
/// Pass `|_| {}` for `on_lag` if you do not need to record lag in metrics.
pub(crate) async fn forward_broadcast<T, F>(
    mut rx: Receiver<T>,
    app: AppHandle,
    event_name: &'static str,
    mut on_lag: F,
) where
    T: Serialize + Clone + Send + 'static,
    F: FnMut(u64) + Send + 'static,
{
    let mut last_warn: Option<Instant> = None;
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
                on_lag(n);
                let now = Instant::now();
                let should_warn = last_warn
                    .map(|prev| now.duration_since(prev) >= LAG_WARN_DEBOUNCE)
                    .unwrap_or(true);
                if should_warn {
                    last_warn = Some(now);
                    warn!(
                        target: "tracepilot::bindings",
                        event = %event_name,
                        skipped = n,
                        "broadcast receiver lagged"
                    );
                }
            }
            Err(RecvError::Closed) => break,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::LAG_WARN_DEBOUNCE;

    #[test]
    fn lag_warn_debounce_is_at_least_one_second() {
        // Sanity: the debounce must be long enough that a sustained burst
        // of Lagged errors doesn't spam logs every loop iteration, but
        // short enough that operators still see it within a minute.
        assert!(LAG_WARN_DEBOUNCE.as_secs() >= 1);
        assert!(LAG_WARN_DEBOUNCE.as_secs() <= 60);
    }
}
