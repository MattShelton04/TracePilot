//! Copilot SDK bridge — unified interface for SDK and CLI-spawn modes.
//!
//! When the `copilot-sdk` Cargo feature is enabled, the bridge connects to the
//! Copilot CLI via JSON-RPC (either stdio or TCP) for real-time event streaming,
//! session steering, and quota monitoring. When disabled, the bridge degrades
//! gracefully and all SDK operations return `BridgeError::NotAvailable`.

pub mod discovery;
pub mod manager;

use serde::{Deserialize, Serialize};

pub use discovery::{DetectedUiServer, detect_ui_servers};
pub use manager::BridgeManager;

// ─── Error Types ──────────────────────────────────────────────────

#[derive(Debug, thiserror::Error)]
pub enum BridgeError {
    #[error("Copilot SDK feature is not enabled")]
    NotAvailable,

    #[error("Not connected to Copilot CLI")]
    NotConnected,

    #[error("Session not found: {0}")]
    SessionNotFound(String),

    #[error("Already connected")]
    AlreadyConnected,

    #[error("Connection failed: {0}")]
    ConnectionFailed(String),

    #[error("SDK error: {0}")]
    Sdk(String),

    #[error("Timeout: {0}")]
    Timeout(String),
}

// ─── Connection State ─────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BridgeConnectionState {
    Disconnected,
    Connecting,
    Connected,
    Error,
}

impl Default for BridgeConnectionState {
    fn default() -> Self {
        Self::Disconnected
    }
}

// ─── Session Mode ─────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BridgeSessionMode {
    Interactive,
    Plan,
    Autopilot,
}

// ─── Event Types ──────────────────────────────────────────────────

/// Serializable bridge event forwarded from the SDK to the frontend via Tauri.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeEvent {
    pub session_id: String,
    pub event_type: String,
    pub timestamp: String,
    pub id: Option<String>,
    pub parent_id: Option<String>,
    pub ephemeral: bool,
    pub data: serde_json::Value,
}

// ─── Status / Info Types ──────────────────────────────────────────

/// How the bridge is connected to the Copilot CLI.
///
/// Introduced in wave 79 of the tech-debt effort (see
/// `docs/tech-debt-master-plan-2026-04.md` Phase 10 / w79) to replace the
/// previous stringly-typed `Option<String>` carrying magic `"stdio"` / `"tcp"`
/// values. Serialisation is kebab-case so the wire format is byte-for-byte
/// identical to the pre-enum representation — frontends continue to receive
/// `"stdio"` or `"tcp"` as a JSON string (nested in `Option`).
///
/// A `#[serde(alias)]` keeps the hyphenated legacy spelling `"std-io"`
/// tolerated (unused today, defensive against external callers). The
/// richer `Tcp { url: String }` variant envisaged in the plan is deferred
/// to a future wave to avoid any IPC-shape churn.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ConnectionMode {
    Stdio,
    Tcp,
}

impl ConnectionMode {
    /// Stable wire string (kept as a helper for log lines and raw comparisons).
    pub const fn as_str(self) -> &'static str {
        match self {
            ConnectionMode::Stdio => "stdio",
            ConnectionMode::Tcp => "tcp",
        }
    }
}

