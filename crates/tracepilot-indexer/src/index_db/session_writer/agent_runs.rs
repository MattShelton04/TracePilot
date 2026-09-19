//! Agent-run rows written at index time.

use crate::Result;
use rusqlite::{Connection, ToSql};
use tracepilot_core::agent_runs::{AgentRun, AgentRunExtraction};

use super::super::batch_insert::batched_insert;

/// Owned, SQL-ready form of an [`AgentRun`].
struct AgentRunRow<'a> {
    run: &'a AgentRun,
    started_at: Option<String>,
    ended_at: Option<String>,
    outcome: &'static str,
    source: &'static str,
    depth: i64,
    multi_turn: Option<i64>,
    configured_matches_actual: Option<i64>,
    total_tool_calls: Option<i64>,
    total_tokens: Option<i64>,
    duration_ms: Option<i64>,
    own_nano_aiu: Option<i64>,
    follow_up_count: i64,
    peak_siblings: i64,
    turn_index: i64,
    event_index: Option<i64>,
}

fn to_i64(value: u64) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}

impl<'a> AgentRunRow<'a> {
    fn new(run: &'a AgentRun) -> Self {
        Self {
            run,
            started_at: run.started_at.map(|t| t.to_rfc3339()),
            ended_at: run.ended_at.map(|t| t.to_rfc3339()),
            outcome: run.outcome.as_str(),
            source: run.source.as_str(),
            depth: i64::from(run.depth),
            multi_turn: run.multi_turn.map(i64::from),
            configured_matches_actual: run.configured_matches_actual.map(i64::from),
            total_tool_calls: run.total_tool_calls.map(to_i64),
            total_tokens: run.total_tokens.map(to_i64),
            duration_ms: run.duration_ms.map(to_i64),
            own_nano_aiu: run.own_nano_aiu.map(to_i64),
            follow_up_count: i64::from(run.follow_up_count),
            peak_siblings: i64::from(run.peak_siblings),
            turn_index: to_i64(run.turn_index as u64),
            event_index: run.event_index.map(|i| to_i64(i as u64)),
        }
    }
}

struct SelectionRow {
    event_index: i64,
    agent_name: Option<String>,
    display_name: Option<String>,
    selected: i64,
    timestamp: Option<String>,
}

pub(super) fn write_agent_rows(
    conn: &Connection,
    session_id: &str,
    extraction: &AgentRunExtraction,
) -> Result<()> {
    let rows: Vec<AgentRunRow<'_>> = extraction.runs.iter().map(AgentRunRow::new).collect();
    batched_insert(
        conn,
        "INSERT OR REPLACE INTO session_agent_runs \
        (session_id, run_key, tool_call_id, agent_id, parent_run_key, parent_agent_name, depth, \
         agent_name, agent_type, display_name, description, execution_mode, started_at, ended_at, \
         outcome, error_text, requested_model, model, configured_model, configured_effort, \
         context_tier, multi_turn, first_dispatched_model, explicit_model_override, \
         model_override_reason, configured_model_preference, configured_matches_actual, \
         total_tool_calls, total_tokens, duration_ms, own_nano_aiu, follow_up_count, \
         peak_siblings, turn_index, event_index, source) VALUES",
        36,
        &rows,
        |row, params| {
            let run = row.run;
            let values: [&dyn ToSql; 36] = [
                &session_id,
                &run.run_key,
                &run.tool_call_id,
                &run.agent_id,
                &run.parent_run_key,
                &run.parent_agent_name,
                &row.depth,
                &run.agent_name,
                &run.agent_type,
                &run.display_name,
                &run.description,
                &run.execution_mode,
                &row.started_at,
                &row.ended_at,
                &row.outcome,
                &run.error_text,
                &run.requested_model,
                &run.model,
                &run.configured_model,
                &run.configured_effort,
                &run.context_tier,
                &row.multi_turn,
                &run.first_dispatched_model,
                &run.explicit_model_override,
                &run.model_override_reason,
                &run.configured_model_preference,
                &row.configured_matches_actual,
                &row.total_tool_calls,
                &row.total_tokens,
                &row.duration_ms,
                &row.own_nano_aiu,
                &row.follow_up_count,
                &row.peak_siblings,
                &row.turn_index,
                &row.event_index,
                &row.source,
            ];
            params.extend(values);
        },
    )?;

    let selections: Vec<SelectionRow> = extraction
        .selections
        .iter()
        .map(|selection| SelectionRow {
            event_index: to_i64(selection.event_index as u64),
            agent_name: selection.agent_name.clone(),
            display_name: selection.display_name.clone(),
            selected: i64::from(selection.selected),
            timestamp: selection.timestamp.map(|t| t.to_rfc3339()),
        })
        .collect();
    batched_insert(
        conn,
        "INSERT OR REPLACE INTO session_agent_selections \
        (session_id, event_index, agent_name, display_name, selected, timestamp) VALUES",
        6,
        &selections,
        |row, params| {
            params.push(&session_id as &dyn ToSql);
            params.push(&row.event_index);
            params.push(&row.agent_name);
            params.push(&row.display_name);
            params.push(&row.selected);
            params.push(&row.timestamp);
        },
    )
}
