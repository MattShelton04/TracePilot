//! Cross-session agent usage from `session_agent_runs`.
//!
//! Rows are loaded once per request and aggregated in Rust: the per-agent
//! percentiles, trend window and outcome splits are awkward in SQLite, and a
//! heavy local corpus holds only a few thousand runs.

mod detail;
mod stats;

use chrono::{Duration, NaiveDate};
use rusqlite::{Connection, params_from_iter};

use crate::Result;
use tracepilot_core::analytics::{AgentSelectionStats, AgentUsageDetail, AgentUsageSummary};

use super::super::helpers::to_refs;

pub(super) use detail::build_detail;

/// Date range (inclusive `YYYY-MM-DD`, UTC) and repository filter.
#[derive(Debug, Clone, Copy, Default)]
pub(super) struct AgentRunFilter<'a> {
    pub from_date: Option<&'a str>,
    pub to_date: Option<&'a str>,
    pub repo: Option<&'a str>,
}

impl AgentRunFilter<'_> {
    /// The equally long window immediately before a bounded range.
    fn previous_window(&self) -> Option<(String, String)> {
        let from = NaiveDate::parse_from_str(self.from_date?, "%Y-%m-%d").ok()?;
        let to = NaiveDate::parse_from_str(self.to_date?, "%Y-%m-%d").ok()?;
        let days = (to - from).num_days() + 1;
        if days <= 0 {
            return None;
        }
        let previous_to = from - Duration::days(1);
        let previous_from = from - Duration::days(days);
        Some((
            previous_from.format("%Y-%m-%d").to_string(),
            previous_to.format("%Y-%m-%d").to_string(),
        ))
    }
}

/// One indexed run joined with its session.
#[derive(Debug, Clone)]
pub(super) struct RunRow {
    pub session_id: String,
    pub session_summary: Option<String>,
    pub repository: Option<String>,
    pub run_key: String,
    pub tool_call_id: Option<String>,
    pub agent_name: String,
    pub agent_type: Option<String>,
    pub display_name: Option<String>,
    pub description: Option<String>,
    pub execution_mode: Option<String>,
    /// Run start, falling back to the session start for older logs.
    pub timestamp: Option<String>,
    pub outcome: String,
    pub error_text: Option<String>,
    pub model: Option<String>,
    pub configured_model: Option<String>,
    pub first_dispatched_model: Option<String>,
    pub model_override_reason: Option<String>,
    pub configured_matches_actual: Option<bool>,
    pub multi_turn: Option<bool>,
    pub total_tool_calls: Option<u64>,
    pub total_tokens: Option<u64>,
    pub duration_ms: Option<u64>,
    pub own_nano_aiu: Option<u64>,
    pub follow_up_count: u64,
    pub messages_sent: u64,
    pub messages_received: u64,
    pub peer_messages: u64,
    pub queued_messages: u64,
    pub depth: u32,
    pub peak_siblings: u32,
    pub parent_agent_name: Option<String>,
    pub turn_index: u64,
    pub event_index: Option<u64>,
    /// Inside the requested range (as opposed to the trend window before it).
    pub in_range: bool,
}

impl RunRow {
    pub(super) fn date(&self) -> Option<&str> {
        self.timestamp.as_deref().and_then(|t| t.get(..10))
    }
}

const TIMESTAMP: &str = "COALESCE(r.started_at, s.created_at)";

