//! Reading what `gh pr` and `git push` printed. Every function takes output
//! already bounded and cleaned ([`super::text::clean`]).

use serde_json::Value;

use super::text::{Hosts, UrlMatch, branch_ref, parse_number, parse_slug, pr_urls, valid_host};

/// `<exited with exit code N>` (Copilot sync shells) or `<shellId: X
/// completed with exit code N>` (async shells read later); the last wins.
pub(super) fn exit_code_trailer(text: &str) -> Option<i64> {
    let at = text.rfind(" with exit code ")?;
    let digits: String = text[at + 16..]
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '-')
        .collect();
    digits.parse().ok()
}

/// The shell id of an async Copilot command that was still running when its
/// call returned: `<command with shellId: X is still running …`.
pub(super) fn running_shell_id(text: &str) -> Option<&str> {
    let rest = &text[text.find("with shellId: ")? + 14..];
    let id = rest.split_whitespace().next()?;
    rest[id.len()..]
        .trim_start()
        .starts_with("is still running")
        .then_some(id)
}

/// A pull request `gh pr create` printed: a bare address line, or the TTY
/// progress line `Creating [draft ]pull request for H into B in O/R` with
/// the address glued to its end.
#[derive(Debug)]
pub(super) struct Created<'a> {
    pub(super) url: UrlMatch<'a>,
    pub(super) head: Option<String>,
    pub(super) base: Option<String>,
    /// Printed on (or after) `gh`'s own progress line, not as a bare line
    /// another command could have printed.
    pub(super) progress: bool,
}

pub(super) fn created(text: &str) -> Vec<Created<'_>> {
    let mut found = Vec::new();
    let mut previous = "";
    for line in text.split('\n') {
        let Some(url) = pr_urls(line).next() else {
            if !line.trim().is_empty() {
                previous = line;
            }
            continue;
        };
        let prefix = line[..url.start].trim();
        let suffix = line[url.end..].trim();
        let is_progress =
            |text: &str| text.contains("Creating ") && text.contains("pull request for ");
        let progress = is_progress(prefix);
        let exists = previous.trim_end().ends_with("already exists:");
        // Copilot's preview of a large output can start mid-way through
        // the progress line: `ePilot⣾⣽https://…`.
        let preview_tail =
            previous.starts_with("Preview (first") && !prefix.contains(char::is_whitespace);
        if suffix.is_empty() && !exists && (prefix.is_empty() || progress || preview_tail) {
            let after_progress = is_progress(previous);
            let (head, base) = if progress {
                creating_refs(prefix)
            } else if after_progress {
                // A carriage return put the address on its own line.
                creating_refs(previous.trim())
            } else {
                (None, None)
            };
            found.push(Created {
                url,
                head,
                base,
                progress: progress || after_progress || preview_tail,
            });
        }
        previous = line;
    }
    found
}

/// `… for H into B in O/R` → (H, B).
fn creating_refs(line: &str) -> (Option<String>, Option<String>) {
    let Some(rest) = line.split_once("pull request for ").map(|(_, r)| r) else {
        return (None, None);
    };
    let Some((head, rest)) = rest.split_once(" into ") else {
        return (None, None);
    };
    let base = rest.split_once(" in ").map_or(rest, |(base, _)| base);
    (branch_ref(head), branch_ref(base))
}

/// `a pull request for branch "H" into branch "B" already exists:` and the
/// address after it.
#[derive(Debug)]
pub(super) struct Existing<'a> {
    pub(super) url: UrlMatch<'a>,
    pub(super) head: Option<String>,
    pub(super) base: Option<String>,
}

/// Reads only the marker's line and the next, so the work is linear.
pub(super) fn already_exists(text: &str) -> Vec<Existing<'_>> {
    const MARKER: &str = "already exists:";
    let mut found = Vec::new();
    let mut lines = text.split('\n').peekable();
    while let Some(line) = lines.next() {
        let Some(at) = line.find(MARKER) else {
            continue;
        };
        let rest = line[at + MARKER.len()..].trim();
        let url = if rest.is_empty() {
            lines.peek().map(|next| next.trim())
        } else {
            Some(rest)
        }
        .and_then(|candidate| pr_urls(candidate).next().filter(|url| url.start == 0));
        let Some(url) = url else {
            continue;
        };
        let quoted = quoted_values(&line[..at]);
        let head = quoted.first().and_then(|h| branch_ref(h));
        let base = quoted.get(1).and_then(|b| branch_ref(b));
        found.push(Existing { url, head, base });
    }
    found
}

