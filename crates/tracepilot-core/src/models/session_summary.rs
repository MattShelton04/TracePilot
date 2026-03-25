//! High-level session summary combining workspace.yaml + shutdown metrics.

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::models::event_types::{CodeChanges, ModelMetricDetail};

/// A fully derived session summary — the primary model for session lists.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    pub summary: Option<String>,
    pub repository: Option<String>,
    pub branch: Option<String>,
    pub cwd: Option<String>,
    pub host_type: Option<String>,
    pub created_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,

    // Derived from events
    pub event_count: Option<usize>,
    #[serde(default)]
    pub has_events: bool,
    #[serde(default)]
    pub has_session_db: bool,
    #[serde(default)]
    pub has_plan: bool,
    #[serde(default)]
    pub has_checkpoints: bool,
    pub checkpoint_count: Option<usize>,
    pub turn_count: Option<usize>,

    // From shutdown event (if available)
    pub shutdown_metrics: Option<ShutdownMetrics>,
}

/// Metrics extracted from `session.shutdown` events.
///
/// When a session is resumed, multiple shutdown events exist with per-instance
/// (not cumulative) metrics. All numeric fields here represent the **sum** across
/// all shutdown events. See `shutdown_count` for how many were combined.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShutdownMetrics {
    pub shutdown_type: Option<String>,
    pub total_premium_requests: Option<f64>,
    pub total_api_duration_ms: Option<u64>,
    pub session_start_time: Option<u64>,
    pub current_model: Option<String>,
    pub code_changes: Option<CodeChanges>,
    #[serde(default)]
    pub model_metrics: HashMap<String, ModelMetricDetail>,
    #[serde(default)]
    pub session_segments: Option<Vec<crate::models::event_types::SessionSegment>>,
    /// Number of shutdown events that were combined (>1 means resumed session).
    pub shutdown_count: Option<u32>,
}
