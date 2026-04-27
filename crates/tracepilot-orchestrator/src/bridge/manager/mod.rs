//! BridgeManager — owns the Copilot SDK client lifecycle and forwards events.
//!
//! The Copilot SDK is always compiled in (see ADR-0007). Bridge start paths
//! (`connect`, `create_session`, fresh `resume_session`) are gated at runtime
//! by the `FeaturesConfig.copilot_sdk` user preference, read via the optional
//! [`CopilotSdkEnabledReader`] injected through [`BridgeManager::set_preference_reader`].
//! When the preference is off, those methods return
//! [`BridgeError::DisabledByPreference`] instead of touching the SDK.
//!
//! This module was split into a directory module in Wave 44 of the tech-debt
//! effort (see `docs/tech-debt-plan-revised-2026-04.md` §3). The struct
//! definition, constructor, and small accessor/helper methods live here;
//! lifecycle, session steering, client queries, raw JSON-RPC framing, and
//! the `--ui-server` helpers are each in their own submodule. Every submodule
//! contributes an `impl BridgeManager` block so the public API remains a single
//! flat surface from the caller's point of view.

use super::{BridgeConnectionState, BridgeError, BridgeEvent, BridgeStatus, ConnectionMode};
use crate::bridge::registry::SessionRegistry;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::sync::{RwLock, broadcast};

mod lifecycle;
mod queries;
mod raw_rpc;
mod session_model;
mod session_tasks;
mod ui_server;

#[cfg(test)]
mod lifecycle_tests;
#[cfg(test)]
mod preference_tests;
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

/// Callable that reads the current `FeaturesConfig.copilot_sdk` runtime
/// preference. Injected into [`BridgeManager`] at plugin setup so the
/// manager can short-circuit start paths with [`BridgeError::DisabledByPreference`]
/// when the user toggle is off.
///
/// Left unset during unit tests (and in any non-Tauri consumer), in which
/// case [`BridgeManager::is_enabled_by_preference`] defaults to `true` —
/// i.e. the guard is a no-op. Real runtime callers MUST wire one up.
pub type CopilotSdkEnabledReader = Arc<dyn Fn() -> bool + Send + Sync>;

/// Manages the lifecycle of the Copilot SDK client connection.
pub struct BridgeManager {
    pub(super) state: BridgeConnectionState,
    pub(super) error_message: Option<String>,
    /// Tracks how we connected: stdio subprocess vs TCP `--ui-server`.
    pub(super) connection_mode: Option<ConnectionMode>,
    /// TCP server URL when in TCP mode — used for raw JSON-RPC calls
    /// that bypass the SDK (workaround for upstream method name bugs).
    pub(super) cli_url: Option<String>,
    /// Working directory used for the active connection. Stored to make
    /// renderer re-hydration reconnect attempts idempotent without retaining
    /// secrets such as GitHub tokens.
    pub(super) connection_cwd: Option<String>,
    pub(super) event_tx: broadcast::Sender<BridgeEvent>,
    pub(super) status_tx: broadcast::Sender<BridgeStatus>,
    pub(super) metrics: Arc<BridgeMetrics>,

    /// Runtime feature-preference reader. See [`CopilotSdkEnabledReader`].
    pub(super) pref_reader: Option<CopilotSdkEnabledReader>,

