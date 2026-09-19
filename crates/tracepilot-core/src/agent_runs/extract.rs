//! Build [`AgentRun`]s from reconstructed turns plus a light event side-pass.

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Duration, Utc};
use serde_json::Value;

use crate::models::conversation::{ConversationTurn, TurnToolCall};
use crate::parsing::events::{TypedEvent, TypedEventData, extract_agent_usage};

use super::model::{AgentRun, AgentRunExtraction, AgentRunOutcome, AgentRunSource, AgentSelection};

/// Extract every agent run and main-agent selection from one session.
///
/// `turns` must be the output of [`crate::turns::reconstruct_turns`] for the
/// same `events`, so identity, status and nesting match the Conversation tab.
pub fn extract_agent_runs(events: &[TypedEvent], turns: &[ConversationTurn]) -> AgentRunExtraction {
    let side = SideData::collect(events);
    let ledger = extract_agent_usage(events);

    let calls: Vec<(usize, &TurnToolCall)> = turns
        .iter()
        .flat_map(|turn| turn.tool_calls.iter().map(move |tc| (turn.turn_index, tc)))
        .filter(|(_, tc)| tc.is_subagent)
        .collect();

    let mut runs: Vec<AgentRun> = calls
        .iter()
        .enumerate()
        .map(|(index, (turn_index, tc))| build_run(index, *turn_index, tc, &side, ledger.as_ref()))
        .collect();

    link_parents(&mut runs, &calls);
    count_follow_ups(&mut runs, &calls, turns, &side);
    compute_peak_siblings(&mut runs);

    AgentRunExtraction {
        runs,
        selections: side.selections,
    }
}

fn arg_str<'a>(tc: &'a TurnToolCall, key: &str) -> Option<&'a str> {
    tc.arguments
        .as_ref()?
        .get(key)?
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn build_run(
    index: usize,
    turn_index: usize,
    tc: &TurnToolCall,
    side: &SideData,
    ledger: Option<&crate::models::agent_usage::AgentUsageSnapshot>,
) -> AgentRun {
    let lifecycle = tc
        .tool_call_id
        .as_deref()
        .and_then(|id| side.lifecycle.get(id));
    // The reconstructor marks a `task` call with an `agent_type` as a subagent
    // at launch; without lifecycle events its name is still the tool's.
    let task_agent_type = (tc.tool_name == "task")
        .then(|| arg_str(tc, "agent_type"))
        .flatten();
    let source = match (lifecycle, task_agent_type) {
        (None, Some(_)) => AgentRunSource::TaskArguments,
        _ => AgentRunSource::Lifecycle,
    };
    let configured = tc
        .agent_id
        .as_deref()
        .and_then(|id| side.configured.get(id));
    let agent_name = task_agent_type.unwrap_or(&tc.tool_name).to_string();
    let run_key = tc
        .tool_call_id
        .clone()
        .or_else(|| tc.agent_id.clone())
        .unwrap_or_else(|| format!("run-{turn_index}-{index}"));
    let own_nano_aiu = tc
        .agent_id
        .as_deref()
        .and_then(|id| ledger?.agents.get(id))
        .and_then(|entry| entry.total_nano_aiu)
        .filter(|value| value.is_finite() && *value >= 0.0)
        .map(|value| value.round() as u64);
    let duration_ms = tc.duration_ms.or_else(|| {
        let (start, end) = (tc.started_at?, tc.completed_at?);
        u64::try_from((end - start).num_milliseconds()).ok()
    });
    let outcome = outcome_of(tc);
    let error_text = matches!(outcome, AgentRunOutcome::Failed)
        .then(|| tc.error.clone())
        .flatten();

    AgentRun {
        run_key,
        tool_call_id: tc.tool_call_id.clone(),
        agent_id: tc.agent_id.clone(),
        parent_run_key: None,
        parent_agent_name: None,
        depth: 0,
        agent_type: lifecycle
            .and_then(|meta| meta.agent_type.clone())
            .or_else(|| arg_str(tc, "agent_type").map(String::from)),
        display_name: tc
            .agent_display_name
            .clone()
            .or_else(|| arg_str(tc, "name").map(String::from)),
        description: tc
            .agent_description
            .clone()
            .or_else(|| arg_str(tc, "description").map(String::from)),
        execution_mode: lifecycle
            .and_then(|meta| meta.execution_mode.clone())
            .or_else(|| arg_str(tc, "mode").map(String::from)),
        agent_name,
        started_at: tc.started_at,
        ended_at: tc.completed_at,
        outcome,
        error_text,
        requested_model: tc.requested_model.clone(),
        model: tc.model.clone(),
        configured_model: configured.and_then(|c| c.model.clone()),
        configured_effort: configured.and_then(|c| c.effort.clone()),
        context_tier: configured.and_then(|c| c.context_tier.clone()),
        multi_turn: configured.and_then(|c| c.multi_turn),
        first_dispatched_model: lifecycle.and_then(|m| m.first_dispatched_model.clone()),
        explicit_model_override: lifecycle.and_then(|m| m.explicit_model_override.clone()),
        model_override_reason: lifecycle.and_then(|m| m.model_override_reason.clone()),
        configured_model_preference: lifecycle.and_then(|m| m.configured_model_preference.clone()),
        configured_matches_actual: lifecycle.and_then(|m| m.configured_matches_actual),
        total_tool_calls: tc.total_tool_calls,
        total_tokens: tc.total_tokens,
        duration_ms,
        own_nano_aiu,
        follow_up_count: 0,
        peak_siblings: 1,
        turn_index,
        event_index: tc.event_index,
        source,
    }
}

