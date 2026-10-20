//! Reading `gh api graphql` responses.
//!
//! `gh api graphql` exits non-zero when the response carries GraphQL `errors`
//! but still prints the JSON body, so stdout is read whenever it is JSON with
//! `data`, whatever the exit status. An alias that resolved to `null` gets the
//! error whose `path[0]` names it.

use std::collections::HashMap;

use serde::Deserialize;
use serde_json::{Map, Value};

use super::{GhCallError, GhOutput};

/// Longest per-pull-request error kept, in characters.
const MAX_ERROR_CHARS: usize = 200;

/// A pull request's state on GitHub.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GhPullRequestState {
    Open,
    Closed,
    Merged,
}

impl GhPullRequestState {
    /// The stored form: `open`, `closed` or `merged`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Closed => "closed",
            Self::Merged => "merged",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value {
            "OPEN" => Some(Self::Open),
            "CLOSED" => Some(Self::Closed),
            "MERGED" => Some(Self::Merged),
            _ => None,
        }
    }
}

/// One pull request as GitHub reported it. Text fields are untrusted display
/// text; enum-like fields hold only the values listed on them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GhPullRequest {
    pub number: u32,
    pub title: Option<String>,
    pub state: Option<GhPullRequestState>,
    pub is_draft: bool,
    pub created_at: Option<String>,
    pub merged_at: Option<String>,
    pub closed_at: Option<String>,
    pub head_ref: Option<String>,
    pub base_ref: Option<String>,
    /// The login owning the head repository; None when it was deleted.
    pub head_owner: Option<String>,
    /// `approved`, `changes_requested` or `review_required`.
    pub review_decision: Option<&'static str>,
    /// `success`, `failure`, `pending`, `error` or `expected`.
    pub checks_state: Option<&'static str>,
}

/// The pull requests whose head is one branch, newest first, and the
/// repository's default branch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GhBranchPullRequests {
    pub default_branch: Option<String>,
    pub pull_requests: Vec<GhPullRequest>,
}

/// One aliased lookup's answer. Error texts may name the repository: store
/// them, never log them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GhLookup<T> {
    Found(T),
    /// GitHub says the repository or pull request does not exist (or is not
    /// visible to this sign-in): a `NOT_FOUND` error.
    NotFound(String),
    /// GitHub could not answer for this item for another reason, for example
    /// `FORBIDDEN`, a SAML requirement or a partial answer.
    Failed(String),
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawPullRequest {
    number: Option<u64>,
    title: Option<String>,
    state: Option<String>,
    is_draft: Option<bool>,
    created_at: Option<String>,
    merged_at: Option<String>,
    closed_at: Option<String>,
    head_ref_name: Option<String>,
    base_ref_name: Option<String>,
    head_repository_owner: Option<RawLogin>,
    review_decision: Option<String>,
    commits: Option<RawNodes<RawCommitNode>>,
}

#[derive(Deserialize)]
struct RawLogin {
    login: Option<String>,
}

#[derive(Deserialize)]
struct RawNodes<T> {
    nodes: Option<Vec<Option<T>>>,
}

#[derive(Deserialize)]
struct RawCommitNode {
    commit: Option<RawCommit>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawCommit {
    status_check_rollup: Option<RawRollup>,
}

#[derive(Deserialize)]
struct RawRollup {
    state: Option<String>,
}

fn review_decision(value: &str) -> Option<&'static str> {
    match value {
        "APPROVED" => Some("approved"),
        "CHANGES_REQUESTED" => Some("changes_requested"),
        "REVIEW_REQUIRED" => Some("review_required"),
        _ => None,
    }
}

fn checks_state(value: &str) -> Option<&'static str> {
    match value {
        "SUCCESS" => Some("success"),
        "FAILURE" => Some("failure"),
        "PENDING" => Some("pending"),
        "ERROR" => Some("error"),
        "EXPECTED" => Some("expected"),
        _ => None,
    }
}

fn parse_pull_request(value: &Value) -> Option<GhPullRequest> {
    let raw = RawPullRequest::deserialize(value).ok()?;
    let number = u32::try_from(raw.number?)
        .ok()
        .filter(|n| super::valid_number(*n))?;
    let checks = raw
        .commits
        .and_then(|commits| commits.nodes)
        .and_then(|nodes| nodes.into_iter().flatten().last())
        .and_then(|node| node.commit)
        .and_then(|commit| commit.status_check_rollup)
        .and_then(|rollup| rollup.state);
    Some(GhPullRequest {
        number,
        title: raw.title,
        state: raw.state.as_deref().and_then(GhPullRequestState::parse),
        is_draft: raw.is_draft.unwrap_or(false),
        created_at: raw.created_at,
        merged_at: raw.merged_at,
        closed_at: raw.closed_at,
        head_ref: raw.head_ref_name,
        base_ref: raw.base_ref_name,
        head_owner: raw.head_repository_owner.and_then(|owner| owner.login),
        review_decision: raw.review_decision.as_deref().and_then(review_decision),
        checks_state: checks.as_deref().and_then(checks_state),
    })
}

