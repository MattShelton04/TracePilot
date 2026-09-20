use chrono::{DateTime, Utc};
use serde_json::{Value, json};

use super::*;
use crate::parsing::events::TypedEvent;
use crate::testing::make_typed_event;
use crate::turns::reconstruct_turns;

fn at(time: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(&format!("2026-09-12T{time}Z"))
        .unwrap()
        .with_timezone(&Utc)
}

fn event(event_type: &str, time: &str, data: Value) -> TypedEvent {
    let mut event = make_typed_event(event_type, data);
    event.raw.timestamp = Some(at(time));
    event.raw.id = Some(format!("{event_type}-{time}"));
    event
}

fn owned(mut event: TypedEvent, agent_id: &str) -> TypedEvent {
    event.raw.agent_id = Some(agent_id.to_string());
    event
}

fn task(time: &str, call: &str, agent_type: &str, name: &str) -> TypedEvent {
    event(
        "tool.execution_start",
        time,
        json!({"toolCallId": call, "toolName": "task",
               "arguments": {"agent_type": agent_type, "name": name, "description": "Do work"}}),
    )
}

fn started(time: &str, call: &str, agent: &str, agent_id: Option<&str>) -> TypedEvent {
    let event = event(
        "subagent.started",
        time,
        json!({"toolCallId": call, "agentName": agent, "agentDisplayName": agent,
               "agentType": agent, "executionMode": "background"}),
    );
    match agent_id {
        Some(id) => owned(event, id),
        None => event,
    }
}

fn completed(time: &str, call: &str, extra: Value) -> TypedEvent {
    let mut data = json!({"toolCallId": call, "agentName": "x", "model": "gpt-5.6-luna",
                          "totalToolCalls": 4, "totalTokens": 900, "durationMs": 5000});
    for (key, value) in extra.as_object().unwrap() {
        data[key] = value.clone();
    }
    event("subagent.completed", time, data)
}

fn session(events: Vec<TypedEvent>) -> AgentRunExtraction {
    let mut all = vec![
        event(
            "session.start",
            "00:00:00",
            json!({"copilotVersion": "1.0.83"}),
        ),
        event("user.message", "00:00:01", json!({"content": "go"})),
    ];
    all.extend(events);
    let turns = reconstruct_turns(&all);
    extract_agent_runs(&all, &turns)
}

fn run<'a>(extraction: &'a AgentRunExtraction, key: &str) -> &'a AgentRun {
    extraction
        .runs
        .iter()
        .find(|run| run.run_key == key)
        .unwrap_or_else(|| panic!("run {key} missing: {:?}", extraction.runs))
}

#[test]
fn nested_runs_carry_depth_parent_configuration_and_ledger_credits() {
    let extraction = session(vec![
        task("00:00:02", "call-review", "code-review", "reviewer"),
        started("00:00:02", "call-review", "code-review", Some("agent-a")),
        owned(
            event(
                "subagent.configured",
                "00:00:03",
                json!({"model": "gpt-5.6-luna", "reasoningEffort": "high",
                       "contextTier": "long_context", "multiTurn": true}),
            ),
            "agent-a",
        ),
        owned(
            task("00:00:04", "call-explore", "explore", "finder"),
            "agent-a",
        ),
        started("00:00:04", "call-explore", "explore", Some("agent-b")),
        completed("00:00:06", "call-explore", json!({"agentName": "explore"})),
        completed(
            "00:00:09",
            "call-review",
            json!({"firstDispatchedModel": "gpt-5.6-luna", "explicitModelOverride": "gpt-5.6-luna",
                   "configuredModelMatchesActual": true}),
        ),
        event(
            "session.shutdown",
            "00:00:10",
            json!({"agentMetrics": {
                "main": {"totalNanoAiu": 10.0, "modelMetrics": {}},
                "agent-a": {"agentName": "code-review", "totalNanoAiu": 2500000000.0, "modelMetrics": {}}
            }}),
        ),
    ]);

    assert_eq!(extraction.runs.len(), 2);
    let review = run(&extraction, "call-review");
    assert_eq!(review.agent_name, "code-review");
    assert_eq!(review.depth, 0);
    assert_eq!(review.parent_run_key, None);
    assert_eq!(review.outcome, AgentRunOutcome::Completed);
    assert_eq!(review.agent_type.as_deref(), Some("code-review"));
    assert_eq!(review.execution_mode.as_deref(), Some("background"));
    assert_eq!(review.configured_model.as_deref(), Some("gpt-5.6-luna"));
    assert_eq!(review.configured_effort.as_deref(), Some("high"));
    assert_eq!(review.context_tier.as_deref(), Some("long_context"));
    assert_eq!(review.multi_turn, Some(true));
    assert_eq!(
        review.first_dispatched_model.as_deref(),
        Some("gpt-5.6-luna")
    );
    assert_eq!(review.configured_matches_actual, Some(true));
    assert_eq!(review.own_nano_aiu, Some(2_500_000_000));
    assert_eq!(review.total_tokens, Some(900));
    assert_eq!(review.duration_ms, Some(5000));
    assert_eq!(review.source, AgentRunSource::Lifecycle);

    let explore = run(&extraction, "call-explore");
    assert_eq!(explore.depth, 1);
    assert_eq!(explore.parent_run_key.as_deref(), Some("call-review"));
    assert_eq!(explore.parent_agent_name.as_deref(), Some("code-review"));
    assert_eq!(
        explore.own_nano_aiu, None,
        "no ledger entry means unknown credits"
    );
}

