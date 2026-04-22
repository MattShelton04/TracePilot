//! BridgeManager — owns the Copilot SDK client lifecycle and forwards events.
//!
//! All SDK-specific code is behind `#[cfg(feature = "copilot-sdk")]`. When the
//! feature is disabled every operation returns `BridgeError::NotAvailable`.
//!
//! This module was split into a directory module in Wave 44 of the tech-debt
//! effort (see `docs/tech-debt-plan-revised-2026-04.md` §3). The struct
//! definition, constructor, and small accessor/helper methods live here;
//! lifecycle, session steering, client queries, raw JSON-RPC framing, and
//! the `--ui-server` helpers are each in their own submodule. Every submodule
//! contributes an `impl BridgeManager` block so the public API remains a single
//! flat surface from the caller's point of view.

#[cfg(feature = "copilot-sdk")]
use super::BridgeError;
use super::{BridgeConnectionState, BridgeEvent, BridgeStatus, ConnectionMode};
#[cfg(feature = "copilot-sdk")]
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::sync::{RwLock, broadcast};

mod lifecycle;
mod queries;
mod raw_rpc;
mod session_model;
mod session_tasks;
mod ui_server;

#[cfg(test)]
mod tests;

pub use ui_server::launch_ui_server;

/// Shared bridge manager type for Tauri state.
pub type SharedBridgeManager = Arc<RwLock<BridgeManager>>;

/// Cumulative metrics for the bridge broadcast channels.
///
/// All counters are monotonic and crash-safe (atomics, not locks). Exposed
/// as a snapshot via [`BridgeManager::metrics_snapshot`] so debug UI can
/// surface broadcast-channel lag without taking any lock on the manager.
///
/// See [`docs/tech-debt-plan-revised-2026-04.md`](../../../../docs/tech-debt-plan-revised-2026-04.md)
/// Phase 1A.6 — "Status broadcast channel sizing".
#[derive(Debug, Default)]
pub struct BridgeMetrics {
    /// Number of SDK events successfully forwarded onto the `BridgeEvent`
    /// broadcast channel.
    pub events_forwarded: AtomicU64,
    /// Cumulative count of *individual events* dropped because a broadcast
    /// receiver lagged. Incremented by `n` each time the forwarder observes
    /// `RecvError::Lagged(n)`.
    pub events_dropped_due_to_lag: AtomicU64,
    /// Number of distinct lag occurrences (independent of how many events
    /// each occurrence dropped). Useful for alerting on "lag is happening
    /// at all" vs "lag is huge".
    pub lag_occurrences: AtomicU64,
}

/// Plain-data snapshot of [`BridgeMetrics`] for IPC / logging.
///
/// Serialised in camelCase for frontend consumption (matches the rest of the
/// IPC DTOs; see `packages/types/src/sdk.ts::BridgeMetricsSnapshot`).
#[derive(Debug, Clone, Copy, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BridgeMetricsSnapshot {
    pub events_forwarded: u64,
    pub events_dropped_due_to_lag: u64,
    pub lag_occurrences: u64,
}

/// Manages the lifecycle of the Copilot SDK client connection.
pub struct BridgeManager {
    pub(super) state: BridgeConnectionState,
    pub(super) error_message: Option<String>,
    /// Tracks how we connected: stdio subprocess vs TCP `--ui-server`.
    pub(super) connection_mode: Option<ConnectionMode>,
    /// TCP server URL when in TCP mode — used for raw JSON-RPC calls
    /// that bypass the SDK (workaround for upstream method name bugs).
    pub(super) cli_url: Option<String>,
    pub(super) event_tx: broadcast::Sender<BridgeEvent>,
    pub(super) status_tx: broadcast::Sender<BridgeStatus>,
    pub(super) metrics: Arc<BridgeMetrics>,

    #[cfg(feature = "copilot-sdk")]
    pub(super) client: Option<copilot_sdk::Client>,
    #[cfg(feature = "copilot-sdk")]
    pub(super) sessions: HashMap<String, Arc<copilot_sdk::Session>>,
    #[cfg(feature = "copilot-sdk")]
    pub(super) event_tasks: HashMap<String, tokio::task::JoinHandle<()>>,
}

