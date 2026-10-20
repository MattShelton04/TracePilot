//! What a GitHub refresh needs to decide which lookups are due: each pull
//! request's last fetch, and each pushed branch's last lookup. Works on a
//! read-only connection.

use std::collections::HashSet;

use rusqlite::Row;
use tracepilot_core::ids::SessionId;
use tracepilot_core::pull_requests::PullRequestKey;

use super::IndexDb;
use crate::Result;

/// A pull request and what `pull_request_status` last recorded for it.
#[derive(Debug, Clone, PartialEq)]
pub struct PullRequestFetchState {
    pub key: PullRequestKey,
    /// None when GitHub has never been asked.
    pub fetched_at: Option<String>,
    /// `open`, `closed` or `merged`.
    pub state: Option<String>,
    pub is_draft: bool,
    pub error: Option<String>,
}

/// A branch the session pushed, and when GitHub was last asked about it.
#[derive(Debug, Clone, PartialEq)]
pub struct PushedBranchLookup {
    pub host: String,
    pub owner: String,
    pub repo: String,
    pub branch: String,
    pub first_push_at: Option<String>,
    /// The latest `fetched_at` of the branch's `session_branch_pull_requests`
    /// rows; None when never looked up.
    pub last_lookup_at: Option<String>,
}

/// A session's GitHub lookups.
#[derive(Debug, Clone, PartialEq)]
pub struct SessionPullRequestLookups {
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    /// Linked from the transcript or found for a pushed branch, once each.
    pub pull_requests: Vec<PullRequestFetchState>,
    pub branches: Vec<PushedBranchLookup>,
}

/// Status columns for a join of `pull_request_status` aliased `st`; the
/// status columns come first so the status table's NOCASE collation applies.
const FETCH_COLUMNS: &str = "st.fetched_at, st.state, st.is_draft, st.error";

fn fetch_state_from_row(row: &Row) -> rusqlite::Result<PullRequestFetchState> {
    let number: i64 = row.get("number")?;
    Ok(PullRequestFetchState {
        key: PullRequestKey {
            host: row.get("host")?,
            owner: row.get("owner")?,
            repo: row.get("repo")?,
            number: u32::try_from(number).unwrap_or(0),
        },
        fetched_at: row.get("fetched_at")?,
        state: row.get("state")?,
        is_draft: row.get::<_, Option<bool>>("is_draft")?.unwrap_or(false),
        error: row.get("error")?,
    })
}

/// Keep the first of each pull request, compared case-insensitively.
fn dedup(rows: Vec<PullRequestFetchState>) -> Vec<PullRequestFetchState> {
    let mut seen = HashSet::new();
    rows.into_iter()
        .filter(|row| row.key.number > 0 && seen.insert(row.key.identity()))
        .collect()
}

impl IndexDb {
    /// A session's pull requests and pushed branches with their last lookups,
    /// or None when the session is not indexed.
    pub fn session_pull_request_lookups(
        &self,
        session_id: &SessionId,
    ) -> Result<Option<SessionPullRequestLookups>> {
        let window = self.conn.query_row(
            "SELECT created_at, updated_at FROM sessions WHERE id = ?1",
            [session_id.as_str()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        );
        let (created_at, updated_at) = match window {
            Ok(window) => window,
            Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(None),
            Err(error) => return Err(error.into()),
        };

        let mut stmt = self.conn.prepare(&format!(
            "SELECT k.host, k.owner, k.repo, k.number, {FETCH_COLUMNS}
             FROM (SELECT host, owner, repo, number, 0 AS source
                   FROM session_pull_requests WHERE session_id = ?1
                   UNION ALL
                   SELECT host, owner, repo, number, 1 AS source
                   FROM session_branch_pull_requests WHERE session_id = ?1 AND number > 0) k
             LEFT JOIN pull_request_status st
               ON st.host = k.host AND st.owner = k.owner AND st.repo = k.repo
              AND st.number = k.number
             ORDER BY k.source, k.number DESC"
        ))?;
        let pull_requests = stmt
            .query_map([session_id.as_str()], fetch_state_from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        let mut stmt = self.conn.prepare(
            "SELECT pb.host, pb.owner, pb.repo, pb.branch, pb.first_push_at,
                    (SELECT MAX(b.fetched_at) FROM session_branch_pull_requests b
                     WHERE b.session_id = pb.session_id AND b.host = pb.host COLLATE NOCASE
                       AND b.owner = pb.owner COLLATE NOCASE
                       AND b.repo = pb.repo COLLATE NOCASE AND b.branch = pb.branch)
                    AS last_lookup_at
             FROM session_pushed_branches pb
             WHERE pb.session_id = ?1
             ORDER BY pb.first_push_at, pb.branch",
        )?;
        let branches = stmt
            .query_map([session_id.as_str()], |row| {
                Ok(PushedBranchLookup {
                    host: row.get("host")?,
                    owner: row.get("owner")?,
                    repo: row.get("repo")?,
                    branch: row.get("branch")?,
                    first_push_at: row.get("first_push_at")?,
                    last_lookup_at: row.get("last_lookup_at")?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        Ok(Some(SessionPullRequestLookups {
            created_at,
            updated_at,
            pull_requests: dedup(pull_requests),
            branches,
        }))
    }

    /// The primary pull request of each listed session that has one, with its
    /// last fetch, once each, in the order of `session_ids`.
    pub fn primary_pull_request_fetch_states(
        &self,
        session_ids: &[SessionId],
    ) -> Result<Vec<PullRequestFetchState>> {
        if session_ids.is_empty() {
            return Ok(Vec::new());
        }
        let ids = serde_json::to_string(
            &session_ids
                .iter()
                .map(SessionId::as_str)
                .collect::<Vec<_>>(),
        )?;
        let mut stmt = self.conn.prepare(&format!(
            "SELECT s.primary_pr_host AS host, s.primary_pr_owner AS owner,
                    s.primary_pr_repo AS repo, s.primary_pr_number AS number, {FETCH_COLUMNS}
             FROM json_each(?1) j
             JOIN sessions s ON s.id = j.value
             LEFT JOIN pull_request_status st
               ON st.host = s.primary_pr_host AND st.owner = s.primary_pr_owner
              AND st.repo = s.primary_pr_repo AND st.number = s.primary_pr_number
             WHERE s.primary_pr_host IS NOT NULL AND s.primary_pr_owner IS NOT NULL
               AND s.primary_pr_repo IS NOT NULL AND s.primary_pr_number IS NOT NULL
             ORDER BY j.key"
        ))?;
        let rows = stmt
            .query_map([ids], fetch_state_from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(dedup(rows))
    }
}
