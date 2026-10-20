//! Reading the `gh pr` and `git push` commands in a shell call.
//!
//! A command only counts at command position: the start of a segment after
//! `;`, `&&`, `||`, `|`, `&`, a newline or a bracket, past `cd x &&`, env
//! assignments, `$x =` and a few prefixes. Quotes, here-strings, heredocs
//! and comments are skipped, so `grep 'gh pr create'` or a PR body that
//! mentions a command never reads as one.

use super::lexer::{Token, segments};
use super::text::{UrlMatch, branch_ref, parse_number, pr_urls};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Verb {
    Create,
    Merge,
    View,
    Diff,
    Checks,
    Checkout,
    Review,
    Edit,
    Comment,
    Close,
    Ready,
    Reopen,
}

impl Verb {
    fn parse(word: &str) -> Option<Self> {
        Some(match word {
            "create" | "new" => Self::Create,
            "merge" => Self::Merge,
            "view" => Self::View,
            "diff" => Self::Diff,
            "checks" => Self::Checks,
            "checkout" | "co" => Self::Checkout,
            "review" => Self::Review,
            "edit" => Self::Edit,
            "comment" => Self::Comment,
            "close" => Self::Close,
            "ready" => Self::Ready,
            "reopen" => Self::Reopen,
            _ => return None,
        })
    }

    /// Flags of this subcommand that take a value (`gh pr <verb> --help`).
    fn value_flags(self) -> &'static [&'static str] {
        match self {
            Self::Create => &[
                "-t",
                "--title",
                "-b",
                "--body",
                "-F",
                "--body-file",
                "-B",
                "--base",
                "-H",
                "--head",
                "-l",
                "--label",
                "-a",
                "--assignee",
                "-r",
                "--reviewer",
                "-m",
                "--milestone",
                "-p",
                "--project",
                "-T",
                "--template",
                "--recover",
            ],
            Self::Merge => &[
                "-b",
                "--body",
                "-F",
                "--body-file",
                "-t",
                "--subject",
                "-A",
                "--author-email",
                "--match-head-commit",
            ],
            Self::View | Self::Checks => &[
                "--json",
                "-q",
                "--jq",
                "-t",
                "--template",
                "-i",
                "--interval",
            ],
            Self::Diff => &["--color"],
            Self::Checkout => &["-b", "--branch"],
            Self::Review | Self::Comment => &["-b", "--body", "-F", "--body-file"],
            Self::Edit => &[
                "-t",
                "--title",
                "-b",
                "--body",
                "-F",
                "--body-file",
                "-B",
                "--base",
                "-m",
                "--milestone",
                "--add-label",
                "--remove-label",
                "--add-reviewer",
                "--remove-reviewer",
                "--add-assignee",
                "--remove-assignee",
                "--add-project",
                "--remove-project",
            ],
            Self::Close | Self::Reopen => &["-c", "--comment"],
            Self::Ready => &[],
        }
    }
}

/// The pull request a `gh pr` command names.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum Target {
    /// None: the current branch's pull request.
    Current,
    Number(u32),
    Url {
        host: String,
        owner: String,
        repo: String,
        number: u32,
    },
    Branch(String),
    /// A variable, or something that isn't a pull request reference.
    Unknown,
}

/// The `-R`/`--repo` flag.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum RepoFlag {
    Absent,
    Given(String),
    Unknown,
}

/// One `gh pr <verb>` at command position.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct GhPr {
    pub(super) verb: Verb,
    pub(super) target: Target,
    pub(super) repo: RepoFlag,
    pub(super) title: Option<String>,
    pub(super) head: Option<String>,
    pub(super) base: Option<String>,
    /// `gh pr merge --auto`: merges later, if at all.
    pub(super) auto: bool,
}

/// What a shell command does that matters here.
#[derive(Debug, Default)]
pub(super) struct ShellCommand {
    pub(super) gh: Vec<GhPr>,
    pub(super) pushes: bool,
}

impl ShellCommand {
    pub(super) fn is_empty(&self) -> bool {
        self.gh.is_empty() && !self.pushes
    }

    pub(super) fn has(&self, verb: Verb) -> bool {
        self.gh.iter().any(|gh| gh.verb == verb)
    }

    pub(super) fn with(&self, verb: Verb) -> impl Iterator<Item = &GhPr> {
        self.gh.iter().filter(move |gh| gh.verb == verb)
    }
}

/// Parse a command, cheaply skipping ones that mention neither tool.
pub(super) fn parse_command(command: &str) -> ShellCommand {
    let mut parsed = ShellCommand::default();
    let maybe_gh = command.contains("gh") && command.contains("pr");
    let maybe_push = command.contains("git") && command.contains("push");
    if !maybe_gh && !maybe_push {
        return parsed;
    }
    for segment in segments(command) {
        let words = command_words(&segment);
        let Some(first) = words.first() else { continue };
        let program = first.text.to_ascii_lowercase();
        if matches!(program.as_str(), "gh" | "gh.exe") {
            if let Some(gh) = gh_pr(&words[1..]) {
                parsed.gh.push(gh);
            }
        } else if matches!(program.as_str(), "git" | "git.exe") && is_push(&words[1..]) {
            parsed.pushes = true;
        }
    }
    parsed
}

