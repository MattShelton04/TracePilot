//! Builders for the extractor's tests: Copilot and Claude Code events in
//! the normalized shape both providers produce. Repository names are the
//! project's own public repository or obvious examples.

use chrono::{DateTime, TimeZone, Utc};
use serde_json::{Value, json};

use super::extract_pull_requests;
use crate::parsing::events::TypedEvent;
use crate::pull_requests::model::{
    LinkedPullRequest, PullRequestRole, RepositoryHint, SessionPullRequests,
};
use crate::testing::make_typed_event;

pub(super) const REPO: &str = "MattShelton04/TracePilot";

pub(super) fn at(second: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 9, 1, 10, 0, 0).unwrap()
        + chrono::Duration::seconds(i64::from(second))
}

pub(super) fn event(kind: &str, second: u32, data: Value) -> TypedEvent {
    let mut event = make_typed_event(kind, data);
    event.raw.timestamp = Some(at(second));
    event.raw.id = Some(format!("{kind}-{second}"));
    event
}

/// Copilot's `session.start` in a GitHub repository.
pub(super) fn start(repository: &str, host: Option<&str>) -> TypedEvent {
    let mut context =
        json!({"cwd": "/work", "branch": "main", "repository": repository, "hostType": "github"});
    if let Some(host) = host {
        context["repositoryHost"] = json!(host);
    }
    event("session.start", 0, json!({"context": context}))
}

/// A tool call and its result.
pub(super) fn tool(
    id: &str,
    second: u32,
    name: &str,
    args: Value,
    complete: Value,
) -> Vec<TypedEvent> {
    let mut complete = complete;
    complete["toolCallId"] = json!(id);
    vec![
        event(
            "tool.execution_start",
            second,
            json!({"toolCallId": id, "toolName": name, "arguments": args}),
        ),
        event("tool.execution_complete", second + 1, complete),
    ]
}

/// A Copilot PowerShell call whose output ends with the exit-code trailer.
pub(super) fn copilot_shell(
    id: &str,
    second: u32,
    command: &str,
    output: &str,
    exit: i64,
) -> Vec<TypedEvent> {
    let content = format!("{output}\n<exited with exit code {exit}>");
    tool(
        id,
        second,
        "powershell",
        json!({"command": command}),
        json!({"success": true, "result": {"content": content, "detailedContent": content}}),
    )
}

/// A Claude Code `Bash` call (canonical `shell`) as the translator writes it.
pub(super) fn claude_shell(
    id: &str,
    second: u32,
    command: &str,
    output: &str,
    exit: i64,
) -> Vec<TypedEvent> {
    let complete = if exit == 0 {
        json!({"success": true, "result": {"content": output}, "shellExecution": {"exitCode": 0}})
    } else {
        json!({"success": false, "error": {"message": format!("Exit code {exit}\n{output}")},
            "shellExecution": {"exitCode": exit}})
    };
    tool(id, second, "shell", json!({"command": command}), complete)
}

pub(super) fn user(second: u32, content: &str) -> TypedEvent {
    event("user.message", second, json!({"content": content}))
}

pub(super) fn pr_link(second: u32, number: u32) -> TypedEvent {
    event(
        "pr-link",
        second,
        json!({"type": "pr-link", "sessionId": "s", "prNumber": number,
            "prUrl": format!("https://github.com/{REPO}/pull/{number}"),
            "prRepository": REPO, "timestamp": at(second).to_rfc3339()}),
    )
}

pub(super) fn extract(events: &[TypedEvent]) -> SessionPullRequests {
    extract_pull_requests(events, RepositoryHint::default())
}

pub(super) fn extract_flat(events: Vec<Vec<TypedEvent>>) -> SessionPullRequests {
    let events: Vec<TypedEvent> = events.into_iter().flatten().collect();
    extract(&events)
}

/// `owner/repo#N:roles` for each pull request, in result order.
pub(super) fn summary(found: &SessionPullRequests) -> Vec<String> {
    found.pull_requests.iter().map(describe).collect()
}

pub(super) fn describe(pr: &LinkedPullRequest) -> String {
    let roles: Vec<&str> = pr
        .roles
        .iter()
        .map(|role| match role {
            PullRequestRole::Created => "created",
            PullRequestRole::Updated => "updated",
            PullRequestRole::Merged => "merged",
            PullRequestRole::Reviewed => "reviewed",
            PullRequestRole::Mentioned => "mentioned",
        })
        .collect();
    format!(
        "{}/{}#{}:{}",
        pr.key.owner,
        pr.key.repo,
        pr.key.number,
        roles.join(",")
    )
}

pub(super) fn only(found: &SessionPullRequests) -> &LinkedPullRequest {
    assert_eq!(found.pull_requests.len(), 1, "{:?}", summary(found));
    &found.pull_requests[0]
}
