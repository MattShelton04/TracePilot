//! Sessions that share a pull request: how many other sessions link each of a
//! session's pull requests, and which sessions link one.
//!
//! A pull request is the same one when host, owner and repository match
//! ignoring case and the number matches. Owner and repository compare with
//! `COLLATE NOCASE`, the collation of `idx_session_pull_requests_pr`, so both
//! reads look the other side up through that index.

use tracepilot_core::ids::SessionId;
use tracepilot_core::provider::SessionSource;
use tracepilot_core::pull_requests::{PullRequestKey, PullRequestRoles};

use super::IndexDb;
use super::row_helpers::session_source_from_row;
use crate::Result;

/// The most sessions [`IndexDb::get_pull_request_sessions`] returns.
pub const MAX_PULL_REQUEST_SESSIONS: usize = 100;

/// Other sessions linking each of `?1`'s pull requests. The self-join reads
/// `o` through `idx_session_pull_requests_pr`, `p` through the primary key.
const RELATED_COUNTS_SQL: &str =
    "SELECT p.host, p.owner, p.repo, p.number, COUNT(DISTINCT o.session_id)
     FROM session_pull_requests p
     JOIN session_pull_requests o
       ON o.owner = p.owner COLLATE NOCASE AND o.repo = p.repo COLLATE NOCASE
      AND o.number = p.number AND o.host = p.host COLLATE NOCASE
      AND o.session_id <> p.session_id
     WHERE p.session_id = ?1
     GROUP BY p.host, p.owner, p.repo, p.number
     ORDER BY p.owner COLLATE NOCASE, p.repo COLLATE NOCASE, p.number";

/// Sessions linking host `?1`, `?2/?3#?4`, at most `?5`.
const PULL_REQUEST_SESSIONS_SQL: &str =
    "SELECT p.session_id, s.summary, s.repository, s.source, s.updated_at, p.roles
     FROM session_pull_requests p
     JOIN sessions s ON s.id = p.session_id
     WHERE p.owner = ?2 COLLATE NOCASE AND p.repo = ?3 COLLATE NOCASE
       AND p.number = ?4 AND p.host = ?1 COLLATE NOCASE
     ORDER BY s.updated_at DESC, p.session_id
     LIMIT ?5";

/// One of a session's pull requests, with how many other sessions link it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IndexedRelatedPullRequestCount {
    /// As the asking session's row spells it.
    pub key: PullRequestKey,
    /// At least 1.
    pub other_session_count: u32,
}

/// A session linked to a pull request.
#[derive(Debug, Clone, PartialEq)]
pub struct IndexedPullRequestSession {
    pub session_id: String,
    pub summary: Option<String>,
    pub repository: Option<String>,
    pub source: SessionSource,
    pub updated_at: Option<String>,
    pub roles: PullRequestRoles,
}

impl IndexDb {
    /// For each pull request `session_id` links that another session links
    /// too, how many other sessions do. Pull requests only this session
    /// links are left out. Ordered by owner, repository and number.
    pub fn get_session_pull_request_related_counts(
        &self,
        session_id: &SessionId,
    ) -> Result<Vec<IndexedRelatedPullRequestCount>> {
        let mut stmt = self.conn.prepare(RELATED_COUNTS_SQL)?;
        let rows = stmt.query_map([session_id.as_str()], |row| {
            let number: i64 = row.get(3)?;
            let count: i64 = row.get(4)?;
            Ok(IndexedRelatedPullRequestCount {
                key: PullRequestKey {
                    host: row.get(0)?,
                    owner: row.get(1)?,
                    repo: row.get(2)?,
                    number: u32::try_from(number).unwrap_or(0),
                },
                other_session_count: u32::try_from(count).unwrap_or(u32::MAX),
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// Every session linked to `key` (case-insensitively), most recently
    /// updated first, up to [`MAX_PULL_REQUEST_SESSIONS`].
    pub fn get_pull_request_sessions(
        &self,
        key: &PullRequestKey,
    ) -> Result<Vec<IndexedPullRequestSession>> {
        let mut stmt = self.conn.prepare(PULL_REQUEST_SESSIONS_SQL)?;
        let rows = stmt.query_map(
            rusqlite::params![
                key.host,
                key.owner,
                key.repo,
                i64::from(key.number),
                MAX_PULL_REQUEST_SESSIONS as i64
            ],
            |row| {
                Ok(IndexedPullRequestSession {
                    session_id: row.get("session_id")?,
                    summary: row.get("summary")?,
                    repository: row.get("repository")?,
                    source: session_source_from_row(row)?,
                    updated_at: row.get("updated_at")?,
                    roles: PullRequestRoles::from_bits(row.get("roles")?),
                })
            },
        )?;
        let mut sessions: Vec<IndexedPullRequestSession> = Vec::new();
        for row in rows {
            let row = row?;
            // The extractor keeps one row per pull request and session, but
            // rows spelled in two cases would list a session twice; they sort
            // together, so merge their roles.
            match sessions.last_mut() {
                Some(last) if last.session_id == row.session_id => {
                    for role in row.roles.iter() {
                        last.roles.insert(role);
                    }
                }
                _ => sessions.push(row),
            }
        }
        Ok(sessions)
    }
}

#[cfg(test)]
#[path = "pull_request_links_tests.rs"]
mod tests;