fn outcome_of(tc: &TurnToolCall) -> AgentRunOutcome {
    if tc.cancelled == Some(true) || tc.agent_status.as_deref() == Some("cancelled") {
        AgentRunOutcome::Cancelled
    } else if !tc.is_complete {
        AgentRunOutcome::Incomplete
    } else if tc.success == Some(false) {
        AgentRunOutcome::Failed
    } else {
        AgentRunOutcome::Completed
    }
}

/// Resolve each run's launching agent and nesting depth.
fn link_parents(runs: &mut [AgentRun], calls: &[(usize, &TurnToolCall)]) {
    let by_call_id: HashMap<&str, usize> = calls
        .iter()
        .enumerate()
        .filter_map(|(index, (_, tc))| tc.tool_call_id.as_deref().map(|id| (id, index)))
        .collect();
    let parent_of: Vec<Option<usize>> = calls
        .iter()
        .enumerate()
        .map(|(index, (_, tc))| {
            let parent = *by_call_id.get(tc.parent_tool_call_id.as_deref()?)?;
            (parent != index).then_some(parent)
        })
        .collect();

    for index in 0..runs.len() {
        let Some(parent) = parent_of[index] else {
            continue;
        };
        // Walk ancestors with a cycle guard; malformed logs must not hang.
        let mut depth = 1;
        let mut seen = HashSet::from([index]);
        let mut cursor = parent;
        while let Some(next) = parent_of[cursor] {
            if !seen.insert(cursor) {
                break;
            }
            depth += 1;
            cursor = next;
        }
        runs[index].depth = depth;
        runs[index].parent_run_key = Some(runs[parent].run_key.clone());
        runs[index].parent_agent_name = Some(runs[parent].agent_name.clone());
    }
}

/// Count successful `write_agent` follow-ups addressed to each run.
///
/// The control tools address a worker by its runtime ID, launching tool-call
/// ID or the `name` given to the `task` call, depending on the CLI version.
fn count_follow_ups(
    runs: &mut [AgentRun],
    calls: &[(usize, &TurnToolCall)],
    turns: &[ConversationTurn],
    side: &SideData,
) {
    let mut by_handle: HashMap<&str, usize> = HashMap::new();
    for (index, (_, tc)) in calls.iter().enumerate() {
        for handle in [
            tc.agent_id.as_deref(),
            tc.tool_call_id.as_deref(),
            arg_str(tc, "name"),
        ]
        .into_iter()
        .flatten()
        {
            by_handle.entry(handle).or_insert(index);
        }
    }
    let writes = turns
        .iter()
        .flat_map(|turn| turn.tool_calls.iter())
        .filter(|tc| tc.tool_name == "write_agent" && tc.success == Some(true));
    for write in writes {
        let target = write
            .tool_call_id
            .as_deref()
            .and_then(|id| side.control_targets.get(id))
            .map(String::as_str)
            .or_else(|| arg_str(write, "agent_id"));
        if let Some(&index) = target.and_then(|target| by_handle.get(target)) {
            runs[index].follow_up_count += 1;
        }
    }
}

/// For each run, the most siblings (same launching agent) active at once
/// during its lifetime, itself included.
fn compute_peak_siblings(runs: &mut [AgentRun]) {
    let mut groups: HashMap<Option<String>, Vec<usize>> = HashMap::new();
    for (index, run) in runs.iter().enumerate() {
        if run.started_at.is_some() {
            groups
                .entry(run.parent_run_key.clone())
                .or_default()
                .push(index);
        }
    }
    for members in groups.values() {
        let interval = |index: usize| -> (DateTime<Utc>, DateTime<Utc>) {
            let run = &runs[index];
            let start = run.started_at.expect("grouped runs have a start");
            // Zero-length or unfinished runs occupy their start instant only.
            let end = run.ended_at.filter(|end| *end > start);
            (start, end.unwrap_or(start + Duration::milliseconds(1)))
        };
        let mut starts: Vec<DateTime<Utc>> = members.iter().map(|&i| interval(i).0).collect();
        let mut ends: Vec<DateTime<Utc>> = members.iter().map(|&i| interval(i).1).collect();
        starts.sort_unstable();
        ends.sort_unstable();
        let active_at = |point: DateTime<Utc>| {
            starts.partition_point(|s| *s <= point) - ends.partition_point(|e| *e <= point)
        };
        let peaks: Vec<(usize, u32)> = members
            .iter()
            .map(|&index| {
                let (start, end) = interval(index);
                let first = starts.partition_point(|s| *s < start);
                let last = starts.partition_point(|s| *s < end);
                let peak = starts[first..last]
                    .iter()
                    .map(|point| active_at(*point))
                    .max()
                    .unwrap_or(1);
                (index, u32::try_from(peak.max(1)).unwrap_or(u32::MAX))
            })
            .collect();
        for (index, peak) in peaks {
            runs[index].peak_siblings = peak;
        }
    }
}

