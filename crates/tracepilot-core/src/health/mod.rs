//! Health scoring and anomaly detection for sessions.
//!
//! The health module assigns each session a score between 0.0 (unhealthy) and 1.0
//! (healthy) based on observable heuristics: event count, shutdown presence,
//! unknown event types, and deserialization failures.
//!
//! Diagnostics from [`crate::parsing::diagnostics::ParseDiagnostics`] are consumed
//! here — they never cross the Tauri FFI boundary directly.

use serde::{Deserialize, Serialize};

use crate::parsing::diagnostics::ParseDiagnostics;

/// Number of events above which a session is considered "large".
const LARGE_SESSION_THRESHOLD: usize = 5000;

/// Fallback event ratio above which a parsing quality warning is raised.
const FALLBACK_RATIO_THRESHOLD: f64 = 0.1;

/// Health score deduction per Warning-level flag.
const WARNING_DEDUCTION: f64 = 0.15;

/// Health score deduction per Error-level flag.
const ERROR_DEDUCTION: f64 = 0.35;

/// Health assessment for a session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionHealth {
    /// Score from 0.0 (unhealthy) to 1.0 (healthy).
    pub score: f64,
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

/// Event-level incident counts for health scoring.
#[derive(Debug, Default)]
pub struct SessionIncidentCounts {
    pub error_count: usize,
    pub rate_limit_count: usize,
    pub warning_count: usize,
    pub compaction_count: usize,
    pub truncation_count: usize,
}

