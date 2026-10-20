//! Reads a session's linked pull requests, with their last known GitHub state.

use rusqlite::Row;
use tracepilot_core::ids::SessionId;
use tracepilot_core::pull_requests::{PullRequestKey, PullRequestRoles};

use super::IndexDb;
use crate::Result;

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
        let mut stmt = self.conn.prepare(
            "SELECT p.host, p.owner, p.repo, p.number, p.roles, p.is_primary, p.head_ref,
                    p.base_ref, p.title, p.first_seen_at, p.last_seen_at, p.event_index,
                    st.state, st.is_draft, st.title AS status_title, st.merged_at,
                    st.closed_at, st.review_decision, st.checks_state, st.fetched_at, st.error
             FROM session_pull_requests p
             LEFT JOIN pull_request_status st
               ON st.host = p.host AND st.owner = p.owner AND st.repo = p.repo
              AND st.number = p.number
             WHERE p.session_id = ?1
             ORDER BY p.is_primary DESC,
                      CASE WHEN p.roles & 1 THEN 0 WHEN p.roles & 2 THEN 1
                           WHEN p.roles & 4 THEN 2 WHEN p.roles & 8 THEN 3 ELSE 4 END,
                      p.last_seen_at DESC, p.number DESC",
        )?;
        let rows = stmt.query_map([session_id.as_str()], pull_request_from_row)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }
}
