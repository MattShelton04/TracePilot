//! Text helpers: bounding and cleaning tool output, reading pull request
//! addresses, and validating the names a transcript supplies.

use std::borrow::Cow;

/// Outputs larger than this are read only at their edges.
const MAX_OUTPUT: usize = 1 << 20;
/// How much of each edge of a large output is read.
const KEEP_EDGE: usize = 64 * 1024;
const MAX_TITLE_CHARS: usize = 200;
const MAX_REF_LEN: usize = 255;

/// The parts of one output worth scanning: all of it, or its first and last
/// 64 KB when it is larger than 1 MB.
pub(super) fn bounded(text: &str) -> [&str; 2] {
    if text.len() <= MAX_OUTPUT {
        return [text, ""];
    }
    let mut head = KEEP_EDGE;
    while !text.is_char_boundary(head) {
        head -= 1;
    }
    let mut tail = text.len() - KEEP_EDGE;
    while !text.is_char_boundary(tail) {
        tail += 1;
    }
    [&text[..head], &text[tail..]]
}

/// Terminal output without ANSI escapes or Braille spinner frames, with lone
/// carriage returns read as line breaks. Borrowed when there is nothing to do.
pub(super) fn clean(text: &str) -> Cow<'_, str> {
    let bytes = text.as_bytes();
    let dirty = bytes.iter().enumerate().any(|(i, &b)| {
        b == 0x1b
            || b == b'\r'
            // U+2800–U+28FF encode as E2 A0..=A3 xx.
            || (b == 0xe2 && matches!(bytes.get(i + 1), Some(0xa0..=0xa3)))
    });
    if !dirty {
        return Cow::Borrowed(text);
    }
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\u{1b}' => match chars.next() {
                Some('[') => {
                    for c in chars.by_ref() {
                        if ('\u{40}'..='\u{7e}').contains(&c) {
                            break;
                        }
                    }
                }
                Some(']') => {
                    while let Some(c) = chars.next() {
                        if c == '\u{7}' || (c == '\u{1b}' && chars.next_if_eq(&'\\').is_some()) {
                            break;
                        }
                    }
                }
                _ => {}
            },
            '\r' => {
                if chars.peek() != Some(&'\n') {
                    out.push('\n');
                }
            }
            '\u{2800}'..='\u{28ff}' => {}
            c => out.push(c),
        }
    }
    Cow::Owned(out)
}

/// A pull request address found in text. `host` is lowercase; owner and
/// repository keep their case.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct UrlMatch<'a> {
    pub(super) start: usize,
    pub(super) end: usize,
    pub(super) host: String,
    pub(super) owner: &'a str,
    pub(super) repo: &'a str,
    pub(super) number: u32,
}

/// Every well-formed `http(s)://HOST/OWNER/REPO/pull/N` address in `text`,
/// in order. Hosts are not checked here (see [`Hosts`]); placeholders are.
pub(super) fn pr_urls(text: &str) -> impl Iterator<Item = UrlMatch<'_>> {
    let mut from = 0;
    std::iter::from_fn(move || {
        while let Some(found) = text[from..].find("://") {
            let at = from + found;
            from = at + 3;
            if let Some(url) = parse_url_at(text, at) {
                from = url.end;
                return Some(url);
            }
        }
        from = text.len();
        None
    })
}

/// The address whose `://` is at `sep`, when it is a valid pull request.
fn parse_url_at(text: &str, sep: usize) -> Option<UrlMatch<'_>> {
    let before = &text.as_bytes()[..sep];
    let start = if ends_with_ignore_case(before, b"https") {
        sep - 5
    } else if ends_with_ignore_case(before, b"http") {
        sep - 4
    } else {
        return None;
    };
    let rest = &text[sep + 3..];
    let host_len = rest
        .bytes()
        .take_while(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-'))
        .count();
    let host = &rest[..host_len];
    let rest = rest[host_len..].strip_prefix('/')?;
    let (owner, rest) = take_while(rest, is_owner_byte);
    let rest = rest.strip_prefix('/')?;
    let (repo, rest) = take_while(rest, is_repo_byte);
    let rest = rest.strip_prefix("/pull/")?;
    let (digits, rest) = take_while(rest, |b| b.is_ascii_digit());
    if !(valid_host(host) && valid_owner(owner) && valid_repo(repo)) {
        return None;
    }
    if is_placeholder(owner, repo) || !ends_reference(rest) {
        return None;
    }
    let number = parse_number(digits)?;
    Some(UrlMatch {
        start,
        end: text.len() - rest.len(),
        host: host.to_ascii_lowercase(),
        owner,
        repo,
        number,
    })
}

fn ends_with_ignore_case(bytes: &[u8], suffix: &[u8]) -> bool {
    bytes.len() >= suffix.len() && bytes[bytes.len() - suffix.len()..].eq_ignore_ascii_case(suffix)
}

fn take_while(text: &str, keep: impl Fn(u8) -> bool) -> (&str, &str) {
    let len = text.bytes().take_while(|b| keep(*b)).count();
    text.split_at(len)
}

