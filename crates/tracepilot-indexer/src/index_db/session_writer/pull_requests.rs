//! Linked pull requests and pushed branches written at index time.

use rusqlite::{Connection, ToSql};
use tracepilot_core::pull_requests::{LinkedPullRequest, PushedBranch, SessionPullRequests};

use super::super::batch_insert::batched_insert;
use crate::Result;

/// SQL-ready form of a [`LinkedPullRequest`].
struct PullRequestRow<'a> {
    pr: &'a LinkedPullRequest,
    number: i64,
    roles: i64,
    evidence: i64,
    first_seen_at: Option<String>,
    last_seen_at: Option<String>,
    event_index: Option<i64>,
}

impl<'a> PullRequestRow<'a> {
    fn new(pr: &'a LinkedPullRequest) -> Self {
        Self {
            pr,
            number: i64::from(pr.key.number),
            roles: i64::from(pr.roles.bits()),
            evidence: i64::from(pr.evidence.bits()),
            first_seen_at: pr.first_seen_at.map(|time| time.to_rfc3339()),
            last_seen_at: pr.last_seen_at.map(|time| time.to_rfc3339()),
            event_index: pr.event_index.and_then(|index| i64::try_from(index).ok()),
        }
    }
}

/// SQL-ready form of a [`PushedBranch`].
struct PushedBranchRow<'a> {
    branch: &'a PushedBranch,
    first_push_at: Option<String>,
    last_push_at: Option<String>,
    push_count: i64,
}

/// Write the session's pull requests and pushed branches (its old rows are
/// already gone) and its primary pull request on `sessions`.
pub(super) fn write(
    conn: &Connection,
    session_id: &str,
    links: &SessionPullRequests,
) -> Result<()> {
    let rows: Vec<PullRequestRow<'_>> = links
        .pull_requests
        .iter()
        .map(PullRequestRow::new)
        .collect();
    batched_insert(
        conn,
        "INSERT OR REPLACE INTO session_pull_requests \
        (session_id, host, owner, repo, number, roles, evidence, is_primary, head_ref, \
         base_ref, title, first_seen_at, last_seen_at, event_index) VALUES",
        14,
        &rows,
        |row, params| {
            let pr = row.pr;
            let values: [&dyn ToSql; 14] = [
                &session_id,
                &pr.key.host,
                &pr.key.owner,
                &pr.key.repo,
                &row.number,
                &row.roles,
                &row.evidence,
                &pr.primary,
                &pr.head_ref,
                &pr.base_ref,
                &pr.title,
                &row.first_seen_at,
                &row.last_seen_at,
                &row.event_index,
            ];
            params.extend(values);
        },
    )?;

    let branches: Vec<PushedBranchRow<'_>> = links
        .pushed_branches
        .iter()
        .map(|branch| PushedBranchRow {
            branch,
            first_push_at: branch.first_push_at.map(|time| time.to_rfc3339()),
            last_push_at: branch.last_push_at.map(|time| time.to_rfc3339()),
            push_count: i64::from(branch.push_count),
        })
        .collect();
    batched_insert(
        conn,
        "INSERT OR REPLACE INTO session_pushed_branches \
        (session_id, host, owner, repo, branch, first_push_at, last_push_at, push_count) VALUES",
        8,
        &branches,
        |row, params| {
            let values: [&dyn ToSql; 8] = [
                &session_id,
                &row.branch.host,
                &row.branch.owner,
                &row.branch.repo,
                &row.branch.branch,
                &row.first_push_at,
                &row.last_push_at,
                &row.push_count,
            ];
            params.extend(values);
        },
    )?;

    let primary = links.primary();
    conn.execute(
        "UPDATE sessions SET linked_pr_count = ?2, primary_pr_host = ?3, primary_pr_owner = ?4,
             primary_pr_repo = ?5, primary_pr_number = ?6
         WHERE id = ?1",
        rusqlite::params![
            session_id,
            i64::try_from(links.pull_requests.len()).unwrap_or(i64::MAX),
            primary.map(|pr| &pr.key.host),
            primary.map(|pr| &pr.key.owner),
            primary.map(|pr| &pr.key.repo),
            primary.map(|pr| i64::from(pr.key.number)),
        ],
    )?;
    Ok(())
}
