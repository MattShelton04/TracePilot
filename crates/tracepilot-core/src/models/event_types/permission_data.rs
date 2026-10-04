//! Persisted permission payloads added in Copilot CLI 1.0.86–1.0.91.
//!
//! `session.permission_recovery` is the authoritative Autopilot recovery
//! snapshot. The `permission.*` authorization receipts are marked
//! experimental and "historical decode-only" in the schema: current runtimes
//! preserve them but no longer derive permission decisions from them.
//! Every field stays optional so older or partial producers still decode.

use serde::{Deserialize, Serialize};

/// `session.permission_recovery`: one snapshot of an Autopilot episode.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionPermissionRecoveryData {
    pub episode_id: Option<String>,
    /// `recovering`, `awaiting_approval`, `resolved` or `blocked`.
    pub status: Option<String>,
    /// `ask` or `fail` once autonomous recovery cannot continue.
    pub on_blocked: Option<String>,
    pub reason: Option<String>,
    pub max_attempts: Option<u64>,
    pub attempts: Option<Vec<PermissionRecoveryAttempt>>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionRecoveryAttempt {
    pub attempt_id: Option<String>,
    pub tool_call_id: Option<String>,
    pub permission_kind: Option<String>,
    /// SHA-256 of the normalized request; raw arguments are never recorded.
    pub request_fingerprint: Option<String>,
    /// `initial`, `retry` or `alternative`.
    pub relation: Option<String>,
    pub disposition: Option<String>,
    pub reason: Option<String>,
    pub ordinal: Option<u64>,
}

/// `permission.carriedForward`
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionCarriedForwardData {
    pub request_id: Option<String>,
    pub tool_call_id: Option<String>,
    pub record_id: Option<String>,
    pub decision_source: Option<String>,
}

/// `permission.messageAuthorization`
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionMessageAuthorizationData {
    pub record_id: Option<String>,
    pub turn_index: Option<u64>,
    /// `grant` or `denial`.
    pub polarity: Option<String>,
    pub action_class: Option<String>,
    pub span_start: Option<u64>,
    pub span_end: Option<u64>,
    pub target_members: Option<Vec<String>>,
    pub task: Option<String>,
    /// Opaque version discriminator (commands, file object, remote tip, ...).
    pub world: Option<serde_json::Value>,
}

/// `permission.messageAuthorizationRead`
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionMessageAuthorizationReadData {
    pub turn_index: Option<u64>,
    pub activates_extraction: Option<bool>,
}

/// `permission.messageAuthorizationDegraded`
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionMessageAuthorizationDegradedData {
    pub turn_index: Option<u64>,
}

/// `permission.assentDetected`
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionAssentDetectedData {
    pub request_id: Option<String>,
    pub turn_index: Option<u64>,
}

/// `permission.contextualAuthorization`
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionContextualAuthorizationData {
    pub record_id: Option<String>,
    pub request_id: Option<String>,
    pub turn_index: Option<u64>,
    pub polarity: Option<String>,
    pub span_start: Option<u64>,
    pub span_end: Option<u64>,
}
