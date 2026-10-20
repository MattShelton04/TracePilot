//! The pull requests a session is linked to, as recorded in its transcript.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
#[cfg(feature = "specta")]
use specta::Type;

/// One pull request, identified the way GitHub does: host, owner, repository
/// and number. Owner and repository keep the case they were first seen in;
/// two keys that differ only in case are the same pull request.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct PullRequestKey {
    /// `github.com`, a `*.ghe.com` tenant or a GitHub Enterprise Server host.
    pub host: String,
    pub owner: String,
    pub repo: String,
    pub number: u32,
}

impl PullRequestKey {
    /// The pull request's web address, rebuilt from validated parts so it
    /// never carries text copied from a session file.
    pub fn url(&self) -> String {
        format!(
            "https://{}/{}/{}/pull/{}",
            self.host, self.owner, self.repo, self.number
        )
    }

    /// Case-insensitive identity, used to merge evidence for one pull request.
    pub fn identity(&self) -> (String, String, String, u32) {
        (
            self.host.to_ascii_lowercase(),
            self.owner.to_ascii_lowercase(),
            self.repo.to_ascii_lowercase(),
            self.number,
        )
    }
}

/// How a session took part in a pull request, strongest first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(Type))]
#[serde(rename_all = "lowercase")]
pub enum PullRequestRole {
    /// The session opened it (`gh pr create` printed its address).
    Created,
    /// The session pushed to, edited, commented on, closed or bound it, or
    /// Claude Code linked it without the session creating it.
    Updated,
    /// The session merged it.
    Merged,
    /// The session read it: viewed, diffed, checked out, reviewed or fetched
    /// it through a GitHub tool.
    Reviewed,
    /// The user pasted its address into a prompt.
    Mentioned,
}

impl PullRequestRole {
    /// Every role, strongest first.
    pub const ALL: [Self; 5] = [
        Self::Created,
        Self::Updated,
        Self::Merged,
        Self::Reviewed,
        Self::Mentioned,
    ];

    const fn bit(self) -> u8 {
        match self {
            Self::Created => 1,
            Self::Updated => 1 << 1,
            Self::Merged => 1 << 2,
            Self::Reviewed => 1 << 3,
            Self::Mentioned => 1 << 4,
        }
    }
}

/// The set of roles one session had in one pull request. Stored as its bits.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash)]
pub struct PullRequestRoles(u8);

impl PullRequestRoles {
    pub fn insert(&mut self, role: PullRequestRole) {
        self.0 |= role.bit();
    }

    pub fn contains(self, role: PullRequestRole) -> bool {
        self.0 & role.bit() != 0
    }

    pub fn is_empty(self) -> bool {
        self.0 == 0
    }

    /// The strongest role in the set.
    pub fn strongest(self) -> Option<PullRequestRole> {
        PullRequestRole::ALL
            .into_iter()
            .find(|role| self.contains(*role))
    }

    /// The roles in the set, strongest first.
    pub fn iter(self) -> impl Iterator<Item = PullRequestRole> {
        PullRequestRole::ALL
            .into_iter()
            .filter(move |role| self.contains(*role))
    }

    pub fn bits(self) -> u8 {
        self.0
    }

    /// Roles read back from storage; unknown bits from a newer build are dropped.
    pub fn from_bits(bits: i64) -> Self {
        let known = PullRequestRole::ALL
            .into_iter()
            .fold(0u8, |all, role| all | role.bit());
        Self(u8::try_from(bits & i64::from(known)).unwrap_or(0))
    }
}

impl FromIterator<PullRequestRole> for PullRequestRoles {
    fn from_iter<I: IntoIterator<Item = PullRequestRole>>(iter: I) -> Self {
        let mut roles = Self::default();
        for role in iter {
            roles.insert(role);
        }
        roles
    }
}

/// What in the transcript established a link. Kept for diagnostics and to
/// explain a link; the UI shows roles.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PullRequestEvidence {
    /// Claude Code's `pr-link` record.
    PrLink,
    /// `gh pr create` printed the address.
    GhCreate,
    /// `gh pr create` reported that the branch already has this pull request.
    GhCreateExists,
    /// `gh pr merge` reported the merge.
    GhMerge,
    /// `gh pr view` without a number: the current branch's pull request.
    GhViewCurrent,
    /// Another `gh pr` subcommand that named the pull request.
    GhCommand,
    /// A GitHub MCP tool call that named the pull request.
    McpTool,
    /// The user's own prompt.
    UserMessage,
    /// The Claude desktop app bound the pull request to the session.
    AppBinding,
    /// A branch the session pushed is this pull request's head (looked up on
    /// GitHub, never set by the transcript extractor).
    BranchLookup,
}

