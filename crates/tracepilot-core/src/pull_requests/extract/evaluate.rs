//! Second pass over one call: what its command and output say about pull
//! requests, given the repository in effect when it ran.

use std::borrow::Cow;
use std::collections::HashSet;

use serde_json::Value;

use super::calls::{Call, McpKind};
use super::collect::{Collector, Hit};
use super::command::{GhPr, RepoFlag, ShellCommand, Target, Verb};
use super::output::{self, Status, first_json_object};
use super::text::{UrlMatch, bounded, branch_ref, clean, parse_number, parse_slug, pr_urls};
use super::{Repo, Scope};
use crate::pull_requests::model::{
    PullRequestEvidence as Evidence, PullRequestKey, PullRequestRole as Role,
};

/// Output that shows a `gh` command failed although the shell's exit code
/// came from a later command.
fn looks_failed(texts: &[Cow<'_, str>]) -> bool {
    const MARKERS: &[&str] = &[
        "graphql:",
        "could not",
        "no pull requests found",
        "failed to",
        "not mergeable",
        "unknown flag",
        "unknown command",
        "accepts at most",
        "already merged",
        "http 4",
        "error:",
        "is not recognized",
        "parsererror",
    ];
    texts.iter().any(|text| {
        let lower = text.to_ascii_lowercase();
        MARKERS.iter().any(|marker| lower.contains(marker))
    })
}

impl Scope {
    pub(super) fn url_key(&self, url: &UrlMatch<'_>) -> Option<PullRequestKey> {
        self.hosts.allows(&url.host).then(|| PullRequestKey {
            host: url.host.clone(),
            owner: url.owner.to_string(),
            repo: url.repo.to_string(),
            number: url.number,
        })
    }

    fn slug_key(&self, owner: &str, repo: &str, number: u32) -> PullRequestKey {
        Repo {
            host: self.host_for(owner, repo),
            owner: owner.to_string(),
            repo: repo.to_string(),
        }
        .key(number)
    }

    /// The repository a `gh` command acts on: its `-R`, else the session's.
    fn repo_for(&self, flag: &RepoFlag) -> Option<Repo> {
        match flag {
            RepoFlag::Absent => self.repo().cloned(),
            RepoFlag::Unknown => None,
            RepoFlag::Given(value) => {
                let value = value
                    .strip_prefix("https://")
                    .or_else(|| value.strip_prefix("http://"))
                    .unwrap_or(value);
                let value = value.trim_end_matches('/');
                let (host, slug) = match value.matches('/').count() {
                    1 => (None, value),
                    2 => {
                        let (host, slug) = value.split_once('/')?;
                        (Some(host.to_ascii_lowercase()), slug)
                    }
                    _ => return None,
                };
                let (owner, repo) = parse_slug(slug)?;
                let host = host.unwrap_or_else(|| self.host_for(owner, repo));
                self.hosts.allows(&host).then(|| Repo {
                    host,
                    owner: owner.to_string(),
                    repo: repo.to_string(),
                })
            }
        }
    }

    fn target_key(&self, gh: &GhPr) -> Option<PullRequestKey> {
        match &gh.target {
            Target::Number(number) => self.repo_for(&gh.repo).map(|repo| repo.key(*number)),
            Target::Url {
                host,
                owner,
                repo,
                number,
            } => self.hosts.allows(host).then(|| PullRequestKey {
                host: host.clone(),
                owner: owner.clone(),
                repo: repo.clone(),
                number: *number,
            }),
            _ => None,
        }
    }

    /// A status line's pull request: `O/R#N`, or `#N` in the command's repository.
    fn status_key(
        &self,
        slug: Option<(&str, &str)>,
        number: u32,
        flag: &RepoFlag,
    ) -> Option<PullRequestKey> {
        match slug {
            Some((owner, repo)) => Some(self.slug_key(owner, repo, number)),
            None => self.repo_for(flag).map(|repo| repo.key(number)),
        }
    }
}

/// The `-R` of the only command of these verbs, or none.
fn only_repo<'a>(command: &'a ShellCommand, verbs: &[Verb]) -> &'a RepoFlag {
    let mut matching = command.gh.iter().filter(|gh| verbs.contains(&gh.verb));
    match (matching.next(), matching.next()) {
        (Some(gh), None) => &gh.repo,
        _ => &RepoFlag::Absent,
    }
}

