//! Stores what GitHub said: `pull_request_status` rows and the pull requests
//! found for each pushed branch (`session_branch_pull_requests`).
//!
//! Callers do the network work first, then write everything from one refresh
//! in a single short transaction. These tables are not indexer-owned, so a
//! write never waits on indexing gates; a busy database fails the write and
//! the caller reports it.

use std::collections::BTreeSet;

use rusqlite::params;
use tracepilot_core::ids::SessionId;
use tracepilot_core::pull_requests::PullRequestKey;

use super::IndexDb;
use crate::Result;

/// A pull request's state as GitHub reported it.
#[derive(Debug, Clone, PartialEq)]
pub struct PullRequestStatusUpdate {
    pub key: PullRequestKey,
    /// `open`, `closed` or `merged`.
    pub state: Option<String>,
    pub is_draft: bool,
    pub title: Option<String>,
    pub head_ref: Option<String>,
    pub base_ref: Option<String>,
    pub head_owner: Option<String>,
    pub created_at: Option<String>,
    pub merged_at: Option<String>,
    pub closed_at: Option<String>,
    pub review_decision: Option<String>,
    pub checks_state: Option<String>,
}

/// One lookup of a pushed branch: the pull requests accepted for it, none
/// when nothing matched.
#[derive(Debug, Clone, PartialEq)]
pub struct BranchLookupUpdate {
    pub session_id: SessionId,
    /// As in `session_pushed_branches`.
    pub host: String,
    pub owner: String,
    pub repo: String,
    pub branch: String,
    pub numbers: Vec<u32>,
}

/// Everything one refresh learned.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct PullRequestRefreshWrite {
    pub statuses: Vec<PullRequestStatusUpdate>,
    /// Pull requests GitHub could not answer for, with why.
    pub errors: Vec<(PullRequestKey, String)>,
    pub branches: Vec<BranchLookupUpdate>,
}

impl PullRequestRefreshWrite {
    pub fn is_empty(&self) -> bool {
        self.statuses.is_empty() && self.errors.is_empty() && self.branches.is_empty()
    }
}

impl IndexDb {
    /// Write one refresh in one transaction, stamped `fetched_at`.
    ///
    /// - A status replaces the pull request's row and clears its error.
    /// - An error sets `error` and `fetched_at` and keeps the last known state.
    /// - A branch lookup replaces that branch's rows with its pull requests, or
    ///   one `number = 0` row recording that nothing matched.
    ///
    /// Returns whether a branch lookup added or removed a pull request.
    pub fn write_pull_request_refresh(
        &self,
        write: &PullRequestRefreshWrite,
        fetched_at: &str,
    ) -> Result<bool> {
        if write.is_empty() {
            return Ok(false);
        }
        self.with_transaction(|db| {
            for status in &write.statuses {
                db.upsert_pull_request_status(status, fetched_at)?;
            }
            for (key, error) in &write.errors {
                db.conn.execute(
                    "INSERT INTO pull_request_status (host, owner, repo, number, fetched_at, error)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                     ON CONFLICT (host, owner, repo, number) DO UPDATE SET
                        fetched_at = excluded.fetched_at, error = excluded.error",
                    params![key.host, key.owner, key.repo, key.number, fetched_at, error],
                )?;
            }
            let mut links_changed = false;
            for branch in &write.branches {
                links_changed |= db.replace_branch_lookup(branch, fetched_at)?;
            }
            Ok(links_changed)
        })
    }

    fn upsert_pull_request_status(
        &self,
        status: &PullRequestStatusUpdate,
        fetched_at: &str,
    ) -> Result<()> {
        let key = &status.key;
        self.conn.execute(
            "INSERT INTO pull_request_status (
                host, owner, repo, number, state, is_draft, title, head_ref, base_ref,
                head_owner, created_at, merged_at, closed_at, review_decision, checks_state,
                fetched_at, error)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, NULL)
             ON CONFLICT (host, owner, repo, number) DO UPDATE SET
                state = excluded.state, is_draft = excluded.is_draft, title = excluded.title,
                head_ref = excluded.head_ref, base_ref = excluded.base_ref,
                head_owner = excluded.head_owner, created_at = excluded.created_at,
                merged_at = excluded.merged_at, closed_at = excluded.closed_at,
                review_decision = excluded.review_decision,
                checks_state = excluded.checks_state, fetched_at = excluded.fetched_at,
                error = NULL",
            params![
                key.host,
                key.owner,
                key.repo,
                key.number,
                status.state,
                status.is_draft,
                status.title,
                status.head_ref,
                status.base_ref,
                status.head_owner,
                status.created_at,
                status.merged_at,
                status.closed_at,
                status.review_decision,
                status.checks_state,
                fetched_at,
            ],
        )?;
        Ok(())
    }

    /// Replace one branch's lookup rows; true when its pull requests changed.
    fn replace_branch_lookup(&self, branch: &BranchLookupUpdate, fetched_at: &str) -> Result<bool> {
        const MATCH: &str = "session_id = ?1 AND host = ?2 COLLATE NOCASE \
             AND owner = ?3 COLLATE NOCASE AND repo = ?4 COLLATE NOCASE AND branch = ?5";
        let scope = params![
            branch.session_id.as_str(),
            branch.host,
            branch.owner,
            branch.repo,
            branch.branch
        ];
        let before: BTreeSet<u32> = self
            .conn
            .prepare(&format!(
                "SELECT number FROM session_branch_pull_requests WHERE {MATCH} AND number > 0"
            ))?
            .query_map(scope, |row| row.get(0))?
            .collect::<rusqlite::Result<_>>()?;
        self.conn.execute(
            &format!("DELETE FROM session_branch_pull_requests WHERE {MATCH}"),
            scope,
        )?;
        let after: BTreeSet<u32> = branch.numbers.iter().copied().filter(|n| *n > 0).collect();
        // `number = 0` records a lookup that matched nothing. A session pruned
        // since the lookup started gets no rows.
        let numbers: Vec<u32> = if after.is_empty() {
            vec![0]
        } else {
            after.iter().copied().collect()
        };
        let mut insert = self.conn.prepare(
            "INSERT INTO session_branch_pull_requests
                (session_id, host, owner, repo, branch, number, fetched_at)
             SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
             WHERE EXISTS (SELECT 1 FROM sessions WHERE id = ?1)",
        )?;
        for number in numbers {
            insert.execute(params![
                branch.session_id.as_str(),
                branch.host,
                branch.owner,
                branch.repo,
                branch.branch,
                number,
                fetched_at
            ])?;
        }
        Ok(before != after)
    }
}
