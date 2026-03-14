//! High-level session summary combining workspace.yaml + shutdown metrics.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// A fully derived session summary — the primary model for session lists.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionSummary {
    pub id: String,
    pub summary: Option<String>,
    pub repository: Option<String>,
    pub branch: Option<String>,
    pub cwd: Option<String>,
    pub created_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,

    // Derived from events
    pub event_count: Option<usize>,
    pub has_events: bool,
    pub has_session_db: bool,

    // From shutdown event (if available)
    pub shutdown_metrics: Option<ShutdownMetrics>,
}

/// Metrics extracted from `session.shutdown` events.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShutdownMetrics {
    pub total_premium_requests: Option<u64>,
    pub total_api_duration_ms: Option<u64>,
    pub lines_added: Option<u64>,
    pub lines_removed: Option<u64>,
    pub files_modified: Vec<String>,
    pub model_metrics: Vec<ModelMetric>,
}

/// Per-model usage metrics from shutdown data.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelMetric {
    pub model: String,
    pub requests: Option<u64>,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
}
