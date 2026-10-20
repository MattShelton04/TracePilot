//! Pull request DTOs: the list's primary link, a session's links with what
//! the session did, their GitHub state, and refresh results.

use serde::Serialize;

/// How many pull requests a session is linked to, and the one that stands
/// for it.
#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LinkedPullRequests {
    pub count: u32,
    pub primary: PullRequestRef,
}

/// A pull request as the session list shows it.
#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestRef {
    pub host: String,
    pub owner: String,
    pub repo: String,
    pub number: u32,
    /// Rebuilt from the parts above, never copied from a session file.
    pub url: String,
    /// None until GitHub has been asked.
    pub state: Option<PullRequestState>,
}

/// A pull request's state on GitHub.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum PullRequestState {
    Open,
    Draft,
    Closed,
    Merged,
}

impl PullRequestState {
    /// Read a stored state (`open`, `closed`, `merged`, or the list's `draft`).
    pub fn from_stored(state: &str, is_draft: bool) -> Option<Self> {
        match state {
            "open" if is_draft => Some(Self::Draft),
            "open" => Some(Self::Open),
            "draft" => Some(Self::Draft),
            "closed" => Some(Self::Closed),
            "merged" => Some(Self::Merged),
            _ => None,
        }
    }
}

/// A pull request a session is linked to, with what the session did.
#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionPullRequest {
    pub host: String,
    pub owner: String,
    pub repo: String,
    pub number: u32,
    /// Rebuilt from the parts above, never copied from a session file.
    pub url: String,
    /// Strongest first.
    pub roles: Vec<tracepilot_core::pull_requests::PullRequestRole>,
    /// The one that stands for the session in the list and header.
    pub primary: bool,
    pub head_ref: Option<String>,
    pub base_ref: Option<String>,
    /// The title the transcript recorded. Untrusted display text.
    pub title: Option<String>,
    pub first_seen_at: Option<String>,
    pub last_seen_at: Option<String>,
    /// The event that established the strongest role.
    pub event_index: Option<u32>,
    /// None until GitHub has been asked.
    pub status: Option<PullRequestStatus>,
    /// True when the pull request, or its `updated` role, came only from a
    /// lookup of a branch the session pushed, not from the transcript.
    pub found_by_branch: bool,
}

/// A pull request's last known state on GitHub.
#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestStatus {
    pub state: Option<PullRequestState>,
    pub title: Option<String>,
    pub merged_at: Option<String>,
    pub closed_at: Option<String>,
    pub review_decision: Option<String>,
    pub checks_state: Option<String>,
    pub fetched_at: String,
    /// The last lookup's failure.
    pub error: Option<String>,
}

/// Whether a refresh could ask GitHub.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum PullRequestLookup {
    /// Looked up, or nothing was due.
    Ok,
    /// The setting is off.
    Disabled,
    /// `gh` is not installed.
    NotInstalled,
    /// `gh` is not signed in to the host.
    SignedOut,
    /// `gh` ran but gave no usable answer; nothing was written.
    Failed,
}

/// What a pull request refresh changed.
#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestRefreshResult {
    pub lookup: PullRequestLookup,
    /// Every pull request whose status row this call wrote, with its state.
    pub updated: Vec<PullRequestRef>,
    /// A pushed-branch lookup added or removed a link for the session.
    pub links_changed: bool,
}