#[test]
fn failures_cancellations_and_missing_terminals_map_to_outcomes() {
    let extraction = session(vec![
        task("00:00:02", "call-fail", "explore", "a"),
        started("00:00:02", "call-fail", "explore", None),
        event(
            "subagent.failed",
            "00:00:03",
            json!({"toolCallId": "call-fail", "agentName": "explore", "error": "Rate limited"}),
        ),
        task("00:00:02", "call-cancel", "explore", "b"),
        started("00:00:02", "call-cancel", "explore", None),
        completed("00:00:04", "call-cancel", json!({"cancelled": true})),
        task("00:00:02", "call-open", "explore", "c"),
        started("00:00:02", "call-open", "explore", None),
    ]);

    let failed = run(&extraction, "call-fail");
    assert_eq!(failed.outcome, AgentRunOutcome::Failed);
    assert_eq!(failed.error_text.as_deref(), Some("Rate limited"));
    assert_eq!(
        run(&extraction, "call-cancel").outcome,
        AgentRunOutcome::Cancelled
    );
    assert_eq!(run(&extraction, "call-cancel").error_text, None);
    assert_eq!(
        run(&extraction, "call-open").outcome,
        AgentRunOutcome::Incomplete
    );
}

#[test]
fn legacy_completions_without_metrics_keep_name_and_outcome_only() {
    let extraction = session(vec![
        started("00:00:02", "call-old", "general-purpose", None),
        event(
            "subagent.completed",
            "00:00:05",
            json!({"toolCallId": "call-old", "agentName": "general-purpose"}),
        ),
    ]);

    let legacy = run(&extraction, "call-old");
    assert_eq!(legacy.agent_name, "general-purpose");
    assert_eq!(legacy.outcome, AgentRunOutcome::Completed);
    assert_eq!(legacy.total_tokens, None);
    assert_eq!(legacy.total_tool_calls, None);
    assert_eq!(legacy.configured_model, None);
    assert_eq!(
        legacy.duration_ms,
        Some(3000),
        "falls back to timestamp math"
    );
}

#[test]
fn task_calls_without_lifecycle_events_use_task_arguments() {
    let extraction = session(vec![task("00:00:02", "call-task", "research", "digger")]);

    let fallback = run(&extraction, "call-task");
    assert_eq!(fallback.agent_name, "research");
    assert_eq!(fallback.agent_type.as_deref(), Some("research"));
    assert_eq!(fallback.display_name.as_deref(), Some("digger"));
    assert_eq!(fallback.source, AgentRunSource::TaskArguments);
    assert_eq!(fallback.outcome, AgentRunOutcome::Incomplete);
}

#[test]
fn peak_siblings_counts_overlapping_runs_with_the_same_parent() {
    let mut events = Vec::new();
    for (call, start, end) in [
        ("call-1", "00:00:02", "00:00:10"),
        ("call-2", "00:00:03", "00:00:08"),
        ("call-3", "00:00:04", "00:00:05"),
        ("call-4", "00:00:20", "00:00:25"),
    ] {
        events.push(task(start, call, "explore", call));
        events.push(started(start, call, "explore", None));
        events.push(completed(end, call, json!({"durationMs": null})));
    }
    let extraction = session(events);

    assert_eq!(run(&extraction, "call-1").peak_siblings, 3);
    assert_eq!(run(&extraction, "call-2").peak_siblings, 3);
    assert_eq!(run(&extraction, "call-3").peak_siblings, 3);
    assert_eq!(run(&extraction, "call-4").peak_siblings, 1);
}

#[test]
fn write_agent_follow_ups_resolve_task_names() {
    let extraction = session(vec![
        task("00:00:02", "call-worker", "general-purpose", "docs-cleanup"),
        started(
            "00:00:02",
            "call-worker",
            "general-purpose",
            Some("agent-w"),
        ),
        completed("00:00:05", "call-worker", json!({})),
        event(
            "tool.execution_start",
            "00:00:06",
            json!({"toolCallId": "call-write", "toolName": "write_agent",
                   "arguments": {"agent_id": "docs-cleanup", "message": "more"}}),
        ),
        event(
            "tool.execution_complete",
            "00:00:06",
            json!({"toolCallId": "call-write", "success": true}),
        ),
    ]);

    assert_eq!(run(&extraction, "call-worker").follow_up_count, 1);
}

#[test]
fn main_agent_selection_events_are_recorded() {
    let extraction = session(vec![
        event(
            "subagent.selected",
            "00:00:02",
            json!({"agentName": "reviewer", "agentDisplayName": "Reviewer", "tools": ["view"]}),
        ),
        event("subagent.deselected", "00:00:09", json!({})),
    ]);

    assert_eq!(extraction.selections.len(), 2);
    assert_eq!(
        extraction.selections[0].agent_name.as_deref(),
        Some("reviewer")
    );
    assert!(extraction.selections[0].selected);
    assert!(!extraction.selections[1].selected);
}