/// Compute health for a session based on available metrics and parse diagnostics.
///
/// # Heuristics
///
/// | Condition | Severity | Deduction |
/// |-----------|----------|-----------|
/// | > 5000 events | Warning | -0.15 |
/// | Missing shutdown | Info | -0.00 |
/// | Malformed JSONL lines | Warning | -0.15 |
/// | Unknown event types detected | Info | -0.00 |
/// | Deserialization failures | Warning | -0.15 |
/// | > 10% fallback events | Warning | -0.15 |
pub fn compute_health(
    event_count: Option<usize>,
    shutdown_metrics: Option<&crate::models::session_summary::ShutdownMetrics>,
    diagnostics: Option<&ParseDiagnostics>,
    incidents: Option<&SessionIncidentCounts>,
) -> SessionHealth {
    let mut flags = Vec::new();

    // Large session check
    if let Some(count) = event_count
        && count > LARGE_SESSION_THRESHOLD
    {
        flags.push(HealthFlag {
            severity: HealthSeverity::Warning,
            category: "size".to_string(),
            message: format!("Large session with {} events", count),
        });
    }

    // Missing shutdown — session may have crashed or is still active
    if shutdown_metrics.is_none() {
        flags.push(HealthFlag {
            severity: HealthSeverity::Info,
            category: "lifecycle".to_string(),
            message: "No shutdown event recorded — session may have crashed or is still active"
                .to_string(),
        });
    }

    // Diagnostics-based heuristics
    if let Some(diag) = diagnostics {
        if diag.malformed_lines > 0 {
            flags.push(HealthFlag {
                severity: HealthSeverity::Warning,
                category: "parsing".to_string(),
                message: format!(
                    "{} malformed JSONL line(s) skipped — events may be missing",
                    diag.malformed_lines
                ),
            });
        }

        if !diag.unknown_event_types.is_empty() {
            let types: Vec<&String> = diag.unknown_event_types.keys().collect();
            flags.push(HealthFlag {
                severity: HealthSeverity::Info,
                category: "compatibility".to_string(),
                message: format!(
                    "Encountered {} unknown event type(s): {}",
                    types.len(),
                    types
                        .iter()
                        .take(5)
                        .map(|s| s.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                ),
            });
        }

        if !diag.deserialization_failures.is_empty() {
            let total_failures: usize = diag
                .deserialization_failures
                .values()
                .map(|f| f.count)
                .sum();
            flags.push(HealthFlag {
                severity: HealthSeverity::Warning,
                category: "parsing".to_string(),
                message: format!(
                    "{} deserialization failure(s) across {} event type(s)",
                    total_failures,
                    diag.deserialization_failures.len()
                ),
            });
        }

        // High fallback ratio (> 10% of events degraded to Other)
        if diag.total_events > 0 {
            let fallback_ratio = diag.fallback_events as f64 / diag.total_events as f64;
            if fallback_ratio > FALLBACK_RATIO_THRESHOLD {
                flags.push(HealthFlag {
                    severity: HealthSeverity::Warning,
                    category: "parsing".to_string(),
                    message: format!(
                        "{:.0}% of events fell back to untyped parsing ({}/{})",
                        fallback_ratio * 100.0,
                        diag.fallback_events,
                        diag.total_events,
                    ),
                });
            }
        }
    }

    // Incident-based heuristics
    if let Some(inc) = incidents {
        if inc.rate_limit_count > 0 {
            let severity = if inc.rate_limit_count >= 3 {
                HealthSeverity::Error
            } else {
                HealthSeverity::Warning
            };
            flags.push(HealthFlag {
                severity,
                category: "rate_limit".to_string(),
                message: format!(
                    "{} rate limit error(s) during session",
                    inc.rate_limit_count
                ),
            });
        }
        if inc.error_count > inc.rate_limit_count {
            let other_errors = inc.error_count - inc.rate_limit_count;
            flags.push(HealthFlag {
                severity: HealthSeverity::Warning,
                category: "errors".to_string(),
                message: format!("{} non-rate-limit error(s) during session", other_errors),
            });
        }
        if inc.truncation_count >= 3 {
            flags.push(HealthFlag {
                severity: HealthSeverity::Warning,
                category: "context_pressure".to_string(),
                message: format!(
                    "{} context truncation(s) — high context window pressure",
                    inc.truncation_count
                ),
            });
        }
    }

    let score = if flags.is_empty() {
        1.0
    } else {
        let deductions: f64 = flags
            .iter()
            .map(|f| match f.severity {
                HealthSeverity::Info => 0.0,
                HealthSeverity::Warning => WARNING_DEDUCTION,
                HealthSeverity::Error => ERROR_DEDUCTION,
            })
            .sum();
        (1.0 - deductions).max(0.0)
    };

    SessionHealth { score, flags }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parsing::diagnostics::{DeserFailureInfo, ParseDiagnostics};
    use std::collections::HashMap;

    #[test]
    fn healthy_session_scores_1() {
        let health = compute_health(Some(100), Some(&Default::default()), None, None);
        assert_eq!(health.score, 1.0);
        assert!(health.flags.is_empty());
    }

    #[test]
    fn large_session_gets_warning() {
        let health = compute_health(Some(6000), Some(&Default::default()), None, None);
        assert!(health.score < 1.0);
        assert!(health.flags.iter().any(|f| f.category == "size"));
    }

    #[test]
    fn missing_shutdown_info_flag() {
        let health = compute_health(Some(10), None, None, None);
        assert!(health.flags.iter().any(|f| f.category == "lifecycle"));
        // Info flags don't deduct score
        assert_eq!(health.score, 1.0);
    }

    #[test]
    fn unknown_events_info_flag() {
        let mut unknown = HashMap::new();
        unknown.insert("fancy.new_event".to_string(), 3usize);
        let diag = ParseDiagnostics {
            total_events: 100,
            typed_events: 97,
            fallback_events: 3,
            unknown_event_types: unknown,
            ..Default::default()
        };
        let health = compute_health(Some(100), Some(&Default::default()), Some(&diag), None);
        assert!(health.flags.iter().any(|f| f.category == "compatibility"));
    }

    #[test]
    fn deser_failures_warning() {
        let mut failures = HashMap::new();
        failures.insert(
            "user.message".to_string(),
            DeserFailureInfo {
                count: 5,
                first_error: "missing field 'content'".to_string(),
            },
        );
        let diag = ParseDiagnostics {
            total_events: 100,
            typed_events: 95,
            fallback_events: 5,
            deserialization_failures: failures,
            ..Default::default()
        };
        let health = compute_health(Some(100), Some(&Default::default()), Some(&diag), None);
        assert!(health.score < 1.0);
        assert!(health.flags.iter().any(|f| f.category == "parsing"));
    }

    #[test]
    fn high_fallback_ratio_warning() {
        let diag = ParseDiagnostics {
            total_events: 100,
            typed_events: 80,
            fallback_events: 20,
            ..Default::default()
        };
        let health = compute_health(Some(100), Some(&Default::default()), Some(&diag), None);
        assert!(health.flags.iter().any(|f| f.message.contains("fell back")));
    }

    #[test]
    fn malformed_lines_warning() {
        let diag = ParseDiagnostics {
            total_events: 50,
            malformed_lines: 3,
            ..Default::default()
        };
        let health = compute_health(Some(50), Some(&Default::default()), Some(&diag), None);
        assert!(health.score < 1.0);
        assert!(health.flags.iter().any(|f| f.message.contains("malformed")));
    }

    #[test]
    fn rate_limit_warning() {
        let inc = SessionIncidentCounts {
            rate_limit_count: 1,
            error_count: 1,
            ..Default::default()
        };
        let health = compute_health(Some(100), Some(&Default::default()), None, Some(&inc));
        assert!(health.score < 1.0);
        assert!(health.flags.iter().any(|f| f.category == "rate_limit"));
    }

    #[test]
    fn severe_rate_limits_error() {
        let inc = SessionIncidentCounts {
            rate_limit_count: 5,
            error_count: 5,
            ..Default::default()
        };
        let health = compute_health(Some(100), Some(&Default::default()), None, Some(&inc));
        assert!(
            health
                .flags
                .iter()
                .any(|f| matches!(f.severity, HealthSeverity::Error))
        );
    }

    #[test]
    fn truncation_pressure_warning() {
        let inc = SessionIncidentCounts {
            truncation_count: 4,
            ..Default::default()
        };
        let health = compute_health(Some(100), Some(&Default::default()), None, Some(&inc));
        assert!(
            health
                .flags
                .iter()
                .any(|f| f.category == "context_pressure")
        );
    }

    #[test]
    fn no_incidents_no_flags() {
        let inc = SessionIncidentCounts::default();
        let health = compute_health(Some(100), Some(&Default::default()), None, Some(&inc));
        assert_eq!(health.score, 1.0);
    }
}
