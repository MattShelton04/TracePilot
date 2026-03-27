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

impl SessionSummary {
    /// Returns the UTC date key (`YYYY-MM-DD`) for this session.
    ///
    /// Prefers `updated_at`; falls back to `created_at`. Returns `None`
    /// when neither timestamp is available.
    pub fn date_key(&self) -> Option<String> {
        self.updated_at
            .or(self.created_at)
            .map(|dt| dt.format("%Y-%m-%d").to_string())
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{TimeZone, Utc};

    fn make_summary(
        updated: Option<&str>,
        created: Option<&str>,
    ) -> SessionSummary {
        let parse = |s: &str| {
            let dt = chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d")
                .unwrap()
                .and_hms_opt(12, 0, 0)
                .unwrap();
            Utc.from_utc_datetime(&dt)
        };

        SessionSummary {
            id: "test".to_string(),
            summary: None,
            repository: None,
            branch: None,
            cwd: None,
            host_type: None,
            created_at: created.map(parse),
            updated_at: updated.map(parse),
            event_count: None,
            has_events: false,
            has_session_db: false,
            has_plan: false,
            has_checkpoints: false,
            checkpoint_count: None,
            turn_count: None,
            shutdown_metrics: None,
        }
    }

    #[test]
    fn date_key_prefers_updated_at() {
        let s = make_summary(Some("2026-03-20"), Some("2026-03-15"));
        assert_eq!(s.date_key(), Some("2026-03-20".to_string()));
    }

    #[test]
    fn date_key_falls_back_to_created_at() {
        let s = make_summary(None, Some("2026-03-15"));
        assert_eq!(s.date_key(), Some("2026-03-15".to_string()));
    }

    #[test]
    fn date_key_returns_none_when_both_absent() {
        let s = make_summary(None, None);
        assert_eq!(s.date_key(), None);
    }
}