/// What may follow a pull request number: the end, a path, fragment or
/// query, whitespace, a quote or closing punctuation.
fn ends_reference(rest: &str) -> bool {
    rest.chars().next().is_none_or(|c| {
        c.is_whitespace()
            || matches!(
                c,
                '/' | '#'
                    | '?'
                    | '"'
                    | '\''
                    | '`'
                    | ')'
                    | ']'
                    | '>'
                    | '<'
                    | '}'
                    | ','
                    | '.'
                    | ';'
                    | ':'
                    | '|'
                    | '*'
                    | '\\'
            )
    })
}

/// 1–9 digits, greater than zero.
pub(super) fn parse_number(digits: &str) -> Option<u32> {
    if digits.is_empty() || digits.len() > 9 || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    digits.parse().ok().filter(|n| *n > 0)
}

fn is_owner_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'-'
}

fn is_repo_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-')
}

pub(super) fn valid_owner(owner: &str) -> bool {
    (1..=39).contains(&owner.len()) && !owner.starts_with('-') && owner.bytes().all(is_owner_byte)
}

pub(super) fn valid_repo(repo: &str) -> bool {
    (1..=100).contains(&repo.len()) && repo != "." && repo != ".." && repo.bytes().all(is_repo_byte)
}

/// A DNS host name with at least one dot.
pub(super) fn valid_host(host: &str) -> bool {
    host.len() <= 253
        && host.contains('.')
        && host.split('.').all(|label| {
            (1..=63).contains(&label.len())
                && !label.starts_with('-')
                && label
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        })
}

/// Documentation examples, never real pull requests. `example` is not an
/// owner here: TracePilot's own synthetic sessions use `example/<name>`.
pub(super) fn is_placeholder(owner: &str, repo: &str) -> bool {
    const OWNERS: &[&str] = &[
        "owner",
        "owner-name",
        "user",
        "username",
        "your-username",
        "yourusername",
        "your-name",
        "yourname",
        "org",
        "org-name",
        "your-org",
        "yourorg",
        "my-org",
        "myorg",
        "octo-org",
        "foo",
    ];
    const REPOS: &[&str] = &[
        "repo",
        "repo-name",
        "your-repo",
        "yourrepo",
        "my-repo",
        "repository",
        "octo-repo",
    ];
    let owner = owner.to_ascii_lowercase();
    let repo = repo.to_ascii_lowercase();
    OWNERS.contains(&owner.as_str())
        || REPOS.contains(&repo.as_str())
        || (owner == "octocat" && repo == "hello-world")
}

/// `owner/repo`, validated and not a placeholder.
pub(super) fn parse_slug(slug: &str) -> Option<(&str, &str)> {
    let (owner, repo) = slug.trim().split_once('/')?;
    let repo = repo.strip_suffix(".git").unwrap_or(repo);
    (valid_owner(owner) && valid_repo(repo) && !is_placeholder(owner, repo))
        .then_some((owner, repo))
}

/// A branch name git would accept (`git check-ref-format --branch`, roughly).
pub(super) fn valid_ref(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= MAX_REF_LEN
        && name != "HEAD"
        && !name.starts_with(['-', '/', '.'])
        && !name.ends_with(['/', '.'])
        && !name.ends_with(".lock")
        && !name.contains("..")
        && !name.contains("@{")
        && !name.contains("//")
        && !name
            .chars()
            .any(|c| c.is_control() || c.is_whitespace() || "~^:?*[\\".contains(c))
}

/// A branch reference as stored: `refs/heads/` stripped, then validated.
pub(super) fn branch_ref(name: &str) -> Option<String> {
    let name = name.trim();
    let name = name.strip_prefix("refs/heads/").unwrap_or(name);
    (valid_ref(name) && !name.starts_with("refs/")).then(|| name.to_string())
}

/// A display title: control characters dropped, whitespace collapsed, at
/// most 200 characters.
pub(super) fn clean_title(title: &str) -> Option<String> {
    let mut out = String::with_capacity(title.len().min(MAX_TITLE_CHARS * 4));
    let mut count = 0;
    for word in title.split(|c: char| c.is_whitespace() || c.is_control()) {
        if word.is_empty() {
            continue;
        }
        if count > 0 {
            if count + 1 >= MAX_TITLE_CHARS {
                break;
            }
            out.push(' ');
            count += 1;
        }
        for c in word.chars() {
            if count == MAX_TITLE_CHARS {
                break;
            }
            out.push(c);
            count += 1;
        }
    }
    (!out.is_empty()).then_some(out)
}

/// Hosts a pull request may live on: GitHub, GitHub Enterprise Cloud
/// (`*.ghe.com`), and any server host the session itself recorded.
#[derive(Debug, Default)]
pub(super) struct Hosts {
    extra: Vec<String>,
}

impl Hosts {
    pub(super) fn add(&mut self, host: &str) {
        let host = host.trim().to_ascii_lowercase();
        if valid_host(&host) && !self.extra.contains(&host) {
            self.extra.push(host);
        }
    }

    pub(super) fn allows(&self, host: &str) -> bool {
        host == "github.com" || host.ends_with(".ghe.com") || self.extra.iter().any(|h| h == host)
    }
}