    pub(super) client: Option<copilot_sdk::Client>,
    pub(super) sessions: HashMap<String, Arc<copilot_sdk::Session>>,
    pub(super) event_tasks: HashMap<String, tokio::task::JoinHandle<()>>,
    pub(super) registry: Option<Arc<Mutex<SessionRegistry>>>,
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
            connection_cwd: None,
            event_tx: tx,
            status_tx,
            metrics: Arc::new(BridgeMetrics::default()),
            pref_reader: None,
            client: None,
            sessions: HashMap::new(),
            event_tasks: HashMap::new(),
            registry: None,
        };
        (manager, rx, status_rx)
    }

    /// Open or create the persistent SDK session registry.
    pub fn init_registry(&mut self, path: &Path) -> Result<(), BridgeError> {
        let registry = SessionRegistry::open_or_create(path)
            .map_err(|e| BridgeError::Registry(e.to_string()))?;
        self.registry = Some(Arc::new(Mutex::new(registry)));
        self.mark_stale_registry_sessions_unknown();
        Ok(())
    }

    /// Open the default registry path under the TracePilot Copilot home.
    pub fn init_default_registry(&mut self) -> Result<(), BridgeError> {
        let path =
            SessionRegistry::default_path().map_err(|e| BridgeError::Registry(e.to_string()))?;
        self.init_registry(&path)
    }

    #[cfg(test)]
    pub fn init_memory_registry(&mut self) -> Result<(), BridgeError> {
        let registry =
            SessionRegistry::in_memory().map_err(|e| BridgeError::Registry(e.to_string()))?;
        self.registry = Some(Arc::new(Mutex::new(registry)));
        Ok(())
    }

    /// Install the runtime preference reader. See [`CopilotSdkEnabledReader`].
    ///
    /// This is intended to be called once immediately after [`Self::new`], by
    /// the Tauri plugin setup. It replaces any previously-set reader.
    pub fn set_preference_reader(&mut self, reader: CopilotSdkEnabledReader) {
        self.pref_reader = Some(reader);
    }

    /// Current value of the runtime `FeaturesConfig.copilot_sdk` preference.
    ///
    /// Defaults to `true` when no reader has been installed (unit tests /
    /// non-Tauri consumers) so the existing happy-path behaviour is
    /// preserved. Real runtime callers install a reader in plugin setup.
    pub fn is_enabled_by_preference(&self) -> bool {
        match &self.pref_reader {
            Some(r) => r(),
            None => true,
        }
    }

    /// Short-circuit helper used by bridge start paths.
    pub(super) fn check_preference_enabled(&self) -> Result<(), BridgeError> {
        if self.is_enabled_by_preference() {
            Ok(())
        } else {
            Err(BridgeError::DisabledByPreference)
        }
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

    /// Whether the SDK is compiled into the binary. Always `true` since
    /// the Cargo feature was made always-on (ADR-0007); retained so the
    /// IPC wire contract `BridgeStatus.sdkAvailable` stays byte-stable.
    pub fn is_sdk_available(&self) -> bool {
        true
    }

    /// Snapshot of bridge status.
    pub fn status(&self) -> BridgeStatus {
        BridgeStatus {
            state: self.state,
            sdk_available: self.is_sdk_available(),
            enabled_by_preference: self.is_enabled_by_preference(),
            cli_version: None,
            protocol_version: None,
            active_sessions: self.sessions.len(),
            error: self.error_message.clone(),
            connection_mode: self.connection_mode,
        }
    }

    // ─── Internal Helpers ─────────────────────────────────────────

    /// Broadcast the current status to all status subscribers.
    pub(super) fn emit_status_change(&self) {
        // best-effort: broadcast tolerates zero subscribers.
        if self.status_tx.send(self.status()).is_err() {
            tracing::trace!("no status subscribers");
        }
    }

    pub(super) fn require_client(&self) -> Result<&copilot_sdk::Client, BridgeError> {
        self.client.as_ref().ok_or(BridgeError::NotConnected)
    }

    pub(super) fn require_session(
        &self,
        session_id: &str,
    ) -> Result<&Arc<copilot_sdk::Session>, BridgeError> {
        self.sessions
            .get(session_id)
            .ok_or_else(|| BridgeError::SessionNotFound(session_id.to_string()))
    }

    pub(super) fn with_registry<T>(
        &self,
        f: impl FnOnce(&SessionRegistry) -> crate::Result<T>,
    ) -> Result<Option<T>, BridgeError> {
        let Some(registry) = &self.registry else {
            return Ok(None);
        };
        let guard = registry
            .lock()
            .map_err(|_| BridgeError::Registry("SDK session registry mutex poisoned".into()))?;
        f(&guard)
            .map(Some)
            .map_err(|e| BridgeError::Registry(e.to_string()))
    }

    pub(super) fn mark_stale_registry_sessions_unknown(&self) {
        let active = self.sessions.keys().cloned().collect();
        if let Err(err) = self.with_registry(|registry| registry.mark_unknown_except(&active)) {
            tracing::warn!(error = %err, "Failed to mark stale SDK registry sessions unknown");
        }
    }
}
