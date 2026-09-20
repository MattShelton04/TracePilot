//! Breakdowns for one agent's Usage tab.

use std::collections::BTreeMap;

use tracepilot_core::analytics::{
    AgentBucketCount, AgentDayOutcomes, AgentDispatchCount, AgentFailureReason, AgentParentCount,
    AgentRunRecord, AgentUsageDetail,
};

use super::RunRow;
use super::stats::{agent_stats, ranked};

const RECENT_RUNS: usize = 25;
const TOP_ENTRIES: usize = 10;
const MAX_REASON_CHARS: usize = 140;

/// Build the detail for one agent from its runs (newest first).
pub(in crate::index_db) fn build_detail(rows: &[RunRow]) -> AgentUsageDetail {
    let all: Vec<&RunRow> = rows.iter().collect();
    let current: Vec<&RunRow> = rows.iter().filter(|r| r.in_range).collect();

    let mut by_day: BTreeMap<&str, AgentDayOutcomes> = BTreeMap::new();
    let mut dispatch: BTreeMap<[Option<&str>; 4], u64> = BTreeMap::new();
    let mut parents: BTreeMap<Option<&str>, u64> = BTreeMap::new();
    let mut depths: BTreeMap<u32, u64> = BTreeMap::new();
    let mut parallelism: BTreeMap<u32, u64> = BTreeMap::new();
    let mut failures: BTreeMap<String, AgentFailureReason> = BTreeMap::new();

    for row in &current {
        if let Some(date) = row.date() {
            let day = by_day.entry(date).or_insert_with(|| AgentDayOutcomes {
                date: date.to_string(),
                ..Default::default()
            });
            match row.outcome.as_str() {
                "completed" => day.completed += 1,
                "failed" => day.failed += 1,
                "cancelled" => day.cancelled += 1,
                _ => day.incomplete += 1,
            }
        }
        if row.configured_model.is_some() || row.first_dispatched_model.is_some() {
            *dispatch
                .entry([
                    row.configured_model.as_deref(),
                    row.first_dispatched_model.as_deref(),
                    row.model.as_deref(),
                    row.model_override_reason.as_deref(),
                ])
                .or_default() += 1;
        }
        *parents.entry(row.parent_agent_name.as_deref()).or_default() += 1;
        *depths.entry(row.depth).or_default() += 1;
        *parallelism.entry(row.peak_siblings).or_default() += 1;
        if row.outcome == "failed" {
            let example = row
                .error_text
                .as_deref()
                .map(str::trim)
                .filter(|text| !text.is_empty())
                .unwrap_or("No error message recorded");
            let reason = normalize_error(example);
            let entry = failures
                .entry(reason.clone())
                .or_insert_with(|| AgentFailureReason {
                    reason,
                    example: truncate(example),
                    runs: 0,
                    // Rows are newest first, so the first failure seen is the latest.
                    last_seen: row.timestamp.clone(),
                });
            entry.runs += 1;
        }
    }

    let mut dispatch: Vec<AgentDispatchCount> = dispatch
        .into_iter()
        .map(
            |([configured, dispatched, actual, reason], runs)| AgentDispatchCount {
                configured_model: configured.map(String::from),
                first_dispatched_model: dispatched.map(String::from),
                actual_model: actual.map(String::from),
                override_reason: reason.map(String::from),
                runs,
            },
        )
        .collect();
    dispatch.sort_by(|a, b| b.runs.cmp(&a.runs));
    dispatch.truncate(TOP_ENTRIES);

    let mut invoked_by: Vec<AgentParentCount> = parents
        .into_iter()
        .map(|(parent, runs)| AgentParentCount {
            parent: parent.map(String::from),
            runs,
        })
        .collect();
    invoked_by.sort_by(|a, b| b.runs.cmp(&a.runs));

    let mut failure_reasons: Vec<AgentFailureReason> = failures.into_values().collect();
    failure_reasons.sort_by(|a, b| b.runs.cmp(&a.runs));
    failure_reasons.truncate(TOP_ENTRIES);

    let mut stats = agent_stats(&all);
    // The manager needs only the top three; the detail must account for every model.
    stats.top_models = ranked(current.iter().filter_map(|r| r.model.clone()));
    AgentUsageDetail {
        stats,
        outcomes_by_day: by_day.into_values().collect(),
        dispatch,
        invoked_by,
        depths: buckets(depths),
        parallelism: buckets(parallelism),
        failure_reasons,
        execution_modes: ranked(current.iter().filter_map(|r| r.execution_mode.clone())),
        repositories: ranked(current.iter().filter_map(|r| r.repository.clone()))
            .into_iter()
            .take(TOP_ENTRIES)
            .collect(),
        recent_runs: current
            .iter()
            .take(RECENT_RUNS)
            .map(|row| record(row))
            .collect(),
    }
}