/// `TYPE: message`, without control characters, at most 200 characters.
fn describe_error(error: &Value) -> String {
    let kind = error.get("type").and_then(Value::as_str);
    let message = error
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("GitHub could not answer");
    let text = match kind {
        Some(kind) => format!("{kind}: {message}"),
        None => message.to_string(),
    };
    text.chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .take(MAX_ERROR_CHARS)
        .collect()
}

/// The first GraphQL error under one alias.
struct AliasError {
    not_found: bool,
    text: String,
}

impl AliasError {
    fn lookup<T>(&self) -> GhLookup<T> {
        if self.not_found {
            GhLookup::NotFound(self.text.clone())
        } else {
            GhLookup::Failed(self.text.clone())
        }
    }
}

/// A parsed response: the `data` object and the errors keyed by alias.
pub(super) struct GraphqlResponse {
    data: Map<String, Value>,
    alias_errors: HashMap<String, AliasError>,
}

impl GraphqlResponse {
    pub(super) fn parse(output: &GhOutput) -> Result<Self, GhCallError> {
        let failed = if output.success {
            "invalid_json"
        } else {
            "failed"
        };
        let Ok(Value::Object(mut body)) = serde_json::from_str::<Value>(output.stdout.trim())
        else {
            return Err(GhCallError::Response(failed));
        };
        let mut alias_errors = HashMap::new();
        if let Some(Value::Array(errors)) = body.get("errors") {
            for error in errors {
                let alias = error
                    .get("path")
                    .and_then(|path| path.get(0))
                    .and_then(Value::as_str);
                if let Some(alias) = alias {
                    alias_errors
                        .entry(alias.to_string())
                        .or_insert_with(|| AliasError {
                            not_found: error.get("type").and_then(Value::as_str)
                                == Some("NOT_FOUND"),
                            text: describe_error(error),
                        });
                }
            }
        }
        let data = match body.remove("data") {
            Some(Value::Object(data)) => data,
            Some(Value::Null) => Map::new(),
            _ => return Err(GhCallError::Response("api_error")),
        };
        // No answer for any alias: an auth, rate-limit or query failure.
        if data.is_empty() && alias_errors.is_empty() {
            return Err(GhCallError::Response("api_error"));
        }
        Ok(Self { data, alias_errors })
    }

    /// The alias's own error, or `fallback` as not found.
    fn not_found_or_error<T>(&self, alias: &str, fallback: &str) -> GhLookup<T> {
        match self.alias_errors.get(alias) {
            Some(error) => error.lookup(),
            None => GhLookup::NotFound(fallback.to_string()),
        }
    }

    pub(super) fn pull_request(&self, alias: &str) -> Option<GhLookup<GhPullRequest>> {
        let repository = match self.data.get(alias) {
            None => return self.alias_errors.get(alias).map(AliasError::lookup),
            Some(Value::Null) => {
                return Some(
                    self.not_found_or_error(alias, "NOT_FOUND: Could not resolve to a Repository"),
                );
            }
            Some(repository) => repository,
        };
        let found = repository
            .get("pullRequest")
            .filter(|pr| pr.is_object())
            .and_then(parse_pull_request);
        Some(match found {
            Some(pr) => GhLookup::Found(pr),
            None => self.not_found_or_error(alias, "NOT_FOUND: Could not resolve to a PullRequest"),
        })
    }

    /// A branch lookup. Only a repository GitHub reports as `NOT_FOUND`
    /// counts as "nothing found"; any other error, or an answer without its
    /// pull request list, is a failure the caller must not record as empty.
    pub(super) fn branch(&self, alias: &str) -> Option<GhLookup<GhBranchPullRequests>> {
        let error = self.alias_errors.get(alias);
        let repository = match self.data.get(alias) {
            None => return error.map(AliasError::lookup),
            Some(Value::Null) => {
                return Some(match error {
                    Some(error) => error.lookup(),
                    None => GhLookup::Failed("GitHub returned no repository".into()),
                });
            }
            Some(repository) => repository,
        };
        // An error inside a partly answered repository: never "found nothing".
        if let Some(error) = error {
            return Some(GhLookup::Failed(error.text.clone()));
        }
        let Some(nodes) = repository
            .get("pullRequests")
            .and_then(|prs| prs.get("nodes"))
            .and_then(Value::as_array)
        else {
            return Some(GhLookup::Failed(
                "GitHub returned no pull request list".into(),
            ));
        };
        let default_branch = repository
            .get("defaultBranchRef")
            .and_then(|branch| branch.get("name"))
            .and_then(Value::as_str)
            .map(str::to_string);
        Some(GhLookup::Found(GhBranchPullRequests {
            default_branch,
            pull_requests: nodes.iter().filter_map(parse_pull_request).collect(),
        }))
    }
}
