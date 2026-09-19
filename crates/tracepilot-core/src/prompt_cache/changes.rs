//! Prefix-change detection between two cache baselines.

use std::collections::{BTreeSet, HashMap};

use serde_json::Value;

use super::baseline::{CacheBaseline, ToolFingerprint};
use super::model::{PrefixChange, PrefixChangeKind};

/// Label used in place of a tool name the CLI does not mark as safe.
pub const REDACTED_TOOL: &str = "custom tool";

/// Compare the baseline before an idle window with the one after it.
///
/// `rewrite_causes` are the history-rewriting events seen between the two
/// baselines (compaction, truncation, context clear), used to explain a
/// history rewrite.
pub fn diff_baselines(
    prev: &CacheBaseline,
    next: &CacheBaseline,
    rewrite_causes: &[String],
) -> Vec<PrefixChange> {
    if prev.model != next.model {
        // The cache is scoped to the model, so nothing else matters.
        return vec![model_change(&prev.model, &next.model)];
    }

    let mut changes = Vec::new();
    if let (Some(from), Some(to)) = (&prev.reasoning_effort, &next.reasoning_effort)
        && from != to
    {
        changes.push(effort_change(from, to));
    }
    changes.extend(tool_changes(&prev.tools, &next.tools));
    if let Some(change) = system_prompt_change(prev, next) {
        changes.push(change);
    }
    if let Some(change) = history_change(prev, next, rewrite_causes) {
        changes.push(change);
    }
    if let (Some(before), Some(after)) = (&prev.cache_config, &next.cache_config)
        && before != after
    {
        changes.push(PrefixChange {
            kind: PrefixChangeKind::CacheConfig,
            summary: "Cache configuration changed".into(),
            details: config_differences(before, after),
        });
    }
    changes
}

/// `key: old → new` for each top-level key that differs.
fn config_differences(before: &Value, after: &Value) -> Vec<String> {
    let (Some(before), Some(after)) = (before.as_object(), after.as_object()) else {
        return Vec::new();
    };
    let keys: BTreeSet<&String> = before.keys().chain(after.keys()).collect();
    keys.into_iter()
        .filter(|key| before.get(*key) != after.get(*key))
        .map(|key| {
            let show = |v: Option<&Value>| v.map_or_else(|| "unset".to_string(), Value::to_string);
            format!(
                "{key}: {} → {}",
                show(before.get(key)),
                show(after.get(key))
            )
        })
        .collect()
}

pub fn model_change(from: &str, to: &str) -> PrefixChange {
    PrefixChange {
        kind: PrefixChangeKind::Model,
        summary: format!("Model changed {from} → {to}"),
        details: Vec::new(),
    }
}

pub fn effort_change(from: &str, to: &str) -> PrefixChange {
    PrefixChange {
        kind: PrefixChangeKind::Effort,
        summary: format!("Effort {from} → {to}"),
        details: Vec::new(),
    }
}

/// A history rewrite observed from events alone (no baselines to compare).
pub fn rewrite_event_change(causes: &[String]) -> PrefixChange {
    PrefixChange {
        kind: PrefixChangeKind::History,
        summary: format!("History rewritten ({})", causes.join(", ")),
        details: causes.to_vec(),
    }
}

fn display_name(tool: &ToolFingerprint) -> String {
    if tool.safe {
        tool.name.clone()
    } else {
        REDACTED_TOOL.to_string()
    }
}

fn plural(count: usize, noun: &str) -> String {
    if count == 1 {
        format!("{count} {noun}")
    } else {
        format!("{count} {noun}s")
    }
}

