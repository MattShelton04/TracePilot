//! Session data loader for analytics aggregation.
//!
//! Provides two loading tiers:
//! - `load_session_summaries` — fast, loads only workspace.yaml (for analytics/code-impact)
//! - `load_full_sessions` — slower, also reconstructs turns (for tool analysis)

use std::path::Path;

use tracing::warn;

use crate::session::discovery::{discover_sessions, DiscoveredSession};
use crate::summary::load_session_summary;

use super::types::SessionAnalyticsInput;

/// Load session summaries only (no turn reconstruction).
///
/// Fast path for `compute_analytics()` and `compute_code_impact()`.
/// Skips sessions that fail to parse, logging a warning.
pub fn load_session_summaries(sessions_dir: &Path) -> crate::Result<Vec<SessionAnalyticsInput>> {
    let discovered = discover_sessions(sessions_dir)?;
    let mut inputs = Vec::with_capacity(discovered.len());

    for session in &discovered {
        if !session.has_workspace_yaml {
            continue;
        }
        match load_session_summary(&session.path) {
            Ok(summary) => {
                inputs.push(SessionAnalyticsInput {
                    summary,
                    turns: None,
                });
            }
            Err(e) => {
                warn!(session_id = %session.id, error = %e, "Skipping session for analytics");
            }
        }
    }

    Ok(inputs)
}

/// Load full session data including conversation turns.
///
/// Slower path required for `compute_tool_analysis()`.
/// Skips sessions that fail to parse, logging a warning.
pub fn load_full_sessions(sessions_dir: &Path) -> crate::Result<Vec<SessionAnalyticsInput>> {
    let discovered = discover_sessions(sessions_dir)?;
    let mut inputs = Vec::with_capacity(discovered.len());

    for session in &discovered {
        if !session.has_workspace_yaml {
            continue;
        }

        match load_single_full_session(session) {
            Ok(input) => inputs.push(input),
            Err(e) => {
                warn!(session_id = %session.id, error = %e, "Skipping session for analytics");
            }
        }
    }

    Ok(inputs)
}

/// Load a single session with full turn data.
fn load_single_full_session(
    session: &DiscoveredSession,
) -> crate::Result<SessionAnalyticsInput> {
    let summary = load_session_summary(&session.path)?;

    let turns = if session.has_events_jsonl {
        let events_path = session.path.join("events.jsonl");
        match crate::parsing::events::parse_typed_events(&events_path) {
            Ok(events) => Some(crate::turns::reconstruct_turns(&events)),
            Err(e) => {
                warn!(
                    session_id = %session.id,
                    error = %e,
                    "Failed to parse events for turn reconstruction"
                );
                None
            }
        }
    } else {
        None
    };

    Ok(SessionAnalyticsInput { summary, turns })
}

/// Load summaries with optional date range and repository filtering.
///
/// Sessions outside the date range or not matching the repository are excluded.
/// When `hide_empty` is true, sessions with `turn_count == Some(0)` are excluded.
pub fn load_session_summaries_filtered(
    sessions_dir: &Path,
    from_date: Option<&str>,
    to_date: Option<&str>,
    repo: Option<&str>,
    hide_empty: bool,
) -> crate::Result<Vec<SessionAnalyticsInput>> {
    let inputs = load_session_summaries(sessions_dir)?;
    let filtered = filter_by_date_range(inputs, from_date, to_date);
    let filtered = filter_by_repo(filtered, repo);
    Ok(filter_empty(filtered, hide_empty))
}

/// Load full sessions with optional date range and repository filtering.
pub fn load_full_sessions_filtered(
    sessions_dir: &Path,
    from_date: Option<&str>,
    to_date: Option<&str>,
    repo: Option<&str>,
    hide_empty: bool,
) -> crate::Result<Vec<SessionAnalyticsInput>> {
    let inputs = load_full_sessions(sessions_dir)?;
    let filtered = filter_by_date_range(inputs, from_date, to_date);
    let filtered = filter_by_repo(filtered, repo);
    Ok(filter_empty(filtered, hide_empty))
}

/// Filter inputs by date range (YYYY-MM-DD strings, inclusive).
fn filter_by_date_range(
    inputs: Vec<SessionAnalyticsInput>,
    from_date: Option<&str>,
    to_date: Option<&str>,
) -> Vec<SessionAnalyticsInput> {
    if from_date.is_none() && to_date.is_none() {
        return inputs;
    }

    inputs
        .into_iter()
        .filter(|input| {
            let date_str = input
                .summary
                .updated_at
                .or(input.summary.created_at)
                .map(|dt| dt.format("%Y-%m-%d").to_string());

            let date_str = match date_str {
                Some(d) => d,
                None => return true, // Include sessions with no date
            };

            if let Some(from) = from_date {
                if date_str.as_str() < from {
                    return false;
                }
            }
            if let Some(to) = to_date {
                if date_str.as_str() > to {
                    return false;
                }
            }
            true
        })
        .collect()
}