/// The words of a segment from its command on: prefixes, assignments and
/// keywords dropped.
fn command_words(segment: &[Token]) -> &[Token] {
    let mut words = segment;
    loop {
        let Some(first) = words.first() else {
            return words;
        };
        let text = first.text.as_str();
        let skip = if text.starts_with('$') && words.get(1).is_some_and(|w| w.text == "=") {
            2
        } else if is_assignment(text) {
            1
        } else if matches!(text, "cmd" | "cmd.exe")
            && words
                .get(1)
                .is_some_and(|w| w.text.eq_ignore_ascii_case("/c"))
        {
            2
        } else if matches!(
            text,
            "." | "!"
                | "call"
                | "if"
                | "elif"
                | "then"
                | "else"
                | "do"
                | "while"
                | "until"
                | "time"
                | "command"
                | "exec"
                | "nohup"
                | "sudo"
                | "env"
                | "eval"
        ) {
            1
        } else {
            return words;
        };
        words = &words[skip..];
    }
}

/// `NAME=value` (bash) or `$name=` (PowerShell without spaces).
fn is_assignment(text: &str) -> bool {
    let name = text.strip_prefix('$').unwrap_or(text);
    match name.split_once('=') {
        Some((name, _)) => {
            !name.is_empty()
                && !name.starts_with(|c: char| c.is_ascii_digit())
                && name
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == ':')
        }
        None => false,
    }
}

/// `git [-C dir] [-c k=v] [--opt] push`.
fn is_push(words: &[Token]) -> bool {
    let mut i = 0;
    while let Some(word) = words.get(i) {
        match word.text.as_str() {
            "push" => return true,
            "-C" | "-c" | "--git-dir" | "--work-tree" | "--namespace" => i += 2,
            text if text.starts_with('-') => i += 1,
            _ => return false,
        }
    }
    false
}

fn gh_pr(words: &[Token]) -> Option<GhPr> {
    if words.first()?.text != "pr" {
        return None;
    }
    let verb = Verb::parse(&words.get(1)?.text)?;
    let mut gh = GhPr {
        verb,
        target: Target::Current,
        repo: RepoFlag::Absent,
        title: None,
        head: None,
        base: None,
        auto: false,
    };
    let mut positional = None;
    let mut rest = words[2..].iter();
    let mut flags_done = false;
    while let Some(word) = rest.next() {
        let text = word.text.as_str();
        if flags_done || !text.starts_with('-') || text == "-" {
            if positional.is_none() {
                positional = Some(word);
            }
            continue;
        }
        if text == "--" {
            flags_done = true;
            continue;
        }
        let (flag, inline) = match text.split_once('=') {
            Some((flag, value)) if flag.starts_with("--") => (flag, Some(value)),
            _ => (text, None),
        };
        let takes_value = matches!(flag, "-R" | "--repo") || verb.value_flags().contains(&flag);
        let value = if !takes_value {
            None
        } else if let Some(value) = inline {
            Some((value.to_string(), word.expands))
        } else {
            rest.next().map(|w| (w.text.clone(), w.expands))
        };
        if flag == "--auto" {
            gh.auto = true;
        }
        let Some((value, expands)) = value else {
            continue;
        };
        let known = (!expands).then_some(value);
        match flag {
            "-R" | "--repo" => {
                gh.repo = known.map_or(RepoFlag::Unknown, RepoFlag::Given);
            }
            "-t" | "--title" if matches!(verb, Verb::Create | Verb::Edit) => gh.title = known,
            "-H" | "--head" if verb == Verb::Create => {
                gh.head = known.and_then(|head| {
                    // `owner:branch` names a fork's branch.
                    let branch = head.rsplit_once(':').map_or(head.as_str(), |(_, b)| b);
                    branch_ref(branch)
                });
            }
            "-B" | "--base" if matches!(verb, Verb::Create | Verb::Edit) => {
                gh.base = known.and_then(|base| branch_ref(&base));
            }
            _ => {}
        }
    }
    gh.target = positional.map_or(Target::Current, target);
    Some(gh)
}

fn target(word: &Token) -> Target {
    if word.expands {
        return Target::Unknown;
    }
    let text = word.text.trim();
    let digits = text.strip_prefix('#').unwrap_or(text);
    if !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit()) {
        return parse_number(digits).map_or(Target::Unknown, Target::Number);
    }
    if text.contains("://") {
        return match pr_urls(text).next() {
            Some(UrlMatch {
                start: 0,
                host,
                owner,
                repo,
                number,
                ..
            }) => Target::Url {
                host,
                owner: owner.to_string(),
                repo: repo.to_string(),
                number,
            },
            _ => Target::Unknown,
        };
    }
    let branch = text.rsplit_once(':').map_or(text, |(_, b)| b);
    branch_ref(branch).map_or(Target::Unknown, Target::Branch)
}
