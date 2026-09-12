//! Observed, exclusive per-agent accounting from a persisted shutdown snapshot.

use super::event_types::{RequestMetrics, ShutdownTokenDetail, UsageMetrics};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentUsageSnapshot {
    pub timestamp: Option<DateTime<Utc>>,
    pub event_index: usize,
    pub agents: HashMap<String, AgentUsageEntry>,
    /// A malformed field was omitted without discarding other agents' metrics.
    pub has_invalid_fields: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentUsageEntry {
    pub agent_name: Option<String>,
    pub agent_display_name: Option<String>,
    pub total_api_duration_ms: Option<u64>,
    /// The schema allows JSON numbers, including decimal-encoded nano units.
    pub total_nano_aiu: Option<f64>,
    pub model_metrics: HashMap<String, AgentModelMetric>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentModelMetric {
    pub requests: Option<RequestMetrics>,
    pub usage: Option<UsageMetrics>,
    pub total_nano_aiu: Option<f64>,
    pub token_details: Option<HashMap<String, ShutdownTokenDetail>>,
}