pub(super) fn shell(
    index: usize,
    call: &Call<'_>,
    command: &ShellCommand,
    scope: &Scope,
    out: &mut Collector,
) {
    let texts: Vec<Cow<'_, str>> = call
        .outputs
        .iter()
        .flat_map(|text| bounded(text))
        .filter(|part| !part.is_empty())
        .map(clean)
        .collect();
    let hit = |key, role, evidence| Hit::new(key, Some(role), evidence, index, call.at);
    // A sync call without an exit code (older Copilot, Claude Code without
    // a structured result) succeeded unless it said otherwise.
    let exit_ok = !call.failed
        && call.completed
        && match call.exit_code {
            Some(code) => code == 0,
            None => !call.background,
        };
    let succeeded = exit_ok && !looks_failed(&texts);

    if command.has(Verb::Create) {
        let creates: Vec<&GhPr> = command.with(Verb::Create).collect();
        let created: Vec<_> = texts.iter().flat_map(|t| output::created(t)).collect();
        for (i, found) in created.iter().enumerate() {
            let Some(key) = scope.url_key(&found.url) else {
                continue;
            };
            let source = match creates.len() {
                1 if created.len() == 1 => creates.first(),
                n if n == created.len() => creates.get(i),
                _ => None,
            };
            let head = found
                .head
                .clone()
                .or_else(|| source.and_then(|c| c.head.clone()));
            let base = found
                .base
                .clone()
                .or_else(|| source.and_then(|c| c.base.clone()));
            let title = source.and_then(|c| c.title.as_deref());
            out.add(
                hit(key, Role::Created, Evidence::GhCreate)
                    .refs(head, base)
                    .title(title),
            );
        }
        for found in texts.iter().flat_map(|t| output::already_exists(t)) {
            if let Some(key) = scope.url_key(&found.url) {
                out.add(
                    hit(key, Role::Updated, Evidence::GhCreateExists).refs(found.head, found.base),
                );
            }
        }
    }

    let statuses: Vec<_> = if command.gh.iter().any(|gh| {
        matches!(
            gh.verb,
            Verb::Merge | Verb::Close | Verb::Reopen | Verb::Ready
        )
    }) {
        texts.iter().flat_map(|t| output::status_lines(t)).collect()
    } else {
        Vec::new()
    };
    let mut merge_reported = false;
    for line in &statuses {
        let (role, evidence, verb) = match line.status {
            Status::Merged => (Role::Merged, Evidence::GhMerge, Verb::Merge),
            Status::AutoMerge => (Role::Updated, Evidence::GhCommand, Verb::Merge),
            Status::Closed => (Role::Updated, Evidence::GhCommand, Verb::Close),
            Status::Reopened => (Role::Updated, Evidence::GhCommand, Verb::Reopen),
            Status::Ready => (Role::Updated, Evidence::GhCommand, Verb::Ready),
        };
        if !command.has(verb) {
            continue;
        }
        merge_reported |= verb == Verb::Merge;
        let flag = only_repo(command, &[verb]);
        if let Some(key) = scope.status_key(line.slug, line.number, flag) {
            out.add(
                hit(key, role, evidence)
                    .refs(line.deleted_branch.clone(), None)
                    .title(line.title),
            );
        }
    }

    for gh in &command.gh {
        match gh.verb {
            Verb::Create => {}
            Verb::Merge => {
                // Merged without a status line (`gh` printed nothing, or
                // its output was not recorded): the exit code decides.
                if merge_reported || !succeeded {
                    continue;
                }
                if let Some(key) = scope.target_key(gh) {
                    let (role, evidence) = if gh.auto {
                        (Role::Updated, Evidence::GhCommand)
                    } else {
                        (Role::Merged, Evidence::GhMerge)
                    };
                    out.add(hit(key, role, evidence));
                }
            }
            Verb::Edit | Verb::Comment | Verb::Close | Verb::Ready | Verb::Reopen => {
                if !succeeded {
                    continue;
                }
                let key = match gh.target {
                    Target::Current if command.gh.len() == 1 => texts
                        .iter()
                        .find_map(|t| pr_urls(t).next())
                        .and_then(|url| scope.url_key(&url)),
                    _ => scope.target_key(gh),
                };
                if let Some(key) = key {
                    out.add(hit(key, Role::Updated, Evidence::GhCommand));
                }
            }
            Verb::View if gh.target == Target::Current => {
                if call.failed {
                    continue;
                }
                let Some((key, viewed)) = texts.iter().find_map(|t| {
                    let viewed = output::viewed(t);
                    let key = match &viewed.url {
                        Some(url) => scope.url_key(url),
                        None => viewed
                            .number
                            .and_then(|n| scope.repo_for(&gh.repo).map(|r| r.key(n))),
                    }?;
                    Some((key, viewed))
                }) else {
                    continue;
                };
                let title = viewed.title.as_deref();
                out.add(
                    hit(key, Role::Updated, Evidence::GhViewCurrent)
                        .refs(viewed.head, viewed.base)
                        .title(title),
                );
            }
            Verb::View | Verb::Diff | Verb::Checks | Verb::Checkout | Verb::Review => {
                let checks_ran = gh.verb == Verb::Checks && matches!(call.exit_code, Some(1 | 8));
                if !(exit_ok || (checks_ran && !call.failed)) {
                    continue;
                }
                let key = match &gh.target {
                    Target::Branch(_) if gh.verb == Verb::View => texts
                        .iter()
                        .find_map(|t| output::viewed(t).url.and_then(|url| scope.url_key(&url))),
                    _ => scope.target_key(gh),
                };
                let Some(key) = key else { continue };
                let mut found = hit(key, Role::Reviewed, Evidence::GhCommand);
                if gh.verb == Verb::View && command.gh.len() == 1 {
                    let viewed = texts
                        .iter()
                        .map(|t| output::viewed(t))
                        .find(|v| v.number.is_some());
                    if let Some(viewed) = viewed.filter(|v| v.number == Some(found.key.number)) {
                        let title = viewed.title.clone();
                        found = found.refs(viewed.head, viewed.base).title(title.as_deref());
                    }
                }
                out.add(found);
            }
        }
    }

    if command.pushes {
        let mut seen = HashSet::new();
        for pushed in texts.iter().flat_map(|t| output::pushed(t, &scope.hosts)) {
            if seen.insert(pushed.clone()) {
                out.push(
                    &pushed.host,
                    &pushed.owner,
                    &pushed.repo,
                    &pushed.branch,
                    call.at,
                );
            }
        }
    }
}