impl PullRequestEvidence {
    const ALL: [Self; 10] = [
        Self::PrLink,
        Self::GhCreate,
        Self::GhCreateExists,
        Self::GhMerge,
        Self::GhViewCurrent,
        Self::GhCommand,
        Self::McpTool,
        Self::UserMessage,
        Self::AppBinding,
        Self::BranchLookup,
    ];

    const fn bit(self) -> u16 {
        match self {
            Self::PrLink => 1,
            Self::GhCreate => 1 << 1,
            Self::GhCreateExists => 1 << 2,
            Self::GhMerge => 1 << 3,
            Self::GhViewCurrent => 1 << 4,
            Self::GhCommand => 1 << 5,
            Self::McpTool => 1 << 6,
            Self::UserMessage => 1 << 7,
            Self::AppBinding => 1 << 8,
            Self::BranchLookup => 1 << 9,
        }
    }
}

/// The set of evidence kinds behind one link. Stored as its bits.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash)]
pub struct PullRequestEvidenceSet(u16);

impl PullRequestEvidenceSet {
    pub fn insert(&mut self, evidence: PullRequestEvidence) {
        self.0 |= evidence.bit();
    }

    pub fn contains(self, evidence: PullRequestEvidence) -> bool {
        self.0 & evidence.bit() != 0
    }

    pub fn bits(self) -> u16 {
        self.0
    }

    pub fn from_bits(bits: i64) -> Self {
        let known = PullRequestEvidence::ALL
            .into_iter()
            .fold(0u16, |all, evidence| all | evidence.bit());
        Self(u16::try_from(bits & i64::from(known)).unwrap_or(0))
    }
}

/// One pull request a session is linked to, with everything the transcript
/// said about it.
#[derive(Debug, Clone, PartialEq)]
pub struct LinkedPullRequest {
    pub key: PullRequestKey,
    pub roles: PullRequestRoles,
    pub evidence: PullRequestEvidenceSet,
    /// Head branch, when the transcript named it (`gh pr create` progress
    /// line, `gh pr view --json`, a merge's deleted branch).
    pub head_ref: Option<String>,
    pub base_ref: Option<String>,
    /// Title, when the transcript recorded one (`--title`, JSON output, merge
    /// output). Untrusted display text, at most 200 characters.
    pub title: Option<String>,
    pub first_seen_at: Option<DateTime<Utc>>,
    pub last_seen_at: Option<DateTime<Utc>>,
    /// Index, in the session's event stream, of the event that established
    /// the strongest role: the tool call's `tool.execution_start`, the user
    /// message, or Claude Code's `pr-link` record.
    pub event_index: Option<usize>,
    /// The pull request that stands for the session in the list and header.
    /// Exactly one per session that has any.
    pub primary: bool,
}

/// A branch the session pushed to a GitHub remote, for looking up pull
/// requests whose head it is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PushedBranch {
    pub host: String,
    pub owner: String,
    pub repo: String,
    /// The remote branch name (the right side of `local -> remote`).
    pub branch: String,
    pub first_push_at: Option<DateTime<Utc>>,
    pub last_push_at: Option<DateTime<Utc>>,
    pub push_count: u32,
}

/// Everything the extractor found for one session.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct SessionPullRequests {
    /// One entry per pull request, strongest role first, then most recent.
    pub pull_requests: Vec<LinkedPullRequest>,
    pub pushed_branches: Vec<PushedBranch>,
}

impl SessionPullRequests {
    pub fn primary(&self) -> Option<&LinkedPullRequest> {
        self.pull_requests.iter().find(|pr| pr.primary)
    }
}

/// What the session itself says about its repository, for references that
/// carry only a number (`gh pr merge 976`).
#[derive(Debug, Clone, Copy, Default)]
pub struct RepositoryHint<'a> {
    /// `owner/repo`.
    pub repository: Option<&'a str>,
    /// The source's host kind (`github`), when recorded.
    pub host_type: Option<&'a str>,
}
