//! Cross-session user turns per model and reasoning effort, from
//! `session_effort_usage`.

use crate::Result;
use rusqlite::{Connection, params_from_iter};

use tracepilot_core::effort_usage::EffortUsageEntry;

use super::super::helpers::to_refs;

/// Sum the rows of sessions matching `where_clause` (a
/// `build_date_repo_filter` clause over the `sessions s` alias) per model and
/// effort, most user turns first.
pub(super) fn query_effort_usage(
    conn: &Connection,
    where_clause: &str,
    bind_values: &[String],
) -> Result<Vec<EffortUsageEntry>> {
    let sql = format!(
        "SELECT e.model, e.reasoning_effort, COUNT(DISTINCT e.session_id),
                SUM(e.user_turns), SUM(e.agent_turns), SUM(e.tool_calls), SUM(e.wall_ms),
                SUM(e.observed_user_turns), SUM(e.requests), SUM(e.reasoning_tokens),
                SUM(e.output_tokens), SUM(e.api_duration_ms), SUM(e.total_nano_aiu),
                SUM(e.subagent_requests), SUM(e.subagent_nano_aiu)
         FROM session_effort_usage e
         JOIN sessions s ON s.id = e.session_id{where_clause}
         GROUP BY e.model, e.reasoning_effort
         ORDER BY SUM(e.user_turns) DESC, e.model, e.reasoning_effort"
    );
    let refs = to_refs(bind_values);
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(refs.iter().copied()), |row| {
        let text = |index: usize| -> rusqlite::Result<Option<String>> {
            Ok(row.get::<_, String>(index).ok().filter(|v| !v.is_empty()))
        };
        let count = |index: usize| -> rusqlite::Result<u32> {
            Ok(u32::try_from(row.get::<_, i64>(index)?.max(0)).unwrap_or(u32::MAX))
        };
        let total =
            |index: usize| -> rusqlite::Result<u64> { Ok(row.get::<_, i64>(index)?.max(0) as u64) };
        Ok(EffortUsageEntry {
            model: text(0)?,
            reasoning_effort: text(1)?,
            sessions: count(2)?,
            user_turns: count(3)?,
            agent_turns: count(4)?,
            tool_calls: count(5)?,
            wall_ms: total(6)?,
            observed_user_turns: count(7)?,
            requests: count(8)?,
            reasoning_tokens: total(9)?,
            output_tokens: total(10)?,
            api_duration_ms: total(11)?,
            nano_aiu: total(12)?,
            subagent_requests: count(13)?,
            subagent_nano_aiu: total(14)?,
        })
    })?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}