/// Load runs in the range plus the trend window before it.
pub(super) fn load_runs(
    conn: &Connection,
    filter: AgentRunFilter<'_>,
    agent_name: Option<&str>,
) -> Result<Vec<RunRow>> {
    let previous = filter.previous_window();
    let mut clause = String::from(" WHERE 1=1");
    let mut values: Vec<String> = Vec::new();
    // The lower bound reaches back into the trend window when there is one.
    if let Some(from) = previous
        .as_ref()
        .map(|(from, _)| from.as_str())
        .or(filter.from_date)
    {
        clause.push_str(&format!(" AND date({TIMESTAMP}) >= ?"));
        values.push(from.to_string());
    }
    if let Some(to) = filter.to_date {
        clause.push_str(&format!(" AND date({TIMESTAMP}) <= ?"));
        values.push(to.to_string());
    }
    if let Some(repo) = filter.repo {
        clause.push_str(" AND s.repository = ?");
        values.push(repo.to_string());
    }
    if let Some(name) = agent_name {
        clause.push_str(" AND r.agent_name = ? COLLATE NOCASE");
        values.push(name.to_string());
    }
    let sql = format!(
        "SELECT r.session_id, s.summary, s.repository, r.run_key, r.tool_call_id, r.agent_name,
                r.agent_type, r.display_name, r.description, r.execution_mode, {TIMESTAMP},
                r.outcome, r.error_text, r.model, r.configured_model, r.first_dispatched_model,
                r.model_override_reason, r.configured_matches_actual, r.multi_turn,
                r.total_tool_calls, r.total_tokens, r.duration_ms, r.own_nano_aiu,
                r.follow_up_count, r.depth, r.peak_siblings, r.parent_agent_name,
                r.turn_index, r.event_index, r.messages_sent, r.messages_received,
                r.peer_messages, r.queued_messages
         FROM session_agent_runs r
         JOIN sessions s ON s.id = r.session_id{clause}
         ORDER BY {TIMESTAMP} DESC, r.session_id, r.run_key"
    );
    let refs = to_refs(&values);
    let mut stmt = conn.prepare(&sql)?;
    let unsigned = |value: Option<i64>| value.and_then(|v| u64::try_from(v).ok());
    let rows = stmt.query_map(params_from_iter(refs.iter().copied()), |row| {
        Ok(RunRow {
            session_id: row.get(0)?,
            session_summary: row.get(1)?,
            repository: row.get(2)?,
            run_key: row.get(3)?,
            tool_call_id: row.get(4)?,
            agent_name: row.get(5)?,
            agent_type: row.get(6)?,
            display_name: row.get(7)?,
            description: row.get(8)?,
            execution_mode: row.get(9)?,
            timestamp: row.get(10)?,
            outcome: row.get(11)?,
            error_text: row.get(12)?,
            model: row.get(13)?,
            configured_model: row.get(14)?,
            first_dispatched_model: row.get(15)?,
            model_override_reason: row.get(16)?,
            configured_matches_actual: row.get::<_, Option<i64>>(17)?.map(|v| v != 0),
            multi_turn: row.get::<_, Option<i64>>(18)?.map(|v| v != 0),
            total_tool_calls: unsigned(row.get(19)?),
            total_tokens: unsigned(row.get(20)?),
            duration_ms: unsigned(row.get(21)?),
            own_nano_aiu: unsigned(row.get(22)?),
            follow_up_count: unsigned(row.get(23)?).unwrap_or(0),
            depth: row.get::<_, i64>(24)?.clamp(0, i64::from(u32::MAX)) as u32,
            peak_siblings: row.get::<_, i64>(25)?.clamp(1, i64::from(u32::MAX)) as u32,
            parent_agent_name: row.get(26)?,
            turn_index: unsigned(row.get(27)?).unwrap_or(0),
            event_index: unsigned(row.get(28)?),
            messages_sent: unsigned(row.get(29)?).unwrap_or(0),
            messages_received: unsigned(row.get(30)?).unwrap_or(0),
            peer_messages: unsigned(row.get(31)?).unwrap_or(0),
            queued_messages: unsigned(row.get(32)?).unwrap_or(0),
            in_range: true,
        })
    })?;
    let mut result = Vec::new();
    for row in rows {
        let mut row = row?;
        if let (Some((_, previous_to)), Some(date)) = (previous.as_ref(), row.date()) {
            row.in_range = date > previous_to.as_str();
        }
        result.push(row);
    }
    Ok(result)
}

pub(super) fn query_agent_usage_summary(
    conn: &Connection,
    filter: AgentRunFilter<'_>,
) -> Result<AgentUsageSummary> {
    let rows = load_runs(conn, filter, None)?;
    let mut summary = stats::summarize(&rows);
    summary.main_agent_selections = query_selections(conn, filter)?;
    Ok(summary)
}

pub(super) fn query_agent_usage_detail(
    conn: &Connection,
    filter: AgentRunFilter<'_>,
    agent_name: &str,
) -> Result<AgentUsageDetail> {
    let rows = load_runs(conn, filter, Some(agent_name))?;
    Ok(build_detail(&rows))
}

fn query_selections(
    conn: &Connection,
    filter: AgentRunFilter<'_>,
) -> Result<Vec<AgentSelectionStats>> {
    let timestamp = "COALESCE(a.timestamp, s.created_at)";
    let mut clause = String::from(" WHERE a.selected = 1 AND a.agent_name IS NOT NULL");
    let mut values: Vec<String> = Vec::new();
    if let Some(from) = filter.from_date {
        clause.push_str(&format!(" AND date({timestamp}) >= ?"));
        values.push(from.to_string());
    }
    if let Some(to) = filter.to_date {
        clause.push_str(&format!(" AND date({timestamp}) <= ?"));
        values.push(to.to_string());
    }
    if let Some(repo) = filter.repo {
        clause.push_str(" AND s.repository = ?");
        values.push(repo.to_string());
    }
    let sql = format!(
        "SELECT MAX(a.agent_name), MAX(a.display_name), COUNT(DISTINCT a.session_id),
                MAX({timestamp})
         FROM session_agent_selections a
         JOIN sessions s ON s.id = a.session_id{clause}
         GROUP BY LOWER(a.agent_name)
         ORDER BY COUNT(DISTINCT a.session_id) DESC, LOWER(a.agent_name)"
    );
    let refs = to_refs(&values);
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(refs.iter().copied()), |row| {
        Ok(AgentSelectionStats {
            name: row.get(0)?,
            display_name: row.get(1)?,
            sessions: row.get::<_, i64>(2)?.max(0) as u64,
            last_selected: row.get(3)?,
        })
    })?;
    rows.collect::<std::result::Result<_, _>>()
        .map_err(Into::into)
}
