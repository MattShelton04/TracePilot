//! Per-skill aggregation shared by the summary and detail queries.

use std::collections::{BTreeMap, HashMap, HashSet};

use tracepilot_core::analytics::{
    SkillDayCount, SkillInvocationRecord, SkillLabelCount, SkillPathCount, SkillUsageDetail,
    SkillUsageStats, SkillUsageSummary,
};

use super::InvocationRow;

/// Invocations kept in a skill's Recent uses list.
const RECENT_LIMIT: usize = 25;

/// Labels ranked by count (descending), then alphabetically.
fn ranked<I: IntoIterator<Item = String>>(labels: I) -> Vec<SkillLabelCount> {
    let mut counts: BTreeMap<String, u64> = BTreeMap::new();
    for label in labels {
        *counts.entry(label).or_default() += 1;
    }
    let mut ranked: Vec<SkillLabelCount> = counts
        .into_iter()
        .map(|(label, uses)| SkillLabelCount { label, uses })
        .collect();
    ranked.sort_by(|a, b| b.uses.cmp(&a.uses));
    ranked
}

/// Nearest-rank median over the values that were reported.
fn median(mut values: Vec<u64>) -> Option<u64> {
    if values.is_empty() {
        return None;
    }
    values.sort_unstable();
    values.get((values.len() - 1) / 2).copied()
}

/// Directories this name was loaded from, most used first.
///
/// Grouped on the case-folded directory but displaying the most recent
/// spelling, so a skill invoked from two clones of the same repository shows
/// both rather than collapsing into one.
fn paths(rows: &[&InvocationRow]) -> Vec<SkillPathCount> {
    let mut order: Vec<&str> = Vec::new();
    let mut counts: HashMap<&str, (String, u64)> = HashMap::new();
    for row in rows {
        let (Some(directory), Some(path)) = (
            row.normalized_directory.as_deref(),
            row.skill_path.as_deref(),
        ) else {
            continue;
        };
        counts
            .entry(directory)
            .or_insert_with(|| {
                order.push(directory);
                (path.to_string(), 0)
            })
            .1 += 1;
    }
    let mut paths: Vec<SkillPathCount> = order
        .into_iter()
        .filter_map(|directory| {
            let (path, uses) = counts.remove(directory)?;
            Some(SkillPathCount {
                path,
                directory: directory.to_string(),
                uses,
            })
        })
        .collect();
    paths.sort_by(|a, b| {
        b.uses
            .cmp(&a.uses)
            .then_with(|| a.directory.cmp(&b.directory))
    });
    paths
}

/// Aggregate one skill. `rows` are that skill's invocations, newest first.
pub(super) fn skill_stats(rows: &[&InvocationRow]) -> SkillUsageStats {
    let latest = rows.first();
    let latest_with = |field: fn(&InvocationRow) -> Option<&String>| {
        rows.iter().find_map(|row| field(row).cloned())
    };

    let mut stats = SkillUsageStats {
        name: latest.map(|row| row.skill_name.clone()).unwrap_or_default(),
        normalized_name: latest
            .map(|row| row.normalized_name.clone())
            .unwrap_or_default(),
        description: latest_with(|row| row.description.as_ref()),
        uses: rows.len() as u64,
        sessions: rows
            .iter()
            .map(|row| row.session_id.as_str())
            .collect::<HashSet<_>>()
            .len() as u64,
        repositories: rows
            .iter()
            .filter_map(|row| row.repository.as_deref())
            .collect::<HashSet<_>>()
            .len() as u64,
        first_used: rows.last().and_then(|row| row.timestamp.clone()),
        last_used: latest.and_then(|row| row.timestamp.clone()),
        // The newest invocation that carried content is what the installed
        // file is compared against.
        latest_content_sha256: rows.iter().find_map(|row| row.content_sha256.clone()),
        paths: paths(rows),
        top_models: ranked(rows.iter().filter_map(|row| row.model.clone()))
            .into_iter()
            .take(3)
            .collect(),
        top_repositories: ranked(rows.iter().filter_map(|row| row.repository.clone()))
            .into_iter()
            .take(3)
            .collect(),
        plugin_name: latest_with(|row| row.plugin_name.as_ref()),
        source: latest_with(|row| row.source.as_ref()),
        ..Default::default()
    };

    let mut daily: BTreeMap<&str, u64> = BTreeMap::new();
    let mut content_tokens: Vec<u64> = Vec::new();
    let mut fingerprints: HashSet<&str> = HashSet::new();
    for row in rows {
        match row.trigger.as_deref() {
            Some("user-invoked") => stats.user_invoked += 1,
            Some("agent-invoked") => stats.agent_invoked += 1,
            // An unrecognised value is still not evidence for either side.
            _ => stats.unknown_trigger += 1,
        }
        if row.agent_id.is_some() {
            stats.subagent_uses += 1;
        } else {
            stats.main_agent_uses += 1;
        }
        if row.origin == "tool_call_fallback" {
            stats.fallback_uses += 1;
        }
        if let Some(tokens) = row.content_tokens {
            content_tokens.push(tokens);
        }
        if let Some(fingerprint) = row.content_sha256.as_deref() {
            fingerprints.insert(fingerprint);
        }
        if let Some(date) = row.date() {
            *daily.entry(date).or_default() += 1;
        }
    }
    stats.uses_with_content = content_tokens.len() as u64;
    stats.median_content_tokens = median(content_tokens);
    stats.content_versions = fingerprints.len() as u64;
    stats.daily_uses = daily
        .into_iter()
        .map(|(date, uses)| SkillDayCount {
            date: date.to_string(),
            uses,
        })
        .collect();
    stats
}

