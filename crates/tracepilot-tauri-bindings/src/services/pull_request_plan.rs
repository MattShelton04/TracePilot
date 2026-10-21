//! What one refresh asks GitHub, and how the answers become index writes.

use std::collections::HashSet;

use tracepilot_core::ids::SessionId;
use tracepilot_core::pull_requests::PullRequestKey;
use tracepilot_indexer::index_db::{
    BranchLookupUpdate, PullRequestFetchState, PullRequestRefreshWrite, PullRequestStatusUpdate,
    PushedBranchLookup,
};
use tracepilot_orchestrator::github::pull_requests::{
    BranchQuery, GhCallError, GhLookup, GhPullRequest, GhRunner, PullRequestQuery,
    gh_branch_pull_requests, gh_pull_requests,
};

use super::pull_request_policy::{ActiveSpan, accept_branch_pull_request};
use crate::types::{PullRequestRef, PullRequestState};

pub(super) struct StatusItem {
    pub(super) fetch: PullRequestFetchState,
    pub(super) query: PullRequestQuery,
}

pub(super) struct BranchItem {
    pub(super) session_id: SessionId,
    pub(super) lookup: PushedBranchLookup,
    pub(super) query: BranchQuery,
    pub(super) span: ActiveSpan,
}

#[derive(Default)]
pub(super) struct Plan {
    pub(super) statuses: Vec<StatusItem>,
    pub(super) branches: Vec<BranchItem>,
    pub(super) force: bool,
}

impl Plan {
    pub(super) fn is_empty(&self) -> bool {
        self.statuses.is_empty() && self.branches.is_empty()
    }

    /// Every host the plan asks, lowercased, in a stable order.
    pub(super) fn hosts(&self) -> Vec<String> {
        let mut hosts: Vec<String> = self
            .statuses
            .iter()
            .map(|item| item.fetch.key.host.to_ascii_lowercase())
            .chain(
                self.branches
                    .iter()
                    .map(|item| item.lookup.host.to_ascii_lowercase()),
            )
            .collect();
        hosts.sort();
        hosts.dedup();
        hosts
    }

    pub(super) fn retain_hosts(&mut self, hosts: &HashSet<String>) {
        self.statuses
            .retain(|item| hosts.contains(&item.fetch.key.host.to_ascii_lowercase()));
        self.branches
            .retain(|item| hosts.contains(&item.lookup.host.to_ascii_lowercase()));
    }
}

fn status_update(key: PullRequestKey, pr: &GhPullRequest) -> PullRequestStatusUpdate {
    PullRequestStatusUpdate {
        key,
        state: pr.state.map(|state| state.as_str().to_string()),
        is_draft: pr.is_draft,
        title: pr.title.clone(),
        head_ref: pr.head_ref.clone(),
        base_ref: pr.base_ref.clone(),
        head_owner: pr.head_owner.clone(),
        created_at: pr.created_at.clone(),
        merged_at: pr.merged_at.clone(),
        closed_at: pr.closed_at.clone(),
        review_decision: pr.review_decision.map(str::to_string),
        checks_state: pr.checks_state.map(str::to_string),
    }
}

fn pull_request_ref(key: &PullRequestKey, state: Option<&str>, is_draft: bool) -> PullRequestRef {
    PullRequestRef {
        url: key.url(),
        host: key.host.clone(),
        owner: key.owner.clone(),
        repo: key.repo.clone(),
        number: key.number,
        state: state.and_then(|state| PullRequestState::from_stored(state, is_draft)),
    }
}

/// A host whose `gh` call failed during a refresh; later calls skip it.
pub(super) type HostFailure = (String, GhCallError);