fn buckets(counts: BTreeMap<u32, u64>) -> Vec<AgentBucketCount> {
    counts
        .into_iter()
        .map(|(value, runs)| AgentBucketCount { value, runs })
        .collect()
}

fn record(row: &RunRow) -> AgentRunRecord {
    AgentRunRecord {
        session_id: row.session_id.clone(),
        session_summary: row.session_summary.clone(),
        repository: row.repository.clone(),
        run_key: row.run_key.clone(),
        tool_call_id: row.tool_call_id.clone(),
        display_name: row.display_name.clone(),
        description: row.description.clone(),
        started_at: row.timestamp.clone(),
        outcome: row.outcome.clone(),
        error_text: row.error_text.clone(),
        model: row.model.clone(),
        duration_ms: row.duration_ms,
        total_tokens: row.total_tokens,
        total_tool_calls: row.total_tool_calls,
        own_nano_aiu: row.own_nano_aiu,
        depth: row.depth,
        parent_agent_name: row.parent_agent_name.clone(),
        turn_index: row.turn_index,
        event_index: row.event_index,
    }
}

fn truncate(text: &str) -> String {
    tracepilot_core::utils::truncate_utf8_with_marker(text, MAX_REASON_CHARS, Some("…"))
}

/// Group equivalent errors: mask identifiers, paths' digits and numbers, and
/// collapse whitespace so "timed out after 30s (id abc123…)" variants merge.
pub(super) fn normalize_error(text: &str) -> String {
    let first_line = text.lines().next().unwrap_or_default();
    let mut out = String::with_capacity(first_line.len());
    for token in first_line.split_whitespace() {
        if !out.is_empty() {
            out.push(' ');
        }
        let core = token.trim_matches(|c: char| !c.is_ascii_alphanumeric());
        let has_digit = core.chars().any(|c| c.is_ascii_digit());
        let looks_like_id = core.len() >= 12
            && has_digit
            && core
                .chars()
                .all(|c| c.is_ascii_hexdigit() || matches!(c, '-' | '_'));
        if looks_like_id {
            let start = token.find(core).unwrap_or(0);
            out.push_str(&token[..start]);
            out.push('…');
            out.push_str(&token[start + core.len()..]);
        } else if has_digit {
            let mut previous_digit = false;
            let mut chars = token.chars().peekable();
            while let Some(c) = chars.next() {
                if c.is_ascii_digit() {
                    if !previous_digit {
                        out.push('#');
                    }
                    previous_digit = true;
                } else if c == '.'
                    && previous_digit
                    && chars.peek().is_some_and(char::is_ascii_digit)
                {
                    // Decimal timings and integer timings belong to the same failure group.
                    continue;
                } else {
                    out.push(c);
                    previous_digit = false;
                }
            }
        } else {
            out.push_str(token);
        }
    }
    truncate(&out)
}

#[cfg(test)]
mod tests {
    use super::normalize_error;

    #[test]
    fn normalize_error_masks_numbers_and_ids() {
        assert_eq!(
            normalize_error("retry time: 7.595s"),
            normalize_error("retry time: 10s")
        );
        assert_eq!(
            normalize_error("Request 429: retry after 30s (id 3f2a9c1b-77aa-4c)"),
            "Request #: retry after #s (id …)"
        );
        assert_eq!(
            normalize_error("Timed out\nstack trace line"),
            "Timed out",
            "only the first line is used"
        );
    }
}