#[derive(Default)]
struct LifecycleMeta {
    agent_type: Option<String>,
    execution_mode: Option<String>,
    first_dispatched_model: Option<String>,
    explicit_model_override: Option<String>,
    model_override_reason: Option<String>,
    configured_model_preference: Option<String>,
    configured_matches_actual: Option<bool>,
}

struct ConfiguredMeta {
    model: Option<String>,
    effort: Option<String>,
    context_tier: Option<String>,
    multi_turn: Option<bool>,
}

/// Per-run fields the reconstructor does not retain, gathered in one pass.
#[derive(Default)]
struct SideData {
    /// Keyed by launching tool-call ID.
    lifecycle: HashMap<String, LifecycleMeta>,
    /// Keyed by runtime agent ID; the configuration at launch wins.
    configured: HashMap<String, ConfiguredMeta>,
    /// Control tool-call ID → the worker ID its telemetry reports.
    control_targets: HashMap<String, String>,
    selections: Vec<AgentSelection>,
}

impl SideData {
    fn collect(events: &[TypedEvent]) -> Self {
        let mut side = Self::default();
        for (event_index, event) in events.iter().enumerate() {
            match &event.typed_data {
                TypedEventData::SubagentStarted(data) => {
                    if let Some(id) = &data.tool_call_id {
                        let meta = side.lifecycle.entry(id.clone()).or_default();
                        fill(&mut meta.agent_type, &data.agent_type);
                        fill(&mut meta.execution_mode, &data.execution_mode);
                    }
                }
                TypedEventData::SubagentCompleted(data) => {
                    if let Some(id) = &data.tool_call_id {
                        let meta = side.lifecycle.entry(id.clone()).or_default();
                        merge_dispatch(
                            meta,
                            [
                                &data.first_dispatched_model,
                                &data.explicit_model_override,
                                &data.model_override_reason,
                                &data.configured_model_preference,
                            ],
                            data.configured_model_matches_actual,
                        );
                    }
                }
                TypedEventData::SubagentFailed(data) => {
                    if let Some(id) = &data.tool_call_id {
                        let meta = side.lifecycle.entry(id.clone()).or_default();
                        merge_dispatch(
                            meta,
                            [
                                &data.first_dispatched_model,
                                &data.explicit_model_override,
                                &data.model_override_reason,
                                &data.configured_model_preference,
                            ],
                            data.configured_model_matches_actual,
                        );
                    }
                }
                TypedEventData::SubagentConfigured(data) => {
                    if let Some(agent_id) = &event.raw.agent_id {
                        side.configured
                            .entry(agent_id.clone())
                            .or_insert_with(|| ConfiguredMeta {
                                model: data.model.clone(),
                                effort: data.reasoning_effort.clone(),
                                context_tier: data.context_tier.clone(),
                                multi_turn: data.multi_turn,
                            });
                    }
                }
                TypedEventData::ToolExecutionComplete(data) => {
                    let target = data
                        .tool_telemetry
                        .as_ref()
                        .and_then(|t| t.pointer("/properties/agent_id"))
                        .and_then(Value::as_str);
                    if let (Some(id), Some(target)) = (&data.tool_call_id, target) {
                        side.control_targets.insert(id.clone(), target.to_string());
                    }
                }
                TypedEventData::SubagentSelected(data) if event.raw.agent_id.is_none() => {
                    side.selections.push(AgentSelection {
                        event_index,
                        agent_name: data.agent_name.clone(),
                        display_name: data.agent_display_name.clone(),
                        selected: true,
                        timestamp: event.raw.timestamp,
                    });
                }
                TypedEventData::SubagentDeselected(_) if event.raw.agent_id.is_none() => {
                    side.selections.push(AgentSelection {
                        event_index,
                        agent_name: None,
                        display_name: None,
                        selected: false,
                        timestamp: event.raw.timestamp,
                    });
                }
                _ => {}
            }
        }
        side
    }
}

fn fill(slot: &mut Option<String>, value: &Option<String>) {
    if slot.is_none() {
        slot.clone_from(value);
    }
}

/// Later terminal events (multi-turn workers) refine earlier ones.
fn merge_dispatch(meta: &mut LifecycleMeta, values: [&Option<String>; 4], matches: Option<bool>) {
    let [first, explicit, reason, preference] = values;
    for (slot, value) in [
        (&mut meta.first_dispatched_model, first),
        (&mut meta.explicit_model_override, explicit),
        (&mut meta.model_override_reason, reason),
        (&mut meta.configured_model_preference, preference),
    ] {
        if value.is_some() {
            slot.clone_from(value);
        }
    }
    if matches.is_some() {
        meta.configured_matches_actual = matches;
    }
}