impl Plan {
    /// Look up the plan's pushed branches; accepted pull requests get their
    /// status from the same answer. A branch GitHub couldn't answer for (no
    /// access, a partial answer, a failed call) gets no write, so its earlier
    /// matches stay; only a repository GitHub reports missing records "none".
    pub(super) fn lookup_branches(
        &self,
        runner: &dyn GhRunner,
        write: &mut PullRequestRefreshWrite,
        failures: &mut Vec<HostFailure>,
    ) {
        for host in self.hosts() {
            let items: Vec<&BranchItem> = self
                .branches
                .iter()
                .filter(|item| item.lookup.host.eq_ignore_ascii_case(&host))
                .collect();
            if items.is_empty() {
                continue;
            }
            let queries: Vec<BranchQuery> = items.iter().map(|item| item.query.clone()).collect();
            let batch = gh_branch_pull_requests(runner, &host, &queries);
            for (item, found) in items.into_iter().zip(batch.results) {
                let numbers = match found {
                    // Not sent, unanswered or failed: try again later.
                    None | Some(GhLookup::Failed(_)) => continue,
                    // The repository is gone: nothing can match any more.
                    Some(GhLookup::NotFound(_)) => Vec::new(),
                    Some(GhLookup::Found(found))
                        if found.default_branch.as_deref() == Some(item.lookup.branch.as_str()) =>
                    {
                        Vec::new()
                    }
                    Some(GhLookup::Found(found)) => found
                        .pull_requests
                        .iter()
                        .filter(|pr| accept_branch_pull_request(pr, &item.lookup.owner, item.span))
                        .map(|pr| {
                            let key = PullRequestKey {
                                host: item.lookup.host.clone(),
                                owner: item.lookup.owner.clone(),
                                repo: item.lookup.repo.clone(),
                                number: pr.number,
                            };
                            push_status(write, status_update(key, pr));
                            pr.number
                        })
                        .collect(),
                };
                write.branches.push(BranchLookupUpdate {
                    session_id: item.session_id.clone(),
                    host: item.lookup.host.clone(),
                    owner: item.lookup.owner.clone(),
                    repo: item.lookup.repo.clone(),
                    branch: item.lookup.branch.clone(),
                    numbers,
                });
            }
            if let Some(error) = batch.error {
                failures.push((host, error));
            }
        }
    }

    /// Fetch the plan's pull request states, except those a branch lookup
    /// already answered and those on a host whose call already failed.
    pub(super) fn lookup_statuses(
        &self,
        runner: &dyn GhRunner,
        write: &mut PullRequestRefreshWrite,
        failures: &mut Vec<HostFailure>,
    ) {
        // Pull requests a branch lookup just answered for need no second call.
        let mut done: HashSet<_> = write
            .statuses
            .iter()
            .map(|status| status.key.identity())
            .collect();
        for host in self.hosts() {
            if failures.iter().any(|(failed, _)| *failed == host) {
                continue;
            }
            let items: Vec<&StatusItem> = self
                .statuses
                .iter()
                .filter(|item| item.fetch.key.host.eq_ignore_ascii_case(&host))
                .filter(|item| done.insert(item.fetch.key.identity()))
                .collect();
            if items.is_empty() {
                continue;
            }
            let queries: Vec<PullRequestQuery> =
                items.iter().map(|item| item.query.clone()).collect();
            let batch = gh_pull_requests(runner, &host, &queries);
            for (item, found) in items.into_iter().zip(batch.results) {
                match found {
                    Some(GhLookup::Found(pr)) => {
                        push_status(write, status_update(item.fetch.key.clone(), &pr));
                    }
                    Some(GhLookup::NotFound(error) | GhLookup::Failed(error)) => {
                        write.errors.push((item.fetch.key.clone(), error));
                    }
                    None => {}
                }
            }
            if let Some(error) = batch.error {
                failures.push((host, error));
            }
        }
    }
}

/// Add a status unless the same pull request already has one.
fn push_status(write: &mut PullRequestRefreshWrite, status: PullRequestStatusUpdate) {
    let identity = status.key.identity();
    if !write
        .statuses
        .iter()
        .any(|known| known.key.identity() == identity)
    {
        write.statuses.push(status);
    }
}

/// Every pull request whose status row the write touched, with its state:
/// the new one, or the kept one for a failed lookup.
pub(super) fn updated_refs(plan: &Plan, write: &PullRequestRefreshWrite) -> Vec<PullRequestRef> {
    let fresh = write
        .statuses
        .iter()
        .map(|status| pull_request_ref(&status.key, status.state.as_deref(), status.is_draft));
    let failed = write.errors.iter().map(|(key, _)| {
        let identity = key.identity();
        let kept = plan
            .statuses
            .iter()
            .find(|item| item.fetch.key.identity() == identity)
            .map(|item| &item.fetch);
        pull_request_ref(
            key,
            kept.and_then(|fetch| fetch.state.as_deref()),
            kept.is_some_and(|fetch| fetch.is_draft),
        )
    });
    fresh.chain(failed).collect()
}
