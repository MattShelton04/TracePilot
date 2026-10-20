//! Reads a session's linked pull requests, with their last known GitHub state.

use std::collections::HashMap;

use rusqlite::Row;
use tracepilot_core::ids::SessionId;
use tracepilot_core::pull_requests::{PullRequestKey, PullRequestRoles};

use super::IndexDb;
use super::types::IndexedSession;
use crate::Result;

/// The most linked pull requests one list item carries. Orchestrator
/// sessions merge up to a few hundred; the detail view reads them all.
pub const MAX_LISTED_PULL_REQUESTS: usize = 200;

/// `ORDER BY` terms for one session's pull requests: the primary first, then
/// by strongest role, then most recent.
const SESSION_PR_ORDER: &str = "p.is_primary DESC,
     CASE WHEN p.roles & 1 THEN 0 WHEN p.roles & 2 THEN 1
          WHEN p.roles & 4 THEN 2 WHEN p.roles & 8 THEN 3 ELSE 4 END,
     p.last_seen_at DESC, p.number DESC";

/// A pull request's last known state on GitHub (`pull_request_status`).
#[derive(Debug, Clone, PartialEq)]
pub struct IndexedPullRequestStatus {
    /// `open`, `closed` or `merged`.
    pub state: Option<String>,
    pub is_draft: bool,
    pub title: Option<String>,
    pub merged_at: Option<String>,
    pub closed_at: Option<String>,
    pub review_decision: Option<String>,
    pub checks_state: Option<String>,
    pub fetched_at: String,
    pub error: Option<String>,
}

/// One row of `session_pull_requests`, joined to its status when known.
#[derive(Debug, Clone, PartialEq)]
pub struct IndexedPullRequest {
    pub key: PullRequestKey,
    pub roles: PullRequestRoles,
    pub primary: bool,
    pub head_ref: Option<String>,
    pub base_ref: Option<String>,
    pub title: Option<String>,
    pub first_seen_at: Option<String>,
    pub last_seen_at: Option<String>,
    pub event_index: Option<i64>,
    pub status: Option<IndexedPullRequestStatus>,
}

/// The pull request that stands for a session in the list.
#[derive(Debug, Clone, PartialEq)]
pub struct IndexedPrimaryPullRequest {
    pub key: PullRequestKey,
    /// `open`, `draft`, `closed` or `merged`, once GitHub has been asked.
    pub state: Option<String>,
}

/// A linked pull request as the session list carries it, for searching the
/// list by number, repository and title.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IndexedPullRequestSummary {
    pub owner: String,
    pub repo: String,
    pub number: u32,
    /// GitHub's title when it has been fetched, else the transcript's.
    pub title: Option<String>,
}

/// List columns for the primary pull request, for a query over `sessions`
/// aliased `alias`.
pub(super) fn primary_pr_columns(alias: &str) -> String {
    format!(
        "{alias}.linked_pr_count, {alias}.primary_pr_host, {alias}.primary_pr_owner, \
         {alias}.primary_pr_repo, {alias}.primary_pr_number, \
         (SELECT CASE WHEN st.state = 'open' AND st.is_draft = 1 THEN 'draft' ELSE st.state END \
          FROM pull_request_status st \
          WHERE st.host = {alias}.primary_pr_host AND st.owner = {alias}.primary_pr_owner \
            AND st.repo = {alias}.primary_pr_repo AND st.number = {alias}.primary_pr_number) \
         AS primary_pr_state"
    )
}

/// Read the columns [`primary_pr_columns`] selects.
pub(super) fn primary_pr_from_row(
    row: &Row,
) -> rusqlite::Result<(i64, Option<IndexedPrimaryPullRequest>)> {
    let count: i64 = row.get("linked_pr_count")?;
    let host: Option<String> = row.get("primary_pr_host")?;
    let owner: Option<String> = row.get("primary_pr_owner")?;
    let repo: Option<String> = row.get("primary_pr_repo")?;
    let number: Option<i64> = row.get("primary_pr_number")?;
    let primary = match (
        host,
        owner,
        repo,
        number.and_then(|n| u32::try_from(n).ok()),
    ) {
        (Some(host), Some(owner), Some(repo), Some(number)) => Some(IndexedPrimaryPullRequest {
            key: PullRequestKey {
                host,
                owner,
                repo,
                number,
            },
            state: row.get("primary_pr_state")?,
        }),
        _ => None,
    };
    Ok((count, primary))
}

