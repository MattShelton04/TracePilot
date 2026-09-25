//! Per-agent aggregation shared by the summary and detail queries.

use std::collections::{BTreeMap, HashMap, HashSet};

use tracepilot_core::analytics::{
    AgentDayCount, AgentLabelCount, AgentUsageStats, AgentUsageSummary, MetricDistribution,
};

use super::RunRow;

/// Nearest-rank percentiles over the values that were reported.
pub(super) fn distribution(mut values: Vec<u64>) -> MetricDistribution {
    if values.is_empty() {
        return MetricDistribution::default();
    }
    values.sort_unstable();
    let at = |percentile: f64| {
        let rank = (percentile / 100.0 * (values.len() - 1) as f64).round() as usize;
        values.get(rank).copied()
    };
    MetricDistribution {
        count: values.len() as u64,
        min: values.first().copied(),
        p25: at(25.0),
        p50: at(50.0),
        p75: at(75.0),
        p90: at(90.0),
        max: values.last().copied(),
    }
}

/// Labels sorted by count (descending), then alphabetically.
pub(super) fn ranked<I: IntoIterator<Item = String>>(labels: I) -> Vec<AgentLabelCount> {
    let mut counts: BTreeMap<String, u64> = BTreeMap::new();
    for label in labels {
        *counts.entry(label).or_default() += 1;
    }
    let mut ranked: Vec<AgentLabelCount> = counts
        .into_iter()
        .map(|(label, runs)| AgentLabelCount { label, runs })
        .collect();
    ranked.sort_by(|a, b| b.runs.cmp(&a.runs));
    ranked
}

/// A run whose dispatch disagreed with its configured model (1.0.83+).
pub(super) fn is_mismatch(row: &RunRow) -> bool {
    if row.configured_matches_actual == Some(false) {
        return true;
    }
    match (&row.configured_model, &row.first_dispatched_model) {
        (Some(configured), Some(dispatched)) => configured != dispatched,
        _ => false,
    }
}

/// The value every run that reported one agrees on, else `None`.
///
/// Newer CLIs report the launching call's `name` and `description` for
/// agents such as `general-purpose`, so they change with every run and do
/// not describe the agent itself.
pub(super) fn consistent(
    rows: &[&RunRow],
    field: fn(&RunRow) -> Option<&String>,
) -> Option<String> {
    let mut values = rows.iter().filter_map(|row| field(row));
    let first = values.next()?;
    values.all(|value| value == first).then(|| first.clone())
}