/// Filter inputs by repository name (exact match).
fn filter_by_repo(
    inputs: Vec<SessionAnalyticsInput>,
    repo: Option<&str>,
) -> Vec<SessionAnalyticsInput> {
    match repo {
        None => inputs,
        Some(repo) => inputs
            .into_iter()
            .filter(|input| input.summary.repository.as_deref() == Some(repo))
            .collect(),
    }
}

/// Filter out empty sessions (turn_count == Some(0)).
/// Sessions with turn_count == None (unknown) are kept.
fn filter_empty(
    inputs: Vec<SessionAnalyticsInput>,
    hide_empty: bool,
) -> Vec<SessionAnalyticsInput> {
    if !hide_empty {
        return inputs;
    }
    inputs
        .into_iter()
        .filter(|input| input.summary.turn_count != Some(0))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analytics::types::SessionAnalyticsInput;
    use crate::models::session_summary::SessionSummary;
    use chrono::{TimeZone, Utc};
    use std::fs;
    use tempfile::tempdir;

    fn make_workspace_yaml(id: &str, repo: &str) -> String {
        format!(
            r#"id: {id}
summary: "Test session"
repository: {repo}
branch: main
cwd: /test
hostType: vscode
createdAt: "2026-01-15T12:00:00Z"
updatedAt: "2026-01-15T13:00:00Z"
"#
        )
    }

    #[test]
    fn test_load_summaries_empty_dir() {
        let tmp = tempdir().unwrap();
        let result = load_session_summaries(tmp.path()).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_load_summaries_valid_session() {
        let tmp = tempdir().unwrap();
        let session_dir = tmp.path().join("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
        fs::create_dir_all(&session_dir).unwrap();
        fs::write(
            session_dir.join("workspace.yaml"),
            make_workspace_yaml("a1b2c3d4-e5f6-7890-abcd-ef1234567890", "test/repo"),
        )
        .unwrap();

        let result = load_session_summaries(tmp.path()).unwrap();
        assert_eq!(result.len(), 1);
        assert!(result[0].turns.is_none()); // summary-only
    }

    #[test]
    fn test_load_summaries_skips_invalid() {
        let tmp = tempdir().unwrap();

        // Valid session
        let valid_dir = tmp.path().join("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
        fs::create_dir_all(&valid_dir).unwrap();
        fs::write(
            valid_dir.join("workspace.yaml"),
            make_workspace_yaml("a1b2c3d4-e5f6-7890-abcd-ef1234567890", "test/repo"),
        )
        .unwrap();

        // Invalid session (corrupt yaml)
        let invalid_dir = tmp.path().join("b1b2c3d4-e5f6-7890-abcd-ef1234567890");
        fs::create_dir_all(&invalid_dir).unwrap();
        fs::write(invalid_dir.join("workspace.yaml"), "{{{{invalid yaml").unwrap();

        let result = load_session_summaries(tmp.path()).unwrap();
        assert_eq!(result.len(), 1); // Only valid session loaded
    }

    #[test]
    fn test_filter_by_date_range() {
        fn make_input_with_date(date: &str) -> SessionAnalyticsInput {
            let dt = chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
                .unwrap()
                .and_hms_opt(12, 0, 0)
                .unwrap();
            SessionAnalyticsInput {
                summary: SessionSummary {
                    id: format!("session-{}", date),
                    summary: None,
                    repository: None,
                    branch: None,
                    cwd: None,
                    host_type: None,
                    created_at: Some(Utc.from_utc_datetime(&dt)),
                    updated_at: Some(Utc.from_utc_datetime(&dt)),
                    event_count: None,
                    has_events: false,
                    has_session_db: false,
                    has_plan: false,
                    has_checkpoints: false,
                    checkpoint_count: None,
                    turn_count: None,
                    shutdown_metrics: None,
                },
                turns: None,
            }
        }

        let inputs = vec![
            make_input_with_date("2026-01-10"),
            make_input_with_date("2026-01-15"),
            make_input_with_date("2026-01-20"),
            make_input_with_date("2026-01-25"),
        ];

        // Filter: Jan 12 to Jan 22
        let filtered = filter_by_date_range(inputs, Some("2026-01-12"), Some("2026-01-22"));
        assert_eq!(filtered.len(), 2);
        assert_eq!(filtered[0].summary.id, "session-2026-01-15");
        assert_eq!(filtered[1].summary.id, "session-2026-01-20");
    }

    #[test]
    fn test_filter_no_bounds() {
        let inputs = vec![SessionAnalyticsInput {
            summary: SessionSummary {
                id: "test".to_string(),
                summary: None,
                repository: None,
                branch: None,
                cwd: None,
                host_type: None,
                created_at: None,
                updated_at: None,
                event_count: None,
                has_events: false,
                has_session_db: false,
                has_plan: false,
                has_checkpoints: false,
                checkpoint_count: None,
                turn_count: None,
                shutdown_metrics: None,
            },
            turns: None,
        }];

        let filtered = filter_by_date_range(inputs, None, None);
        assert_eq!(filtered.len(), 1);
    }
}
