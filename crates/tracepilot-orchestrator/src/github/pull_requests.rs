//! Live pull request state through `gh api graphql`.
//!
//! Every value that came from a session file (owner, repository, branch) is a
//! GraphQL variable passed with `-f`, which `gh` sends as a raw string. The
//! query text only ever holds aliases and variable names built here: `-F`
//! would read a leading `@` as a file to upload, so it carries only numbers
//! formatted from a `u32`. Values that fail the grammar checks in
//! [`valid_host`] and friends are skipped, never sent.
//!
//! The process boundary is the [`GhRunner`] trait, so tests use a fake runner
//! and never touch the network or a real `gh`.

mod query;
mod response;
#[cfg(test)]
mod tests;

use std::io::ErrorKind;
use std::process::Stdio;

use crate::error::OrchestratorError;
use crate::process::{execute_with_timeout, hidden_std_command};

pub use query::{
    BranchQuery, MAX_ALIASES_PER_CALL, PullRequestQuery, valid_branch, valid_host, valid_number,
    valid_owner, valid_repo,
};
pub use response::{GhBranchPullRequests, GhLookup, GhPullRequest, GhPullRequestState};

/// Wall-clock limit for one `gh api graphql` batch.
pub const GH_GRAPHQL_TIMEOUT_SECS: u64 = 30;
/// Wall-clock limit for `gh auth status`.
pub const GH_AUTH_TIMEOUT_SECS: u64 = 15;

/// What a `gh` invocation printed, and whether it exited successfully.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct GhOutput {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
}

/// A `gh` call that produced no usable answer at all.
///
/// Messages never carry the owner, repository or branch that were asked
/// about, so they are safe to log.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum GhCallError {
    #[error("the GitHub CLI is not installed")]
    NotInstalled,
    #[error("could not run the GitHub CLI")]
    Spawn,
    #[error("the GitHub CLI timed out after {0}s")]
    Timeout(u64),
    /// `gh` ran but its answer was not a usable GraphQL response: an auth or
    /// rate-limit failure, or output that is not JSON.
    #[error("the GitHub CLI returned no usable response ({0})")]
    Response(&'static str),
}

impl GhCallError {
    /// A stable, value-free label for logs.
    pub fn kind(&self) -> &'static str {
        match self {
            Self::NotInstalled => "not_installed",
            Self::Spawn => "spawn",
            Self::Timeout(_) => "timeout",
            Self::Response(kind) => kind,
        }
    }
}

/// Runs `gh` with an argument vector (never through a shell).
pub trait GhRunner: Send + Sync {
    fn run(&self, args: &[String], timeout_secs: u64) -> Result<GhOutput, GhCallError>;
}

/// The real `gh`, as a hidden process with a timeout.
#[derive(Debug, Default, Clone, Copy)]
pub struct GhCli;

impl GhRunner for GhCli {
    fn run(&self, args: &[String], timeout_secs: u64) -> Result<GhOutput, GhCallError> {
        let mut cmd = hidden_std_command(tracepilot_core::constants::DEFAULT_GH_COMMAND);
        cmd.args(args)
            // Never wait on a prompt or check for gh updates in the background.
            .env("GH_PROMPT_DISABLED", "1")
            .env("GH_NO_UPDATE_NOTIFIER", "1")
            .env("NO_COLOR", "1")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let child = cmd.spawn().map_err(|error| match error.kind() {
            ErrorKind::NotFound => GhCallError::NotInstalled,
            _ => GhCallError::Spawn,
        })?;
        match execute_with_timeout(child, timeout_secs) {
            Ok((stdout, stderr, status)) => Ok(GhOutput {
                success: status.success(),
                stdout: String::from_utf8_lossy(&stdout).into_owned(),
                stderr: String::from_utf8_lossy(&stderr).into_owned(),
            }),
            Err(OrchestratorError::Timeout { secs }) => Err(GhCallError::Timeout(secs)),
            Err(_) => Err(GhCallError::Spawn),
        }
    }
}

/// Whether `gh` is signed in to a host.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GhHostAuth {
    SignedIn,
    SignedOut,
}

fn log_call(kind: &'static str, host: &str, count: usize) {
    // The coordinator counts these lines; never add owner, repo or branch.
    tracing::info!(target: "tracepilot::gh", kind, host, count, "gh call");
}

/// `gh auth status --hostname <host>`. A missing `gh` is
/// [`GhCallError::NotInstalled`]; any non-zero exit is signed out.
pub fn gh_host_auth(runner: &dyn GhRunner, host: &str) -> Result<GhHostAuth, GhCallError> {
    if !valid_host(host) {
        return Ok(GhHostAuth::SignedOut);
    }
    log_call("auth", host, 1);
    let args = ["auth", "status", "--hostname", host].map(String::from);
    let output = runner.run(&args, GH_AUTH_TIMEOUT_SECS)?;
    Ok(if output.success {
        GhHostAuth::SignedIn
    } else {
        GhHostAuth::SignedOut
    })
}

/// Look up pull requests on one host, at most [`MAX_ALIASES_PER_CALL`] per
/// `gh` call.
///
/// The result lines up with `queries`: `None` for a query that failed
/// validation (never sent) or that the response left out. A failed call fails
/// the whole lookup, so the caller writes nothing.
pub fn gh_pull_requests(
    runner: &dyn GhRunner,
    host: &str,
    queries: &[PullRequestQuery],
) -> Result<Vec<Option<GhLookup<GhPullRequest>>>, GhCallError> {
    let mut results: Vec<Option<GhLookup<GhPullRequest>>> = vec![None; queries.len()];
    if !valid_host(host) {
        return Ok(results);
    }
    let valid: Vec<usize> = (0..queries.len())
        .filter(|&i| queries[i].is_valid())
        .collect();
    for chunk in valid.chunks(MAX_ALIASES_PER_CALL) {
        let items: Vec<&PullRequestQuery> = chunk.iter().map(|&i| &queries[i]).collect();
        log_call("status", host, items.len());
        let output = runner.run(&query::status_args(host, &items), GH_GRAPHQL_TIMEOUT_SECS)?;
        let response = response::GraphqlResponse::parse(&output)?;
        for (alias, &index) in chunk.iter().enumerate() {
            results[index] = response.pull_request(&format!("pr{alias}"));
        }
    }
    Ok(results)
}

/// Find the pull requests whose head is a pushed branch, newest first, at
/// most [`MAX_ALIASES_PER_CALL`] branches per `gh` call. Lines up with
/// `queries` like [`gh_pull_requests`].
pub fn gh_branch_pull_requests(
    runner: &dyn GhRunner,
    host: &str,
    queries: &[BranchQuery],
) -> Result<Vec<Option<GhLookup<GhBranchPullRequests>>>, GhCallError> {
    let mut results: Vec<Option<GhLookup<GhBranchPullRequests>>> = vec![None; queries.len()];
    if !valid_host(host) {
        return Ok(results);
    }
    let valid: Vec<usize> = (0..queries.len())
        .filter(|&i| queries[i].is_valid())
        .collect();
    for chunk in valid.chunks(MAX_ALIASES_PER_CALL) {
        let items: Vec<&BranchQuery> = chunk.iter().map(|&i| &queries[i]).collect();
        log_call("branches", host, items.len());
        let output = runner.run(&query::branch_args(host, &items), GH_GRAPHQL_TIMEOUT_SECS)?;
        let response = response::GraphqlResponse::parse(&output)?;
        for (alias, &index) in chunk.iter().enumerate() {
            results[index] = response.branch(&format!("b{alias}"));
        }
    }
    Ok(results)
}
