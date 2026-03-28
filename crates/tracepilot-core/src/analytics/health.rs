use std::cmp::Ordering;
use std::collections::HashMap;

use crate::analytics::types::{
    AttentionSession, HealthFlagSeverity, HealthFlagSummary, HealthScoringData, SessionFlag,
    SessionHealthSnapshot,
};

/// Compute aggregate health scoring data from per-session snapshots.
pub fn compute_health_scoring(snapshots: &[SessionHealthSnapshot]) -> HealthScoringData {
    if snapshots.is_empty() {
        return HealthScoringData {
            overall_score: 0.0,
            healthy_count: 0,
            attention_count: 0,
            critical_count: 0,
            attention_sessions: Vec::new(),
            health_flags: Vec::new(),
        };
    }

    let mut total_score = 0.0;
    let mut healthy_count = 0;
    let mut attention_count = 0;
    let mut critical_count = 0;
    let mut attention_sessions: Vec<AttentionSession> = Vec::new();
    let mut flag_counts: HashMap<String, (u32, HealthFlagSeverity)> = HashMap::new();

    for snap in snapshots {
        total_score += snap.health_score;
        match snap.health_score {
            s if s >= 0.8 => healthy_count += 1,
            s if s >= 0.5 => attention_count += 1,
            _ => critical_count += 1,
        }

        let flags = derive_session_flags(snap);
        if snap.health_score < 0.8 {
            attention_sessions.push(AttentionSession {
                session_id: snap.session_id.clone(),
                session_name: snap
                    .session_name
                    .clone()
                    .unwrap_or_else(|| snap.session_id.clone()),
                score: snap.health_score,
                flags: flags.clone(),
            });
        }

        for flag in flags {
            let entry = flag_counts.entry(flag.name.clone()).or_insert((0, flag.severity));
            entry.0 += 1;
            entry.1 = entry.1.max(flag.severity);
        }
    }

    attention_sessions.sort_by(|a, b| {
        a.score
            .partial_cmp(&b.score)
            .unwrap_or(Ordering::Equal)
            .then_with(|| a.session_id.cmp(&b.session_id))
    });
    attention_sessions.truncate(20);

    let mut health_flags: Vec<HealthFlagSummary> = flag_counts
        .into_iter()
        .map(|(name, (count, severity))| HealthFlagSummary {
            name: name.clone(),
            count,
            severity,
            description: flag_description(&name).to_string(),
        })
        .collect();
    health_flags.sort_by(|a, b| {
        b.count
            .cmp(&a.count)
            .then_with(|| b.severity.cmp(&a.severity))
            .then_with(|| a.name.cmp(&b.name))
    });

    HealthScoringData {
        overall_score: total_score / snapshots.len() as f64,
        healthy_count,
        attention_count,
        critical_count,
        attention_sessions,
        health_flags,
    }
}

/// Derive session-level flags from stored counters and heuristics.
fn derive_session_flags(snap: &SessionHealthSnapshot) -> Vec<SessionFlag> {
    let mut flags = Vec::new();

    if let Some(count) = snap.rate_limit_count {
        if count > 0 {
            flags.push(SessionFlag {
                name: "Rate limits".to_string(),
                severity: if count >= 3 {
                    HealthFlagSeverity::Danger
                } else {
                    HealthFlagSeverity::Warning
                },
            });
        }
    }

    if let Some(err) = snap.error_count {
        let rate_limits = snap.rate_limit_count.unwrap_or(0);
        let non_rate_errors = err.saturating_sub(rate_limits);
        if non_rate_errors > 0 {
            flags.push(SessionFlag {
                name: "Tool errors".to_string(),
                severity: if non_rate_errors >= 5 {
                    HealthFlagSeverity::Danger
                } else {
                    HealthFlagSeverity::Warning
                },
            });
        }
    }

    if let Some(compactions) = snap.compaction_count {
        if compactions > 0 {
            flags.push(SessionFlag {
                name: "Compactions".to_string(),
                severity: if compactions >= 5 {
                    HealthFlagSeverity::Danger
                } else {
                    HealthFlagSeverity::Warning
                },
            });
        }
    }

    if let Some(truncations) = snap.truncation_count {
        if truncations > 0 {
            flags.push(SessionFlag {
                name: "Context truncation".to_string(),
                severity: if truncations >= 3 {
                    HealthFlagSeverity::Danger
                } else {
                    HealthFlagSeverity::Warning
                },
            });
        }
    }

    if let Some(events) = snap.event_count {
        if events >= 5_000 {
            flags.push(SessionFlag {
                name: "Large session".to_string(),
                severity: HealthFlagSeverity::Warning,
            });
        }
    }

    flags
}

fn flag_description(name: &str) -> &str {
    match name {
        "Rate limits" => "Session encountered API rate limits during execution.",
        "Tool errors" => "One or more tool calls failed during the session.",
        "Compactions" => "Context was compacted to stay within model limits.",
        "Context truncation" => "Session context was truncated due to length pressure.",
        "Large session" => "Session produced more than 5,000 events.",
        _ => "Session health issue detected.",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snap(
        id: &str,
        score: f64,
        event_count: Option<u64>,
        error_count: Option<u64>,
        rate_limit_count: Option<u64>,
        compaction_count: Option<u64>,
        truncation_count: Option<u64>,
    ) -> SessionHealthSnapshot {
        SessionHealthSnapshot {
            session_id: id.to_string(),
            session_name: Some(format!("Session {id}")),
            health_score: score,
            event_count,
            error_count,
            rate_limit_count,
            compaction_count,
            truncation_count,
        }
    }

    #[test]
    fn aggregates_distribution_and_flags() {
        let snapshots = vec![
            snap("a", 0.9, Some(100), Some(0), Some(0), Some(0), Some(0)),
            snap("b", 0.6, Some(6_000), Some(2), Some(2), Some(1), Some(0)),
            snap("c", 0.4, Some(200), Some(6), Some(3), Some(0), Some(3)),
        ];

        let result = compute_health_scoring(&snapshots);

        assert!((result.overall_score - 0.6333).abs() < 0.0001);
        assert_eq!(result.healthy_count, 1);
        assert_eq!(result.attention_count, 1);
        assert_eq!(result.critical_count, 1);

        // Attention sessions sorted by score ascending, capped to 20
        assert_eq!(result.attention_sessions.len(), 2);
        assert_eq!(result.attention_sessions[0].session_id, "c");
        assert_eq!(result.attention_sessions[1].session_id, "b");

        // Aggregated flags
        let flag_map: HashMap<_, _> = result
            .health_flags
            .iter()
            .map(|f| (f.name.as_str(), (f.count, f.severity)))
            .collect();
        assert_eq!(flag_map.get("Rate limits"), Some(&(2, HealthFlagSeverity::Danger)));
        assert_eq!(
            flag_map.get("Tool errors"),
            Some(&(1, HealthFlagSeverity::Warning))
        );
        assert_eq!(
            flag_map.get("Context truncation"),
            Some(&(1, HealthFlagSeverity::Danger))
        );
        assert_eq!(
            flag_map.get("Compactions"),
            Some(&(1, HealthFlagSeverity::Warning))
        );
        assert_eq!(
            flag_map.get("Large session"),
            Some(&(1, HealthFlagSeverity::Warning))
        );
    }

    #[test]
    fn handles_empty_input() {
        let result = compute_health_scoring(&[]);
        assert_eq!(result.overall_score, 0.0);
        assert!(result.attention_sessions.is_empty());
        assert!(result.health_flags.is_empty());
    }
}