fn number_arg(args: &Value) -> Option<u32> {
    ["pullNumber", "pull_number", "pullRequestNumber", "number"]
        .iter()
        .find_map(|key| match args.get(*key)? {
            Value::Number(n) => n
                .as_u64()
                .and_then(|n| u32::try_from(n).ok())
                .filter(|n| *n > 0 && *n < 1_000_000_000),
            Value::String(n) => parse_number(n.trim()),
            _ => None,
        })
}

pub(super) fn mcp(
    index: usize,
    call: &Call<'_>,
    kind: McpKind,
    args: &Value,
    scope: &Scope,
    out: &mut Collector,
) {
    if call.failed || !call.completed {
        return;
    }
    let hit = |key, role, evidence| Hit::new(key, Some(role), evidence, index, call.at);
    let output = call.outputs.first().copied().unwrap_or("");
    match kind {
        McpKind::Bind => {
            let bound = output.contains("Bound ") || output.contains("already bound");
            let url = args
                .get("url")
                .and_then(Value::as_str)
                .and_then(|u| pr_urls(u).next());
            if let Some(key) = url.filter(|_| bound).and_then(|url| scope.url_key(&url)) {
                out.add(hit(key, Role::Updated, Evidence::AppBinding));
            }
        }
        McpKind::Create => {
            let json = (output.len() <= 1 << 20)
                .then(|| first_json_object(output))
                .flatten();
            let url = json.as_ref().and_then(|j| {
                ["html_url", "url"]
                    .iter()
                    .find_map(|k| j.get(*k).and_then(Value::as_str))
            });
            if let Some(key) = url
                .and_then(|u| pr_urls(u).next())
                .and_then(|url| scope.url_key(&url))
            {
                out.add(hit(key, Role::Created, Evidence::McpTool));
            }
        }
        McpKind::Read | McpKind::Merge | McpKind::Update => {
            let owner = args.get("owner").and_then(Value::as_str).unwrap_or("");
            let repo = args.get("repo").and_then(Value::as_str).unwrap_or("");
            let (Some((owner, repo)), Some(number)) = (
                parse_slug(&format!("{owner}/{repo}")).map(|(o, r)| (o.to_string(), r.to_string())),
                number_arg(args),
            ) else {
                return;
            };
            let role = match kind {
                McpKind::Read => Role::Reviewed,
                McpKind::Merge => Role::Merged,
                _ => Role::Updated,
            };
            let mut found = hit(
                scope.slug_key(&owner, &repo, number),
                role,
                Evidence::McpTool,
            );
            let is_get = args
                .get("method")
                .and_then(Value::as_str)
                .is_none_or(|m| m == "get");
            if kind == McpKind::Read
                && is_get
                && output.len() <= 1 << 20
                && let Some(json) = first_json_object(output)
                && json.get("number").and_then(Value::as_u64) == Some(u64::from(number))
            {
                let reference = |side: &str| {
                    json.get(side)
                        .and_then(|s| s.get("ref"))
                        .and_then(Value::as_str)
                        .and_then(branch_ref)
                };
                let title = json.get("title").and_then(Value::as_str);
                found = found
                    .refs(reference("head"), reference("base"))
                    .title(title);
            }
            out.add(found);
        }
    }
}
