//! Pull request DTOs for the session list and for sessions that share a pull
//! request.

use serde::Serialize;
use tracepilot_core::SessionId;
use tracepilot_core::provider::SessionSource;
use tracepilot_core::pull_requests::PullRequestRole;

use super::PullRequestRef;

/// How many pull requests a session is linked to, the one that stands for
/// it, and every linked one, for searching the list.
#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LinkedPullRequests {
    pub count: u32,
    pub primary: PullRequestRef,
    /// Every linked pull request, primary first, then by strongest role and
    /// recency; at most 200.
    pub pull_requests: Vec<LinkedPullRequestSummary>,
}

/// A linked pull request as the session list searches it.
#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LinkedPullRequestSummary {
    pub owner: String,
    pub repo: String,
    pub number: u32,
    /// GitHub's title when it has been fetched, else the transcript's.
    /// Untrusted display text.
    pub title: Option<String>,
}

/// How many other sessions link one of a session's pull requests.
#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RelatedPullRequestCount {
    pub host: String,
    pub owner: String,
    pub repo: String,
    pub number: u32,
    /// Always at least 1: pull requests no other session links are left out.
    pub other_session_count: u32,
}

/// A session linked to a pull request, for listing the sessions that share it.
#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestSessionLink {
    pub session_id: SessionId,
    pub summary: Option<String>,
    pub repository: Option<String>,
    pub source: SessionSource,
    pub updated_at: Option<String>,
    /// What this session did with the pull request, strongest first.
    pub roles: Vec<PullRequestRole>,
}