/// The values between double quotes on a line, with `\"` read as `"`.
fn quoted_values(line: &str) -> Vec<&str> {
    let line = line.trim_end();
    let mut values = Vec::new();
    let mut parts = line.split('"');
    parts.next();
    while let Some(value) = parts.next() {
        values.push(value.strip_suffix('\\').unwrap_or(value));
        parts.next();
    }
    values
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Status {
    Merged,
    Closed,
    Reopened,
    Ready,
    AutoMerge,
}

/// A `gh pr` status line: `✓ Squashed and merged pull request O/R#N (title)`.
#[derive(Debug)]
pub(super) struct StatusLine<'a> {
    pub(super) status: Status,
    pub(super) slug: Option<(&'a str, &'a str)>,
    pub(super) number: u32,
    pub(super) title: Option<&'a str>,
    /// `Deleted remote branch X` after a merge or close.
    pub(super) deleted_branch: Option<String>,
}

pub(super) fn status_lines(text: &str) -> Vec<StatusLine<'_>> {
    const VERBS: &[(&str, Status)] = &[
        ("Squashed and merged pull request ", Status::Merged),
        ("Rebased and merged pull request ", Status::Merged),
        ("Merged pull request ", Status::Merged),
        ("Closed pull request ", Status::Closed),
        ("Reopened pull request ", Status::Reopened),
    ];
    let mut found: Vec<StatusLine<'_>> = Vec::new();
    for line in text.lines() {
        let line = line.trim_end();
        let deleted = [
            "Deleted remote branch ",
            "Deleted local branch ",
            "Deleted branch ",
        ]
        .iter()
        .find_map(|marker| line.find(marker).map(|i| i + marker.len()));
        if let Some(at) = deleted {
            if let Some(last) = found.last_mut()
                && last.deleted_branch.is_none()
                && matches!(last.status, Status::Merged | Status::Closed)
            {
                last.deleted_branch = line[at..].split_whitespace().next().and_then(branch_ref);
            }
            continue;
        }
        let parsed = VERBS
            .iter()
            .find_map(|(verb, status)| line.find(verb).map(|i| (*status, &line[i + verb.len()..])))
            .or_else(|| {
                let rest = &line[line.find("Pull request ")? + 13..];
                let status = if rest.contains(" is marked as \"ready for review\"") {
                    Status::Ready
                } else if rest.contains(" will be automatically merged") {
                    Status::AutoMerge
                } else {
                    return None;
                };
                Some((status, rest))
            });
        let Some((status, rest)) = parsed else {
            continue;
        };
        let (reference, after) = rest.split_once(char::is_whitespace).unwrap_or((rest, ""));
        let Some((slug, number)) = reference.rsplit_once('#') else {
            continue;
        };
        let Some(number) = parse_number(number) else {
            continue;
        };
        let slug = if slug.is_empty() {
            None
        } else {
            match parse_slug(slug) {
                Some(slug) => Some(slug),
                None => continue,
            }
        };
        let title = (status != Status::Ready && status != Status::AutoMerge)
            .then(|| after.trim().strip_prefix('(')?.strip_suffix(')'))
            .flatten();
        found.push(StatusLine {
            status,
            slug,
            number,
            title,
            deleted_branch: None,
        });
    }
    found
}

/// What `gh pr view` printed about one pull request.
#[derive(Debug, Default)]
pub(super) struct Viewed<'a> {
    pub(super) url: Option<UrlMatch<'a>>,
    pub(super) number: Option<u32>,
    pub(super) head: Option<String>,
    pub(super) base: Option<String>,
    pub(super) title: Option<String>,
    /// Read from a JSON object, which no error message looks like.
    pub(super) from_json: bool,
}

/// `--json` output (`url`, `number`, `headRefName`, `baseRefName`,
/// `title`), the plain `url:` / `number:` fields, the TTY footer `View this
/// pull request on GitHub: URL`, or, when `bare` allows it, an address alone
/// on a line (`--jq .url`) in a short output.
pub(super) fn viewed(text: &str, bare: bool) -> Viewed<'_> {
    let mut viewed = Viewed::default();
    if let Some(object) = first_json_object(text) {
        viewed.from_json = true;
        viewed.number = object
            .get("number")
            .and_then(Value::as_u64)
            .and_then(|n| u32::try_from(n).ok())
            .filter(|n| *n > 0 && *n < 1_000_000_000);
        let field = |key: &str| object.get(key).and_then(Value::as_str);
        viewed.head = field("headRefName").and_then(branch_ref);
        viewed.base = field("baseRefName").and_then(branch_ref);
        viewed.title = field("title").map(str::to_string);
        if let Some(url) = field("url") {
            // Borrow the address from the output, where the JSON string
            // appears unescaped.
            viewed.url = text
                .find(url)
                .and_then(|at| pr_urls(&text[at..at + url.len()]).next())
                .filter(|m| m.start == 0 && m.end == url.len());
        }
        if viewed.url.is_some() || viewed.number.is_some() {
            return viewed;
        }
        viewed.from_json = false;
    }
    // A PR body printed by `gh pr view` can hold bare addresses; `--jq .url`
    // prints one line (plus the shell's trailer).
    let bare = bare
        && text
            .lines()
            .filter(|l| !l.trim().is_empty() && !l.trim_start().starts_with('<'))
            .count()
            <= 3;
    for line in text.split('\n') {
        let trimmed = line.trim();
        let field = trimmed
            .strip_prefix("url:")
            .or_else(|| trimmed.strip_prefix("View this pull request on GitHub:"));
        if let Some(number) = trimmed.strip_prefix("number:") {
            viewed.number = viewed.number.or_else(|| parse_number(number.trim()));
        }
        let Some(rest) = field.or(bare.then_some(trimmed)).map(str::trim) else {
            continue;
        };
        if viewed.url.is_none()
            && let Some(url) = pr_urls(rest).next()
            && url.start == 0
            && url.end == rest.len()
        {
            viewed.url = Some(url);
        }
    }
    viewed
}