fn pull_request_from_row(row: &Row) -> rusqlite::Result<IndexedPullRequest> {
    let number: i64 = row.get("number")?;
    let fetched_at: Option<String> = row.get("fetched_at")?;
    let status = match fetched_at {
        Some(fetched_at) => Some(IndexedPullRequestStatus {
            state: row.get("state")?,
            is_draft: row.get::<_, Option<bool>>("is_draft")?.unwrap_or(false),
            title: row.get("status_title")?,
            merged_at: row.get("merged_at")?,
            closed_at: row.get("closed_at")?,
            review_decision: row.get("review_decision")?,
            checks_state: row.get("checks_state")?,
            fetched_at,
            error: row.get("error")?,
        }),
        None => None,
    };
    Ok(IndexedPullRequest {
        key: PullRequestKey {
            host: row.get("host")?,
            owner: row.get("owner")?,
            repo: row.get("repo")?,
            number: u32::try_from(number).unwrap_or(0),
        },
        roles: PullRequestRoles::from_bits(row.get("roles")?),
        primary: row.get("is_primary")?,
        head_ref: row.get("head_ref")?,
        base_ref: row.get("base_ref")?,
        title: row.get("title")?,
        first_seen_at: row.get("first_seen_at")?,
        last_seen_at: row.get("last_seen_at")?,
        event_index: row.get("event_index")?,
        status,
    })
}

impl IndexDb {
    /// The session's linked pull requests: the primary one first, then by
    /// strongest role, then most recent.
    pub fn get_session_pull_requests(
        &self,
        session_id: &SessionId,
    ) -> Result<Vec<IndexedPullRequest>> {
        let mut stmt = self.conn.prepare(&format!(
            "SELECT p.host, p.owner, p.repo, p.number, p.roles, p.is_primary, p.head_ref,
                    p.base_ref, p.title, p.first_seen_at, p.last_seen_at, p.event_index,
                    st.state, st.is_draft, st.title AS status_title, st.merged_at,
                    st.closed_at, st.review_decision, st.checks_state, st.fetched_at, st.error
             FROM session_pull_requests p
             LEFT JOIN pull_request_status st
               ON st.host = p.host AND st.owner = p.owner AND st.repo = p.repo
              AND st.number = p.number
             WHERE p.session_id = ?1
             ORDER BY {SESSION_PR_ORDER}"
        ))?;
        let rows = stmt.query_map([session_id.as_str()], pull_request_from_row)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// Fill each listed session's `pull_requests`, in the detail view's
    /// order and up to [`MAX_LISTED_PULL_REQUESTS`] each, with one query for
    /// the whole list. Only sessions that link any are looked up.
    pub(super) fn attach_listed_pull_requests(
        &self,
        sessions: &mut [IndexedSession],
    ) -> Result<()> {
        let ids: Vec<&str> = sessions
            .iter()
            .filter(|session| session.linked_pr_count > 0)
            .map(|session| session.id.as_str())
            .collect();
        if ids.is_empty() {
            return Ok(());
        }
        let mut stmt = self.conn.prepare(&format!(
            "SELECT p.session_id, p.owner, p.repo, p.number, COALESCE(st.title, p.title)
             FROM session_pull_requests p
             LEFT JOIN pull_request_status st
               ON st.host = p.host AND st.owner = p.owner AND st.repo = p.repo
              AND st.number = p.number
             WHERE p.session_id IN (SELECT value FROM json_each(?1))
             ORDER BY p.session_id, {SESSION_PR_ORDER}"
        ))?;
        let rows = stmt.query_map([serde_json::to_string(&ids)?], |row| {
            let number: i64 = row.get(3)?;
            Ok((
                row.get::<_, String>(0)?,
                IndexedPullRequestSummary {
                    owner: row.get(1)?,
                    repo: row.get(2)?,
                    number: u32::try_from(number).unwrap_or(0),
                    title: row.get(4)?,
                },
            ))
        })?;
        let mut by_session: HashMap<String, Vec<IndexedPullRequestSummary>> = HashMap::new();
        for row in rows {
            let (session_id, pull_request) = row?;
            let listed = by_session.entry(session_id).or_default();
            if listed.len() < MAX_LISTED_PULL_REQUESTS {
                listed.push(pull_request);
            }
        }
        for session in sessions {
            if let Some(listed) = by_session.remove(&session.id) {
                session.pull_requests = listed;
            }
        }
        Ok(())
    }
}