impl BridgeManager {
    /// Create a new bridge manager. Returns the manager, a broadcast receiver
    /// for bridge events, and a broadcast receiver for status changes
    /// (both typically forwarded to Tauri IPC events).
    pub fn new() -> (
        Self,
        broadcast::Receiver<BridgeEvent>,
        broadcast::Receiver<BridgeStatus>,
    ) {
        let (tx, rx) = broadcast::channel(512);
        // Sized to 256 (was 16): status updates are tiny struct values; a
        // slow subscriber under heavy reconnect activity used to hit
        // `RecvError::Lagged` well before any UI catch-up window.
        // See docs/tech-debt-plan-revised-2026-04.md Phase 1A.6.
        let (status_tx, status_rx) = broadcast::channel(256);
        let manager = Self {
            state: BridgeConnectionState::Disconnected,
            error_message: None,
            connection_mode: None,
            cli_url: None,
            event_tx: tx,
            status_tx,
            metrics: Arc::new(BridgeMetrics::default()),
            #[cfg(feature = "copilot-sdk")]
            client: None,
            #[cfg(feature = "copilot-sdk")]
            sessions: HashMap::new(),
            #[cfg(feature = "copilot-sdk")]
            event_tasks: HashMap::new(),
        };
        (manager, rx, status_rx)
    }

    /// Point-in-time snapshot of broadcast-channel metrics. Cheap (a few
    /// atomic loads) and takes no lock on the manager itself.
    pub fn metrics_snapshot(&self) -> BridgeMetricsSnapshot {
        BridgeMetricsSnapshot {
            events_forwarded: self.metrics.events_forwarded.load(Ordering::Relaxed),
            events_dropped_due_to_lag: self
                .metrics
                .events_dropped_due_to_lag
                .load(Ordering::Relaxed),
            lag_occurrences: self.metrics.lag_occurrences.load(Ordering::Relaxed),
        }
    }

    /// Subscribe to bridge events (additional receivers beyond the initial one).
    pub fn subscribe(&self) -> broadcast::Receiver<BridgeEvent> {
        self.event_tx.subscribe()
    }

    /// Subscribe to bridge status changes.
    pub fn subscribe_status(&self) -> broadcast::Receiver<BridgeStatus> {
        self.status_tx.subscribe()
    }

    /// Current connection state.
    pub fn connection_state(&self) -> BridgeConnectionState {
        self.state
    }

    /// Whether the SDK Cargo feature is compiled in.
    pub fn is_sdk_available(&self) -> bool {
        cfg!(feature = "copilot-sdk")
    }

    /// Snapshot of bridge status.
    pub fn status(&self) -> BridgeStatus {
        BridgeStatus {
            state: self.state,
            sdk_available: self.is_sdk_available(),
            cli_version: None,
            protocol_version: None,
            #[cfg(feature = "copilot-sdk")]
            active_sessions: self.sessions.len(),
            #[cfg(not(feature = "copilot-sdk"))]
            active_sessions: 0,
            error: self.error_message.clone(),
            connection_mode: self.connection_mode,
        }
    }

    // ─── Internal Helpers ─────────────────────────────────────────

    /// Broadcast the current status to all status subscribers.
    #[allow(dead_code)] // Used in feature-gated connect/disconnect paths
    pub(super) fn emit_status_change(&self) {
        let _ = self.status_tx.send(self.status());
    }

    #[cfg(feature = "copilot-sdk")]
    pub(super) fn require_client(&self) -> Result<&copilot_sdk::Client, BridgeError> {
        self.client.as_ref().ok_or(BridgeError::NotConnected)
    }

    #[cfg(feature = "copilot-sdk")]
    pub(super) fn require_session(
        &self,
        session_id: &str,
    ) -> Result<&Arc<copilot_sdk::Session>, BridgeError> {
        self.sessions
            .get(session_id)
            .ok_or_else(|| BridgeError::SessionNotFound(session_id.to_string()))
    }
}
