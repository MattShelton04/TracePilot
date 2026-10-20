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

#[cfg(test)]
mod batch_tests;
mod query;
mod response;
#[cfg(test)]
mod tests;

use std::io::ErrorKind;
use std::process::Stdio;

use crate::error::OrchestratorError;
use crate::process::{execute_with_timeout, hidden_std_command};

pub use query::{
    BranchQuery, MAX_ALIASES_PER_CALL, MAX_ARGV_BYTES, PullRequestQuery, valid_branch, valid_host,
    valid_number, valid_owner, valid_repo,
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

/// How to run one `gh` call.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GhRunOptions {
    pub timeout_secs: u64,
    /// Remove `GH_ENTERPRISE_TOKEN` and `GITHUB_ENTERPRISE_TOKEN` from the
    /// child's environment.
    pub strip_enterprise_tokens: bool,
}

impl GhRunOptions {
    /// Options for a call to `host`. A host other than `github.com` or a
    /// `*.ghe.com` tenant came from a session file, so `gh` may only reach it
    /// with a sign-in stored by `gh auth login`, never an environment token.
    pub fn for_host(host: &str, timeout_secs: u64) -> Self {
        Self {
            timeout_secs,
            strip_enterprise_tokens: !trusts_environment_tokens(host),
        }
    }
}

/// Whether `gh` may use environment tokens for `host`.
pub fn trusts_environment_tokens(host: &str) -> bool {
    let host = host.to_ascii_lowercase();
    host == "github.com" || host.ends_with(".ghe.com")
}

/// Runs `gh` with an argument vector (never through a shell).
pub trait GhRunner: Send + Sync {
    fn run(&self, args: &[String], options: GhRunOptions) -> Result<GhOutput, GhCallError>;
}

/// The real `gh`, as a hidden process with a timeout.
#[derive(Debug, Default, Clone, Copy)]
pub struct GhCli;

impl GhRunner for GhCli {
    fn run(&self, args: &[String], options: GhRunOptions) -> Result<GhOutput, GhCallError> {
        let mut cmd = hidden_std_command(tracepilot_core::constants::DEFAULT_GH_COMMAND);
        cmd.args(args)
            // Never wait on a prompt or check for gh updates in the background.
            .env("GH_PROMPT_DISABLED", "1")
            .env("GH_NO_UPDATE_NOTIFIER", "1")
            .env("NO_COLOR", "1")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if options.strip_enterprise_tokens {
            cmd.env_remove("GH_ENTERPRISE_TOKEN")
                .env_remove("GITHUB_ENTERPRISE_TOKEN");
        }
        let child = cmd.spawn().map_err(|error| match error.kind() {
            ErrorKind::NotFound => GhCallError::NotInstalled,
            _ => GhCallError::Spawn,
        })?;
        match execute_with_timeout(child, options.timeout_secs) {
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

fn auth_args(host: &str, active: bool) -> Vec<String> {
    let mut args = vec!["auth".to_string(), "status".to_string()];
    if active {
        args.push("--active".into());
    }
    args.extend(["--hostname".to_string(), host.to_string()]);
    args
}

/// What `gh auth status` prints when no account is signed in to the host.
const SIGNED_OUT_MARKERS: [&str; 4] = [
    "not logged in",
    "not logged into",
    "no accounts",
    "gh auth login",
];

/// `gh auth status --active --hostname <host>` (without `--active` on a `gh`
/// too old to know it). Exit 0 is signed in; output saying no account is
/// signed in is signed out; any other failure (offline, a slow server) is an
/// error, not a sign-out. The output is only matched, never kept or logged.
pub fn gh_host_auth(runner: &dyn GhRunner, host: &str) -> Result<GhHostAuth, GhCallError> {
    if !valid_host(host) {
        return Ok(GhHostAuth::SignedOut);
    }
    let options = GhRunOptions::for_host(host, GH_AUTH_TIMEOUT_SECS);
    log_call("auth", host, 1);
    let mut output = runner.run(&auth_args(host, true), options)?;
    let text = |output: &GhOutput| format!("{}\n{}", output.stdout, output.stderr).to_lowercase();
    if !output.success && text(&output).contains("unknown flag") {
        log_call("auth", host, 1);
        output = runner.run(&auth_args(host, false), options)?;
    }
    if output.success {
        return Ok(GhHostAuth::SignedIn);
    }
    let text = text(&output);
    if SIGNED_OUT_MARKERS
        .iter()
        .any(|marker| text.contains(marker))
    {
        Ok(GhHostAuth::SignedOut)
    } else {
        Err(GhCallError::Response("auth_status"))
    }
}

/// One host's answers, lined up with the queries: `None` for a query that
/// failed validation (never sent), that the response left out, or whose call
/// never ran. Calls run in order and stop at the first that fails, so the
/// answers of earlier calls are kept alongside `error`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GhBatch<T> {
    pub results: Vec<Option<GhLookup<T>>>,
    pub error: Option<GhCallError>,
}

/// What differs between the status and branch batches.
struct BatchSpec<Q, T> {
    kind: &'static str,
    alias: &'static str,
    is_valid: fn(&Q) -> bool,
    build: fn(&str, &[&Q]) -> Vec<String>,
    read: fn(&response::GraphqlResponse, &str) -> Option<GhLookup<T>>,
}

fn run_batch<Q, T: Clone>(
    runner: &dyn GhRunner,
    host: &str,
    queries: &[Q],
    spec: BatchSpec<Q, T>,
) -> GhBatch<T> {
    let mut batch = GhBatch {
        results: vec![None; queries.len()],
        error: None,
    };
    if !valid_host(host) {
        return batch;
    }
    let valid: Vec<usize> = (0..queries.len())
        .filter(|&i| (spec.is_valid)(&queries[i]))
        .collect();
    let options = GhRunOptions::for_host(host, GH_GRAPHQL_TIMEOUT_SECS);
    for (chunk, args) in query::plan_calls(host, &valid, queries, spec.build) {
        log_call(spec.kind, host, chunk.len());
        let response = runner
            .run(&args, options)
            .and_then(|output| response::GraphqlResponse::parse(&output));
        let response = match response {
            Ok(response) => response,
            Err(error) => {
                batch.error = Some(error);
                break;
            }
        };
        for (position, &index) in chunk.iter().enumerate() {
            batch.results[index] = (spec.read)(&response, &format!("{}{position}", spec.alias));
        }
    }
    batch
}

/// Look up pull requests on one host, at most [`MAX_ALIASES_PER_CALL`] and
/// [`MAX_ARGV_BYTES`] per `gh` call.
pub fn gh_pull_requests(
    runner: &dyn GhRunner,
    host: &str,
    queries: &[PullRequestQuery],
) -> GhBatch<GhPullRequest> {
    run_batch(
        runner,
        host,
        queries,
        BatchSpec {
            kind: "status",
            alias: "pr",
            is_valid: PullRequestQuery::is_valid,
            build: query::status_args,
            read: response::GraphqlResponse::pull_request,
        },
    )
}

/// Find the pull requests whose head is a pushed branch, newest first,
/// batched like [`gh_pull_requests`].
pub fn gh_branch_pull_requests(
    runner: &dyn GhRunner,
    host: &str,
    queries: &[BranchQuery],
) -> GhBatch<GhBranchPullRequests> {
    run_batch(
        runner,
        host,
        queries,
        BatchSpec {
            kind: "branches",
            alias: "b",
            is_valid: BranchQuery::is_valid,
            build: query::branch_args,
            read: response::GraphqlResponse::branch,
        },
    )
}