/// Group rows by normalised name, preserving newest-first order.
fn group_by_skill(rows: &[InvocationRow]) -> Vec<Vec<&InvocationRow>> {
    let mut order: Vec<&str> = Vec::new();
    let mut groups: HashMap<&str, Vec<&InvocationRow>> = HashMap::new();
    for row in rows {
        groups
            .entry(row.normalized_name.as_str())
            .or_insert_with(|| {
                order.push(row.normalized_name.as_str());
                Vec::new()
            })
            .push(row);
    }
    order
        .into_iter()
        .filter_map(|key| groups.remove(key))
        .collect()
}

pub(super) fn summarize(rows: &[InvocationRow]) -> SkillUsageSummary {
    let mut skills: Vec<SkillUsageStats> = group_by_skill(rows)
        .iter()
        .map(|group| skill_stats(group))
        .filter(|stats| stats.uses > 0)
        .collect();
    skills.sort_by(|a, b| {
        b.uses
            .cmp(&a.uses)
            .then_with(|| a.normalized_name.cmp(&b.normalized_name))
    });

    SkillUsageSummary {
        total_uses: rows.len() as u64,
        total_sessions: rows
            .iter()
            .map(|row| row.session_id.as_str())
            .collect::<HashSet<_>>()
            .len() as u64,
        unknown_trigger_uses: skills.iter().map(|stats| stats.unknown_trigger).sum(),
        fallback_uses: skills.iter().map(|stats| stats.fallback_uses).sum(),
        skills,
    }
}

pub(super) fn build_detail(rows: &[InvocationRow]) -> SkillUsageDetail {
    let refs: Vec<&InvocationRow> = rows.iter().collect();
    SkillUsageDetail {
        stats: skill_stats(&refs),
        invoked_by: ranked(refs.iter().map(|row| row.invoked_by().to_string())),
        models: ranked(refs.iter().filter_map(|row| row.model.clone())),
        repositories: ranked(refs.iter().filter_map(|row| row.repository.clone())),
        recent_invocations: refs
            .iter()
            .take(RECENT_LIMIT)
            .map(|row| SkillInvocationRecord {
                session_id: row.session_id.clone(),
                session_summary: row.session_summary.clone(),
                repository: row.repository.clone(),
                turn_index: row.turn_index,
                event_index: row.event_index,
                timestamp: row.timestamp.clone(),
                skill_name: row.skill_name.clone(),
                path: row.skill_path.clone(),
                trigger: row.trigger.clone(),
                agent_name: row.agent_name.clone(),
                model: row.model.clone(),
                content_tokens: row.content_tokens,
                content_sha256: row.content_sha256.clone(),
                origin: row.origin.clone(),
            })
            .collect(),
    }
}
