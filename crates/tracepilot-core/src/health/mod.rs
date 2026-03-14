//! Health scoring and anomaly detection for sessions.

use serde::{Deserialize, Serialize};

/// Health assessment for a session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionHealth {
    pub score: f64, // 0.0 (unhealthy) to 1.0 (healthy)
    pub flags: Vec<HealthFlag>,
}

/// Individual health flag / anomaly.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthFlag {
    pub severity: HealthSeverity,
    pub category: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HealthSeverity {
    Info,
    Warning,
    Error,
}

/// Compute health for a session based on available metrics.
pub fn compute_health(
    event_count: Option<usize>,
    _shutdown_metrics: Option<&crate::models::session_summary::ShutdownMetrics>,
) -> SessionHealth {
    let mut flags = Vec::new();

    if let Some(count) = event_count
        && count > 5000
    {
        flags.push(HealthFlag {
            severity: HealthSeverity::Warning,
            category: "size".to_string(),
            message: format!("Large session with {} events", count),
        });
    }

    // TODO: Add more heuristics (high error rate, missing shutdown, token anomalies)

    let score = if flags.is_empty() {
        1.0
    } else {
        let deductions: f64 = flags
            .iter()
            .map(|f| match f.severity {
                HealthSeverity::Info => 0.0,
                HealthSeverity::Warning => 0.15,
                HealthSeverity::Error => 0.35,
            })
            .sum();
        (1.0 - deductions).max(0.0)
    };

    SessionHealth { score, flags }
}
