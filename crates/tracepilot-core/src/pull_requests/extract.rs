//! The extractor: one pass to join tool calls with their results, then one
//! in event order that tracks the session's repository and reads each piece
//! of evidence.
//!
//! Evidence comes only from tool calls and their output, Claude Code's
//! `pr-link` records and the user's own prompts. Assistant text, fetched
//! pages, file reads, list and search results, system messages, compaction
//! summaries and hook payloads are never read.

mod calls;
mod collect;
mod command;
mod evaluate;
mod lexer;
mod output;
#[cfg(test)]
mod test_support;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_shell;
mod text;

use serde_json::Value;

use self::calls::CallKind;
use self::collect::{Collector, Hit};
use self::text::{Hosts, bounded, parse_slug, pr_urls, valid_host};
use super::model::{
    PullRequestEvidence, PullRequestKey, PullRequestRole, RepositoryHint, SessionPullRequests,
};
use crate::parsing::events::TypedEvent;

/// A repository on a known host.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Repo {
    host: String,
    owner: String,
    repo: String,
}

impl Repo {
    fn key(&self, number: u32) -> PullRequestKey {
        PullRequestKey {
            host: self.host.clone(),
            owner: self.owner.clone(),
            repo: self.repo.clone(),
            number,
        }
    }

    fn same(&self, owner: &str, repo: &str) -> bool {
        self.owner.eq_ignore_ascii_case(owner) && self.repo.eq_ignore_ascii_case(repo)
    }

    /// `owner/repo` on `host`, or on GitHub when the host kind is GitHub or
    /// unknown. Another host kind (Azure DevOps, …) has no pull requests here.
    fn parse(slug: &str, host: Option<&str>, host_type: Option<&str>) -> Option<Self> {
        let (owner, repo) = parse_slug(slug)?;
        let host = match host.map(|h| h.trim().to_ascii_lowercase()) {
            Some(host) if valid_host(&host) => host,
            _ if host_type.is_none_or(|t| t.eq_ignore_ascii_case("github")) => {
                "github.com".to_string()
            }
            _ => return None,
        };
        Some(Self {
            host,
            owner: owner.to_string(),
            repo: repo.to_string(),
        })
    }
}

/// What the session says about where it is.
struct Scope {
    hosts: Hosts,
    /// The repository from the latest start, resume or context change.
    current: Option<Repo>,
    /// The repository the caller knows for the whole session.
    fallback: Option<Repo>,
}

impl Scope {
    fn repo(&self) -> Option<&Repo> {
        self.current.as_ref().or(self.fallback.as_ref())
    }

    /// The host of `owner/repo`: the session's own when it is that
    /// repository, else GitHub.
    fn host_for(&self, owner: &str, repo: &str) -> String {
        [self.current.as_ref(), self.fallback.as_ref()]
            .into_iter()
            .flatten()
            .find(|r| r.same(owner, repo))
            .map_or_else(|| "github.com".to_string(), |r| r.host.clone())
    }

    fn update(&mut self, event: &TypedEvent) {
        let data = &event.raw.data;
        let context = data
            .get("context")
            .filter(|c| c.is_object())
            .unwrap_or(data);
        let field = |key: &str| context.get(key).and_then(Value::as_str);
        let Some(slug) = field("repository") else {
            return;
        };
        self.current = Repo::parse(slug, field("repositoryHost"), field("hostType"));
    }
}

fn is_context(event_type: &str) -> bool {
    matches!(
        event_type,
        "session.start" | "session.resume" | "session.context_changed"
    )
}

/// Find the pull requests a session is linked to.
pub fn extract_pull_requests(
    events: &[TypedEvent],
    hint: RepositoryHint<'_>,
) -> SessionPullRequests {
    let mut hosts = Hosts::default();
    for event in events {
        let data = &event.raw.data;
        if is_context(&event.raw.event_type) {
            let context = data
                .get("context")
                .filter(|c| c.is_object())
                .unwrap_or(data);
            if let Some(host) = context.get("repositoryHost").and_then(Value::as_str) {
                hosts.add(host);
            }
        } else if event.raw.event_type == "pr-link"
            && let Some(url) = data.get("prUrl").and_then(Value::as_str)
            && let Some(url) = pr_urls(url).next()
        {
            // Claude Code wrote it from `gh`'s own output: its host is real.
            hosts.add(&url.host);
        }
    }
    let fallback = hint
        .repository
        .and_then(|slug| Repo::parse(slug, None, hint.host_type));
    let mut scope = Scope {
        hosts,
        current: None,
        fallback,
    };
    let calls = calls::collect(events);
    let mut calls = calls.iter().peekable();
    let mut out = Collector::default();
    for (index, event) in events.iter().enumerate() {
        let at = event.raw.timestamp;
        match event.raw.event_type.as_str() {
            kind if is_context(kind) => scope.update(event),
            "user.message" => {
                if !is_user_prompt(event) {
                    continue;
                }
                let content = event.raw.data.get("content").and_then(Value::as_str);
                for part in content.into_iter().flat_map(bounded) {
                    for url in pr_urls(part) {
                        if let Some(key) = scope.url_key(&url) {
                            let role = Some(PullRequestRole::Mentioned);
                            out.add(Hit::new(
                                key,
                                role,
                                PullRequestEvidence::UserMessage,
                                index,
                                at,
                            ));
                        }
                    }
                }
            }
            "pr-link" => {
                if let Some(key) = pr_link_key(&event.raw.data, &scope) {
                    out.add(Hit::new(key, None, PullRequestEvidence::PrLink, index, at));
                }
            }
            "tool.execution_start" => {
                while let Some(call) = calls.next_if(|call| call.start <= index) {
                    if call.start != index {
                        continue;
                    }
                    match &call.kind {
                        CallKind::Shell(command) => {
                            evaluate::shell(index, call, command, &scope, &mut out);
                        }
                        CallKind::Mcp { kind, args } => {
                            evaluate::mcp(index, call, *kind, args, &scope, &mut out);
                        }
                    }
                }
            }
            _ => {}
        }
    }
    out.finish()
}

/// A prompt the user typed: no agent owns it, and its source (when
/// recorded) is the user. System, skill, subagent and command-output
/// messages are not prompts.
fn is_user_prompt(event: &TypedEvent) -> bool {
    event.raw.agent_id.is_none()
        && match event.raw.data.get("source") {
            None | Some(Value::Null) => true,
            Some(source) => source.as_str() == Some("user"),
        }
}

/// Claude Code's `pr-link`: `prUrl` when it is a valid address, else
/// `prRepository` and `prNumber` on GitHub.
fn pr_link_key(data: &Value, scope: &Scope) -> Option<PullRequestKey> {
    let number = match data.get("prNumber")? {
        Value::Number(n) => n.as_u64().and_then(|n| u32::try_from(n).ok()),
        Value::String(n) => text::parse_number(n.trim()),
        _ => None,
    }
    .filter(|n| *n > 0 && *n < 1_000_000_000);
    let url = data
        .get("prUrl")
        .and_then(Value::as_str)
        .and_then(|u| pr_urls(u).next())
        .filter(|url| url.start == 0 && number.is_none_or(|n| n == url.number));
    if let Some(url) = url {
        return scope.url_key(&url);
    }
    let (owner, repo) = parse_slug(data.get("prRepository")?.as_str()?)?;
    Some(PullRequestKey {
        host: "github.com".to_string(),
        owner: owner.to_string(),
        repo: repo.to_string(),
        number: number?,
    })
}
