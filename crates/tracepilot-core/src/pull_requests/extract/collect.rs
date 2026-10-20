//! Merging evidence into one entry per pull request and per pushed branch,
//! then ordering them and choosing the primary pull request.

use std::cmp::Reverse;
use std::collections::HashMap;

use chrono::{DateTime, Utc};

use super::text::clean_title;
use crate::pull_requests::model::{
    LinkedPullRequest, PullRequestEvidence, PullRequestEvidenceSet, PullRequestKey,
    PullRequestRole, PullRequestRoles, PushedBranch, SessionPullRequests,
};

/// At most this many pull requests (and pushed branches) per session.
const MAX_ENTRIES: usize = 1_000;

type Identity = (String, String, String, u32);

/// One piece of evidence about one pull request.
#[derive(Debug)]
pub(super) struct Hit {
    pub(super) key: PullRequestKey,
    /// `None` for Claude Code's `pr-link`, whose role depends on the rest.
    pub(super) role: Option<PullRequestRole>,
    pub(super) evidence: PullRequestEvidence,
    pub(super) event_index: usize,
    pub(super) at: Option<DateTime<Utc>>,
    pub(super) head: Option<String>,
    pub(super) base: Option<String>,
    pub(super) title: Option<String>,
}

impl Hit {
    pub(super) fn new(
        key: PullRequestKey,
        role: Option<PullRequestRole>,
        evidence: PullRequestEvidence,
        event_index: usize,
        at: Option<DateTime<Utc>>,
    ) -> Self {
        Self {
            key,
            role,
            evidence,
            event_index,
            at,
            head: None,
            base: None,
            title: None,
        }
    }

    pub(super) fn refs(mut self, head: Option<String>, base: Option<String>) -> Self {
        self.head = head;
        self.base = base;
        self
    }

    pub(super) fn title(mut self, title: Option<&str>) -> Self {
        self.title = title.and_then(clean_title);
        self
    }
}

struct Entry {
    pr: LinkedPullRequest,
    /// The earliest event that gave each role, by [`PullRequestRole::ALL`] order.
    first_index: [Option<usize>; 5],
    first_pr_link: Option<usize>,
}

#[derive(Default)]
pub(super) struct Collector {
    entries: Vec<Entry>,
    by_identity: HashMap<Identity, usize>,
    branches: Vec<PushedBranch>,
    branch_index: HashMap<(String, String, String, String), usize>,
}

fn role_slot(role: PullRequestRole) -> usize {
    PullRequestRole::ALL
        .iter()
        .position(|r| *r == role)
        .unwrap_or(0)
}

fn earliest(slot: &mut Option<usize>, index: usize) {
    *slot = Some(slot.map_or(index, |current| current.min(index)));
}

fn widen(
    first: &mut Option<DateTime<Utc>>,
    last: &mut Option<DateTime<Utc>>,
    at: Option<DateTime<Utc>>,
) {
    if let Some(at) = at {
        *first = Some(first.map_or(at, |f| f.min(at)));
        *last = Some(last.map_or(at, |l| l.max(at)));
    }
}

impl Collector {
    pub(super) fn add(&mut self, hit: Hit) {
        let identity = hit.key.identity();
        let slot = match self.by_identity.get(&identity) {
            Some(slot) => *slot,
            None => {
                if self.entries.len() >= MAX_ENTRIES {
                    return;
                }
                self.entries.push(Entry {
                    pr: LinkedPullRequest {
                        key: hit.key,
                        roles: PullRequestRoles::default(),
                        evidence: PullRequestEvidenceSet::default(),
                        head_ref: None,
                        base_ref: None,
                        title: None,
                        first_seen_at: None,
                        last_seen_at: None,
                        event_index: None,
                        primary: false,
                    },
                    first_index: [None; 5],
                    first_pr_link: None,
                });
                self.by_identity.insert(identity, self.entries.len() - 1);
                self.entries.len() - 1
            }
        };
        let entry = &mut self.entries[slot];
        let pr = &mut entry.pr;
        pr.evidence.insert(hit.evidence);
        match hit.role {
            Some(role) => {
                pr.roles.insert(role);
                earliest(&mut entry.first_index[role_slot(role)], hit.event_index);
            }
            None => earliest(&mut entry.first_pr_link, hit.event_index),
        }
        widen(&mut pr.first_seen_at, &mut pr.last_seen_at, hit.at);
        pr.head_ref = pr.head_ref.take().or(hit.head);
        pr.base_ref = pr.base_ref.take().or(hit.base);
        pr.title = pr.title.take().or(hit.title);
    }

    /// One shell call that pushed `branch`.
    pub(super) fn push(
        &mut self,
        host: &str,
        owner: &str,
        repo: &str,
        branch: &str,
        at: Option<DateTime<Utc>>,
    ) {
        let identity = (
            host.to_ascii_lowercase(),
            owner.to_ascii_lowercase(),
            repo.to_ascii_lowercase(),
            branch.to_string(),
        );
        let slot = match self.branch_index.get(&identity) {
            Some(slot) => *slot,
            None => {
                if self.branches.len() >= MAX_ENTRIES {
                    return;
                }
                self.branches.push(PushedBranch {
                    host: host.to_ascii_lowercase(),
                    owner: owner.to_string(),
                    repo: repo.to_string(),
                    branch: branch.to_string(),
                    first_push_at: None,
                    last_push_at: None,
                    push_count: 0,
                });
                self.branch_index.insert(identity, self.branches.len() - 1);
                self.branches.len() - 1
            }
        };
        let branch = &mut self.branches[slot];
        branch.push_count = branch.push_count.saturating_add(1);
        widen(&mut branch.first_push_at, &mut branch.last_push_at, at);
    }

    pub(super) fn finish(self) -> SessionPullRequests {
        let mut pull_requests: Vec<LinkedPullRequest> = self
            .entries
            .into_iter()
            .map(|mut entry| {
                // `pr-link` alone: Claude Code linked a pull request the
                // session pushed to, edited or commented on. With creation
                // evidence it is the created pull request's own record.
                if let Some(index) = entry.first_pr_link
                    && !entry.pr.roles.contains(PullRequestRole::Created)
                {
                    entry.pr.roles.insert(PullRequestRole::Updated);
                    earliest(
                        &mut entry.first_index[role_slot(PullRequestRole::Updated)],
                        index,
                    );
                }
                entry.pr.event_index = entry
                    .pr
                    .roles
                    .strongest()
                    .and_then(|role| entry.first_index[role_slot(role)]);
                entry.pr
            })
            .filter(|pr| !pr.roles.is_empty())
            .collect();
        pull_requests.sort_by_key(|pr| {
            (
                pr.roles.strongest().map_or(usize::MAX, role_slot),
                Reverse(pr.last_seen_at),
                Reverse(pr.key.number),
            )
        });
        if let Some(first) = pull_requests.first_mut() {
            first.primary = true;
        }
        SessionPullRequests {
            pull_requests,
            pushed_branches: self.branches,
        }
    }
}