impl std::fmt::Display for ConnectionMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeStatus {
    pub state: BridgeConnectionState,
    pub sdk_available: bool,
    pub cli_version: Option<String>,
    pub protocol_version: Option<u32>,
    pub active_sessions: usize,
    pub error: Option<String>,
    /// [`ConnectionMode::Stdio`] when the SDK spawns a private CLI subprocess,
    /// [`ConnectionMode::Tcp`] when connected to an existing
    /// `copilot --ui-server` via `cli_url`.
    pub connection_mode: Option<ConnectionMode>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeAuthStatus {
    pub is_authenticated: bool,
    pub auth_type: Option<String>,
    pub host: Option<String>,
    pub login: Option<String>,
    pub status_message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeQuotaSnapshot {
    pub quota_type: String,
    pub limit: Option<u64>,
    pub used: Option<u64>,
    pub remaining: Option<u64>,
    pub resets_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeQuota {
    pub quotas: Vec<BridgeQuotaSnapshot>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeSessionInfo {
    pub session_id: String,
    pub model: Option<String>,
    pub working_directory: Option<String>,
    pub mode: Option<BridgeSessionMode>,
    pub is_active: bool,
    /// If the SDK could not resume this session, the reason is stored here.
    /// Common reasons: schema validation failure (CLI version mismatch),
    /// session is currently running in another process, etc.
    pub resume_error: Option<String>,
    /// Whether the session was flagged as "remote" by the CLI (i.e. running
    /// via `--ui-server` or started by another client).
    pub is_remote: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeModelInfo {
    pub id: String,
    pub name: Option<String>,
}

// ─── Configuration ────────────────────────────────────────────────

/// Configuration for establishing an SDK bridge connection.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeConnectConfig {
    /// If set, connect to an existing `copilot --ui-server` at this URL.
    /// Mutually exclusive with stdio mode (which spawns a new CLI process).
    pub cli_url: Option<String>,
    /// Working directory for the CLI process.
    pub cwd: Option<String>,
    /// Log level for SDK diagnostics.
    pub log_level: Option<String>,
    /// GitHub token override (normally uses logged-in user).
    pub github_token: Option<String>,
}

/// Configuration for creating a new SDK session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeSessionConfig {
    pub model: Option<String>,
    pub working_directory: Option<String>,
    pub system_message: Option<String>,
    pub reasoning_effort: Option<String>,
    pub agent: Option<String>,
}

/// Message payload sent to a session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeMessagePayload {
    pub prompt: String,
    pub mode: Option<String>,
}

/// An attachment to include with a steering message (future use — image support).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BridgeAttachment {
    #[serde(rename = "type")]
    pub kind: String,
    pub data: String,
    pub mime_type: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bridge_status_serialises() {
        let status = BridgeStatus {
            state: BridgeConnectionState::Connected,
            sdk_available: true,
            cli_version: Some("1.0.24".into()),
            protocol_version: Some(1),
            active_sessions: 2,
            error: None,
            connection_mode: Some(ConnectionMode::Stdio),
        };
        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("connected"));
        assert!(json.contains("sdkAvailable"));
        // Wire format must remain a bare "stdio" string for FE compat.
        assert!(
            json.contains(r#""connectionMode":"stdio""#),
            "expected unchanged wire format, got: {json}"
        );
    }

    #[test]
    fn connection_mode_wire_format_is_stable() {
        assert_eq!(
            serde_json::to_string(&ConnectionMode::Stdio).unwrap(),
            r#""stdio""#
        );
        assert_eq!(
            serde_json::to_string(&ConnectionMode::Tcp).unwrap(),
            r#""tcp""#
        );
        assert_eq!(
            serde_json::from_str::<ConnectionMode>(r#""stdio""#).unwrap(),
            ConnectionMode::Stdio
        );
        assert_eq!(
            serde_json::from_str::<ConnectionMode>(r#""tcp""#).unwrap(),
            ConnectionMode::Tcp
        );
    }

    #[test]
    fn bridge_event_serialises() {
        let event = BridgeEvent {
            session_id: "abc-123".into(),
            event_type: "assistant.message".into(),
            timestamp: "2026-01-01T00:00:00Z".into(),
            id: Some("evt-1".into()),
            parent_id: None,
            ephemeral: false,
            data: serde_json::json!({"content": "Hello"}),
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("sessionId"));
        assert!(json.contains("eventType"));
    }

    #[test]
    fn connection_state_default_is_disconnected() {
        assert_eq!(
            BridgeConnectionState::default(),
            BridgeConnectionState::Disconnected
        );
    }
}
