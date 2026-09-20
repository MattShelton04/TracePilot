//! Skill-invocation rows written at index time.

use crate::Result;
use rusqlite::{Connection, ToSql};
use tracepilot_core::skill_invocations::SkillInvocation;

use super::super::batch_insert::batched_insert;

/// Owned, SQL-ready form of a [`SkillInvocation`].
struct SkillInvocationRow<'a> {
    invocation: &'a SkillInvocation,
    event_index: i64,
    turn_index: i64,
    timestamp: Option<String>,
    frontmatter_tokens: Option<i64>,
    instruction_tokens: Option<i64>,
    origin: &'static str,
}

impl<'a> SkillInvocationRow<'a> {
    fn new(invocation: &'a SkillInvocation) -> Self {
        Self {
            invocation,
            event_index: i64::try_from(invocation.event_index).unwrap_or(i64::MAX),
            turn_index: i64::try_from(invocation.turn_index).unwrap_or(i64::MAX),
            timestamp: invocation.timestamp.map(|time| time.to_rfc3339()),
            frontmatter_tokens: invocation.frontmatter_tokens.map(i64::from),
            instruction_tokens: invocation.instruction_tokens.map(i64::from),
            origin: invocation.origin.as_str(),
        }
    }
}

pub(super) fn write_skill_invocation_rows(
    conn: &Connection,
    session_id: &str,
    invocations: &[SkillInvocation],
) -> Result<()> {
    let rows: Vec<SkillInvocationRow<'_>> =
        invocations.iter().map(SkillInvocationRow::new).collect();
    batched_insert(
        conn,
        "INSERT OR REPLACE INTO session_skill_invocations \
        (session_id, event_index, turn_index, tool_call_id, timestamp, skill_name, \
         normalized_name, skill_path, normalized_directory, description, source, trigger, \
         agent_id, agent_name, model, plugin_name, plugin_version, content_sha256, \
         frontmatter_tokens, instruction_tokens, origin) VALUES",
        21,
        &rows,
        |row, params| {
            let invocation = row.invocation;
            let values: [&dyn ToSql; 21] = [
                &session_id,
                &row.event_index,
                &row.turn_index,
                &invocation.tool_call_id,
                &row.timestamp,
                &invocation.name,
                &invocation.normalized_name,
                &invocation.path,
                &invocation.normalized_directory,
                &invocation.description,
                &invocation.source,
                &invocation.trigger,
                &invocation.agent_id,
                &invocation.agent_name,
                &invocation.model,
                &invocation.plugin_name,
                &invocation.plugin_version,
                &invocation.content_sha256,
                &row.frontmatter_tokens,
                &row.instruction_tokens,
                &row.origin,
            ];
            params.extend(values);
        },
    )
}