fn tool_changes(prev: &[ToolFingerprint], next: &[ToolFingerprint]) -> Vec<PrefixChange> {
    let prev_by_name: HashMap<&str, &ToolFingerprint> =
        prev.iter().map(|tool| (tool.name.as_str(), tool)).collect();
    let next_by_name: HashMap<&str, &ToolFingerprint> =
        next.iter().map(|tool| (tool.name.as_str(), tool)).collect();

    let added: Vec<&ToolFingerprint> = next
        .iter()
        .filter(|tool| !prev_by_name.contains_key(tool.name.as_str()))
        .collect();
    let removed: Vec<&ToolFingerprint> = prev
        .iter()
        .filter(|tool| !next_by_name.contains_key(tool.name.as_str()))
        .collect();
    let redefined: Vec<&ToolFingerprint> = next
        .iter()
        .filter(|tool| {
            prev_by_name.get(tool.name.as_str()).is_some_and(|old| {
                old.schema_hash.is_some()
                    && tool.schema_hash.is_some()
                    && old.schema_hash != tool.schema_hash
            })
        })
        .collect();

    let mut changes = Vec::new();
    if !added.is_empty() || !removed.is_empty() {
        let mut parts = Vec::new();
        if !added.is_empty() {
            parts.push(format!("+{}", plural(added.len(), "tool")));
        }
        if !removed.is_empty() {
            parts.push(format!("−{}", plural(removed.len(), "tool")));
        }
        let details = added
            .iter()
            .map(|tool| format!("+ {}", display_name(tool)))
            .chain(
                removed
                    .iter()
                    .map(|tool| format!("− {}", display_name(tool))),
            )
            .collect();
        changes.push(PrefixChange {
            kind: PrefixChangeKind::Tools,
            summary: parts.join(" / "),
            details,
        });
    }
    if !redefined.is_empty() {
        changes.push(PrefixChange {
            kind: PrefixChangeKind::ToolDefinition,
            summary: if redefined.len() == 1 {
                "Tool definition changed".into()
            } else {
                format!("{} tool definitions changed", redefined.len())
            },
            details: redefined.iter().map(|tool| display_name(tool)).collect(),
        });
    }
    changes
}

fn system_prompt_change(prev: &CacheBaseline, next: &CacheBaseline) -> Option<PrefixChange> {
    let prev_hashes: HashMap<&str, Option<&str>> = prev
        .system_segments
        .iter()
        .map(|s| (s.segment.as_str(), s.hash.as_deref()))
        .collect();
    let next_hashes: HashMap<&str, Option<&str>> = next
        .system_segments
        .iter()
        .map(|s| (s.segment.as_str(), s.hash.as_deref()))
        .collect();
    // BTreeSet keeps the listed segment names deterministic.
    let changed: BTreeSet<&str> = prev_hashes
        .keys()
        .chain(next_hashes.keys())
        .copied()
        .filter(|name| prev_hashes.get(name) != next_hashes.get(name))
        .collect();
    if changed.is_empty() {
        return None;
    }
    let names: Vec<String> = changed.iter().map(|name| name.replace('_', " ")).collect();
    Some(PrefixChange {
        kind: PrefixChangeKind::SystemPrompt,
        summary: format!("System prompt changed: {}", names.join(", ")),
        details: changed.iter().map(|name| (*name).to_string()).collect(),
    })
}

fn history_change(
    prev: &CacheBaseline,
    next: &CacheBaseline,
    rewrite_causes: &[String],
) -> Option<PrefixChange> {
    let prev_count = prev.message_count?;
    let prev_points: HashMap<u64, &str> = prev
        .conversation_points
        .iter()
        .map(|(index, hash)| (*index, hash.as_str()))
        .collect();
    let first_diff = next
        .conversation_points
        .iter()
        .filter(|(index, _)| *index < prev_count)
        .filter(|(index, hash)| {
            prev_points
                .get(index)
                .is_some_and(|old| *old != hash.as_str())
        })
        .map(|(index, _)| *index)
        .min();
    // A shrinking conversation is a rewrite even when no sampled point overlaps.
    let shrank = next.message_count.is_some_and(|count| count < prev_count);
    let at = first_diff.or(shrank.then_some(0))?;
    let summary = if first_diff.is_some() {
        format!("History rewritten at message {at}")
    } else {
        "History rewritten".to_string()
    };
    let summary = if rewrite_causes.is_empty() {
        summary
    } else {
        format!("{summary} ({})", rewrite_causes.join(", "))
    };
    Some(PrefixChange {
        kind: PrefixChangeKind::History,
        summary,
        details: rewrite_causes.to_vec(),
    })
}
