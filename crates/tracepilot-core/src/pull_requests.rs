//! The GitHub pull requests a session created, updated, merged, reviewed or
//! was given, read from its transcript.
//!
//! Both sources are read from the normalized event stream, so Copilot CLI and
//! Claude Code share one extractor:
//! - Claude Code writes a `pr-link` record when a session creates a pull
//!   request or pushes to one. It is re-appended after every turn, and only
//!   the latest pull request is, so every record is read, not only the last.
//! - Copilot CLI records nothing pull-request-specific. Links come from the
//!   output of `gh pr` commands, GitHub MCP tool calls and the user's prompts.
//!
//! An address that appears in a fetched page, a file, a list of pull requests
//! or the assistant's own text is not a link: most addresses in a transcript
//! are pull requests the session only came across. Every value comes from a
//! session file, so it is validated before it is kept, and addresses are
//! rebuilt from their parts ([`PullRequestKey::url`]).

mod extract;
mod model;

pub use extract::extract_pull_requests;
pub use model::{
    LinkedPullRequest, PullRequestEvidence, PullRequestEvidenceSet, PullRequestKey,
    PullRequestRole, PullRequestRoles, PushedBranch, RepositoryHint, SessionPullRequests,
};