/// Aggregate one agent. `rows` are that agent's runs, newest first, and may
/// include the trend window before the range (`in_range == false`).
pub(super) fn agent_stats(rows: &[&RunRow]) -> AgentUsageStats {
    let current: Vec<&RunRow> = rows.iter().copied().filter(|r| r.in_range).collect();
    let latest = current.first().or(rows.first());
    let latest_with =
        |field: fn(&RunRow) -> Option<&String>| current.iter().find_map(|row| field(row).cloned());
    let mut stats = AgentUsageStats {
        name: latest.map(|r| r.agent_name.clone()).unwrap_or_default(),
        agent_type: latest_with(|r| r.agent_type.as_ref()),
        display_name: consistent(&current, |r| r.display_name.as_ref()),
        description: consistent(&current, |r| r.description.as_ref()),
        runs: current.len() as u64,
        sessions: current
            .iter()
            .map(|r| r.session_id.as_str())
            .collect::<HashSet<_>>()
            .len() as u64,
        duration_ms: distribution(current.iter().filter_map(|r| r.duration_ms).collect()),
        total_tokens: distribution(current.iter().filter_map(|r| r.total_tokens).collect()),
        tool_calls: distribution(current.iter().filter_map(|r| r.total_tool_calls).collect()),
        previous_median_duration_ms: distribution(
            rows.iter()
                .filter(|r| !r.in_range)
                .filter_map(|r| r.duration_ms)
                .collect(),
        )
        .p50,
        first_used: current.last().and_then(|r| r.timestamp.clone()),
        last_used: current.first().and_then(|r| r.timestamp.clone()),
        top_models: ranked(current.iter().filter_map(|r| r.model.clone()))
            .into_iter()
            .take(3)
            .collect(),
        ..Default::default()
    };
    let mut credits = 0u64;
    let mut daily: BTreeMap<&str, u64> = BTreeMap::new();
    for row in &current {
        match row.outcome.as_str() {
            "completed" => stats.completed += 1,
            "failed" => stats.failed += 1,
            "cancelled" => stats.cancelled += 1,
            _ => stats.incomplete += 1,
        }
        if let Some(nano) = row.own_nano_aiu {
            stats.runs_with_credits += 1;
            credits = credits.saturating_add(nano);
        }
        if row.configured_model.is_some() || row.configured_matches_actual.is_some() {
            stats.runs_with_configuration += 1;
        }
        if is_mismatch(row) {
            stats.mismatch_runs += 1;
        }
        stats.max_depth = stats.max_depth.max(row.depth);
        stats.peak_siblings = stats.peak_siblings.max(row.peak_siblings);
        stats.follow_ups += row.follow_up_count;
        if row.messages_sent + row.messages_received > 0 {
            stats.messaging_runs += 1;
        }
        stats.messages_sent += row.messages_sent;
        stats.messages_received += row.messages_received;
        stats.peer_messages += row.peer_messages;
        stats.queued_messages += row.queued_messages;
        if row.multi_turn == Some(true) {
            stats.multi_turn_runs += 1;
        }
        if let Some(date) = row.date() {
            *daily.entry(date).or_default() += 1;
        }
    }
    stats.own_nano_aiu = (stats.runs_with_credits > 0).then_some(credits);
    stats.daily_runs = daily
        .into_iter()
        .map(|(date, runs)| AgentDayCount {
            date: date.to_string(),
            runs,
        })
        .collect();
    stats
}

/// Group rows by case-insensitive agent name, preserving newest-first order.
pub(super) fn group_by_agent(rows: &[RunRow]) -> Vec<Vec<&RunRow>> {
    let mut order: Vec<String> = Vec::new();
    let mut groups: HashMap<String, Vec<&RunRow>> = HashMap::new();
    for row in rows {
        let key = row.agent_name.to_lowercase();
        groups
            .entry(key.clone())
            .or_insert_with(|| {
                order.push(key);
                Vec::new()
            })
            .push(row);
    }
    order
        .into_iter()
        .filter_map(|key| groups.remove(&key))
        .collect()
}

pub(super) fn summarize(rows: &[RunRow]) -> AgentUsageSummary {
    let mut agents: Vec<AgentUsageStats> = group_by_agent(rows)
        .iter()
        .map(|group| agent_stats(group))
        .filter(|stats| stats.runs > 0)
        .collect();
    agents.sort_by(|a, b| b.runs.cmp(&a.runs).then_with(|| a.name.cmp(&b.name)));

    let current: Vec<&RunRow> = rows.iter().filter(|r| r.in_range).collect();
    let mut summary = AgentUsageSummary {
        total_runs: current.len() as u64,
        total_sessions: current
            .iter()
            .map(|r| r.session_id.as_str())
            .collect::<HashSet<_>>()
            .len() as u64,
        ..Default::default()
    };
    for row in &current {
        match row.outcome.as_str() {
            "failed" => summary.failed_runs += 1,
            "cancelled" => summary.cancelled_runs += 1,
            "incomplete" => summary.incomplete_runs += 1,
            _ => {}
        }
        summary.max_depth = summary.max_depth.max(row.depth);
        summary.peak_parallelism = summary.peak_parallelism.max(row.peak_siblings);
        if let Some(nano) = row.own_nano_aiu {
            summary.runs_with_credits += 1;
            summary.total_own_nano_aiu = summary.total_own_nano_aiu.saturating_add(nano);
        }
    }
    summary.agents = agents;
    summary
}
