//! Cross-session skill usage from `session_skill_invocations`.
//!
//! Rows load once per request and aggregate in Rust: the per-skill medians,
//! path groupings and trigger splits are awkward in SQLite, and even a heavy
//! local corpus holds only a few hundred invocations.

mod stats;

use rusqlite::{Connection, params_from_iter};

use crate::Result;
use tracepilot_core::analytics::{SkillUsageDetail, SkillUsageSummary};

use super::super::helpers::to_refs;

/// Date range (inclusive `YYYY-MM-DD`, UTC) and repository filter.
#[derive(Debug, Clone, Copy, Default)]
pub(super) struct SkillUsageFilter<'a> {
    pub from_date: Option<&'a str>,
    pub to_date: Option<&'a str>,
    pub repo: Option<&'a str>,
}

/// One indexed invocation joined with its session.
#[derive(Debug, Clone)]
pub(super) struct InvocationRow {
    pub session_id: String,
    pub session_summary: Option<String>,
    pub repository: Option<String>,
    pub turn_index: u64,
    pub event_index: u64,
    /// Invocation time, falling back to the session start for older logs.
    pub timestamp: Option<String>,
    pub skill_name: String,
    pub normalized_name: String,
    pub skill_path: Option<String>,
    pub normalized_directory: Option<String>,
    pub description: Option<String>,
    pub source: Option<String>,
    pub trigger: Option<String>,
    pub agent_name: Option<String>,
    pub agent_id: Option<String>,
    pub model: Option<String>,
    pub plugin_name: Option<String>,
    pub content_sha256: Option<String>,
    pub content_tokens: Option<u64>,
    pub origin: String,
}

impl InvocationRow {
    pub(super) fn date(&self) -> Option<&str> {
        self.timestamp.as_deref().and_then(|time| time.get(..10))
    }

    /// The main agent is the absence of an owning agent, not a named one.
    pub(super) fn invoked_by(&self) -> &str {
        match self.agent_name.as_deref() {
            Some(name) => name,
            None if self.agent_id.is_some() => "Unnamed subagent",
            None => "Main agent",
        }
    }
}

const TIMESTAMP: &str = "COALESCE(i.timestamp, s.created_at)";

/// Load invocations in the range, newest first.
fn load_invocations(
    conn: &Connection,
    filter: SkillUsageFilter<'_>,
    normalized_name: Option<&str>,
) -> Result<Vec<InvocationRow>> {
    let mut clause = String::from(" WHERE 1=1");
    let mut values: Vec<String> = Vec::new();
    if let Some(from) = filter.from_date {
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
    if let Some(name) = normalized_name {
        clause.push_str(" AND i.normalized_name = ?");
        values.push(name.to_string());
    }
    let sql = format!(
        "SELECT i.session_id, s.summary, s.repository, i.turn_index, i.event_index, {TIMESTAMP},
                i.skill_name, i.normalized_name, i.skill_path, i.normalized_directory,
                i.description, i.source, i.trigger, i.agent_name, i.agent_id, i.model,
                i.plugin_name, i.content_sha256,
                COALESCE(i.frontmatter_tokens, 0) + COALESCE(i.instruction_tokens, 0),
                i.frontmatter_tokens IS NULL AND i.instruction_tokens IS NULL, i.origin
         FROM session_skill_invocations i
         JOIN sessions s ON s.id = i.session_id{clause}
         ORDER BY {TIMESTAMP} DESC, i.session_id, i.event_index DESC"
    );
    let refs = to_refs(&values);
    let mut stmt = conn.prepare(&sql)?;
    let unsigned = |value: Option<i64>| value.and_then(|value| u64::try_from(value).ok());
    let rows = stmt.query_map(params_from_iter(refs.iter().copied()), |row| {
        // A fallback row records no content at all, which is different from
        // content that happened to estimate at zero tokens.
        let no_content: bool = row.get::<_, i64>(19)? != 0;
        Ok(InvocationRow {
            session_id: row.get(0)?,
            session_summary: row.get(1)?,
            repository: row.get(2)?,
            turn_index: unsigned(row.get(3)?).unwrap_or(0),
            event_index: unsigned(row.get(4)?).unwrap_or(0),
            timestamp: row.get(5)?,
            skill_name: row.get(6)?,
            normalized_name: row.get(7)?,
            skill_path: row.get(8)?,
            normalized_directory: row.get(9)?,
            description: row.get(10)?,
            source: row.get(11)?,
            trigger: row.get(12)?,
            agent_name: row.get(13)?,
            agent_id: row.get(14)?,
            model: row.get(15)?,
            plugin_name: row.get(16)?,
            content_sha256: row.get(17)?,
            content_tokens: if no_content {
                None
            } else {
                unsigned(row.get(18)?)
            },
            origin: row.get(20)?,
        })
    })?;
    rows.collect::<std::result::Result<_, _>>()
        .map_err(Into::into)
}

pub(super) fn query_skill_usage_summary(
    conn: &Connection,
    filter: SkillUsageFilter<'_>,
) -> Result<SkillUsageSummary> {
    Ok(stats::summarize(&load_invocations(conn, filter, None)?))
}

pub(super) fn query_skill_usage_detail(
    conn: &Connection,
    filter: SkillUsageFilter<'_>,
    skill_name: &str,
) -> Result<SkillUsageDetail> {
    let normalized = skill_name.trim().to_lowercase();
    let rows = load_invocations(conn, filter, Some(&normalized))?;
    Ok(stats::build_detail(&rows))
}