/// The first JSON object that starts a line of `text`.
pub(super) fn first_json_object(text: &str) -> Option<serde_json::Map<String, Value>> {
    let mut from = 0;
    for _ in 0..4 {
        let at = from + text[from..].find('{')?;
        from = at + 1;
        if at > 0 && !text[..at].ends_with('\n') {
            continue;
        }
        let mut values = serde_json::Deserializer::from_str(&text[at..]).into_iter::<Value>();
        if let Some(Ok(Value::Object(object))) = values.next() {
            return Some(object);
        }
    }
    None
}

/// A branch `git push` updated on a GitHub remote.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(super) struct Pushed {
    pub(super) host: String,
    pub(super) owner: String,
    pub(super) repo: String,
    pub(super) branch: String,
}

/// `To <remote>` followed by ref lines: ` * [new branch]  a -> b`,
/// `   1234..5678  a -> b`, ` + 1234...5678 a -> b (forced update)`.
/// Rejected, deleted, up-to-date, tag and `HEAD` lines are skipped.
pub(super) fn pushed(text: &str, hosts: &Hosts) -> Vec<Pushed> {
    let mut found = Vec::new();
    let mut remote: Option<(String, String, String)> = None;
    for line in text.lines() {
        if let Some(url) = line.strip_prefix("To ") {
            remote = remote_repo(url.trim()).filter(|(host, ..)| hosts.allows(host));
            continue;
        }
        let Some((host, owner, repo)) = &remote else {
            continue;
        };
        if let Some(branch) = ref_line(line) {
            found.push(Pushed {
                host: host.clone(),
                owner: owner.clone(),
                repo: repo.clone(),
                branch,
            });
        }
    }
    found
}

fn ref_line(line: &str) -> Option<String> {
    if !line.starts_with([' ', '\t', '*', '+']) {
        return None;
    }
    let mut rest = line.trim_start();
    let flag = rest.chars().next()?;
    if matches!(flag, '!' | '-' | '=') {
        return None;
    }
    if matches!(flag, '*' | '+') {
        rest = rest[1..].trim_start();
    }
    let rest = if let Some(bracketed) = rest.strip_prefix('[') {
        let (summary, rest) = bracketed.split_once(']')?;
        if !matches!(summary, "new branch" | "new reference") {
            return None;
        }
        rest
    } else {
        let (summary, rest) = rest.split_once(char::is_whitespace)?;
        let (old, new) = summary
            .split_once("...")
            .or_else(|| summary.split_once(".."))?;
        let hex = |s: &str| s.len() >= 4 && s.bytes().all(|b| b.is_ascii_hexdigit());
        if !hex(old) || !hex(new) {
            return None;
        }
        rest
    };
    let (_, to) = rest.trim().split_once(" -> ")?;
    let to = to.split_whitespace().next()?;
    if to.starts_with("refs/") && !to.starts_with("refs/heads/") {
        return None;
    }
    branch_ref(to)
}

/// `https://HOST/O/R(.git)`, `git@HOST:O/R(.git)` or `ssh://git@HOST[:port]/O/R(.git)`.
fn remote_repo(url: &str) -> Option<(String, String, String)> {
    let (host, path) = if let Some(rest) = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .or_else(|| url.strip_prefix("ssh://"))
    {
        let (authority, path) = rest.split_once('/')?;
        let host = authority.rsplit_once('@').map_or(authority, |(_, h)| h);
        (host.split_once(':').map_or(host, |(h, _)| h), path)
    } else {
        let (user_host, path) = url.split_once(':')?;
        (user_host.rsplit_once('@')?.1, path)
    };
    let host = host.to_ascii_lowercase();
    let (owner, repo) = parse_slug(path.trim_end_matches('/'))?;
    valid_host(&host).then(|| (host, owner.to_string(), repo.to_string()))
}
