//! Pull-request, issue and commit references extracted by the CLI.
//!
//! These are *references found in a session*. They are not proof that the
//! session opened, reviewed, merged or completed that work, and the type
//! names below are chosen so no caller can accidentally imply otherwise.
//!
//! Resolution is deliberately pessimistic. A bare `#123` carries no
//! repository, and a session's repository is only a plausible context for it:
//! cross-repository references are ordinary in review work, so a bare number
//! becomes a *candidate* link, never a verified one. Likewise only 59 of 85
//! locally recorded commit values are 7–40 hex characters — the rest are
//! branch names and other Git refs, so the kind is "git ref", not "SHA".

use serde::{Deserialize, Serialize};

/// Longest reference text this adapter accepts. Anything longer is not a
/// reference the UI can usefully show.
const MAX_REF_LEN: usize = 256;

/// What a reference points at.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WorkRefKind {
    PullRequest,
    Issue,
    /// A Git ref: a commit SHA when it looks like one, otherwise a branch or
    /// tag name. [`WorkRef::is_commit_sha_shaped`] keeps them apart.
    GitRef,
    /// A `ref_type` this build has not seen. Kept searchable rather than
    /// dropped.
    Other(String),
}

impl WorkRefKind {
    pub fn parse(value: &str) -> Self {
        match value.trim().to_ascii_lowercase().as_str() {
            "pr" | "pull_request" | "pullrequest" => Self::PullRequest,
            "issue" => Self::Issue,
            "commit" => Self::GitRef,
            other => Self::Other(other.to_string()),
        }
    }

    pub fn as_str(&self) -> &str {
        match self {
            Self::PullRequest => "pullRequest",
            Self::Issue => "issue",
            Self::GitRef => "gitRef",
            Self::Other(value) => value,
        }
    }

    /// The search qualifier that selects this kind (`pr:`, `issue:`,
    /// `commit:`). `None` for kinds with no qualifier.
    pub fn qualifier(&self) -> Option<&'static str> {
        match self {
            Self::PullRequest => Some("pr"),
            Self::Issue => Some("issue"),
            Self::GitRef => Some("commit"),
            Self::Other(_) => None,
        }
    }

    fn expects_number(&self) -> bool {
        matches!(self, Self::PullRequest | Self::Issue)
    }
}

/// How confidently a reference was tied to a repository.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RefResolution {
    /// The reference itself named the host and repository, so a link is safe.
    Explicit,
    /// The repository came from the session's own context. Plausible, but a
    /// cross-repository mention would make it wrong: show it as context, and
    /// do not present the link as verified.
    SessionContext,
    /// No repository could be attached. Still a useful searchable label.
    Unresolved,
    /// The value did not survive validation: a non-positive number, an
    /// unsupported URL scheme, or an over-long string.
    Rejected,
}

impl RefResolution {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Explicit => "explicit",
            Self::SessionContext => "sessionContext",
            Self::Unresolved => "unresolved",
            Self::Rejected => "rejected",
        }
    }

    /// Whether a clickable link may be offered without qualification.
    pub fn is_navigable(self) -> bool {
        matches!(self, Self::Explicit)
    }
}

/// One normalised reference.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkRef {
    /// `session_refs.id` when the source has one. The source's own uniqueness
    /// key is `(session_id, ref_type, ref_value)`, so repeated mentions may
    /// already have been collapsed upstream — a count here would be wrong.
    pub source_row_id: Option<i64>,
    pub session_id: String,
    pub kind: WorkRefKind,
    /// The value exactly as recorded.
    pub raw_value: String,
    /// Lowercased, URL-stripped value used for dedup and search.
    pub normalized_value: String,
    /// Host taken from the reference itself, e.g. `github.com` or an
    /// Enterprise hostname. Never derived from `host_type`, which is a kind,
    /// not a hostname.
    pub resolved_host: Option<String>,
    /// `owner/name`, from the reference or the session's context.
    pub resolved_repository: Option<String>,
    /// The session's repository, when it supplied the context above.
    pub candidate_repository: Option<String>,
    pub resolution: RefResolution,
    /// The source's turn hint. Never enough on its own for a "go to turn"
    /// action; that needs a validated mapping.
    pub turn_index: Option<i64>,
    pub recorded_at: Option<String>,
}

impl WorkRef {
    /// Normalise one source row.
    ///
    /// `session_repository` is the store's own repository value for the
    /// session, used only as candidate context.
    pub fn normalize(
        session_id: impl Into<String>,
        source_row_id: Option<i64>,
        ref_type: &str,
        ref_value: &str,
        session_repository: Option<&str>,
        turn_index: Option<i64>,
        recorded_at: Option<String>,
    ) -> Self {
        let kind = WorkRefKind::parse(ref_type);
        let raw_value = ref_value.trim().to_string();
        let mut resolved_host = None;
        let mut resolved_repository = None;
        let mut resolution = RefResolution::Unresolved;

        let normalized_value = if raw_value.len() > MAX_REF_LEN || raw_value.is_empty() {
            resolution = RefResolution::Rejected;
            String::new()
        } else if let Some(parsed) = parse_reference_url(&raw_value) {
            resolved_host = Some(parsed.host);
            resolved_repository = Some(parsed.repository);
            resolution = RefResolution::Explicit;
            parsed.value
        } else {
            normalize_bare_value(&kind, &raw_value)
        };

        if resolution == RefResolution::Unresolved {
            if normalized_value.is_empty() {
                resolution = RefResolution::Rejected;
            } else if let Some(repository) = session_repository
                .map(str::trim)
                .filter(|repository| !repository.is_empty())
            {
                resolved_repository = Some(repository.to_string());
                resolution = RefResolution::SessionContext;
            }
        }

        Self {
            source_row_id,
            session_id: session_id.into(),
            kind,
            raw_value,
            normalized_value,
            resolved_host,
            resolved_repository,
            candidate_repository: session_repository
                .map(str::trim)
                .filter(|repository| !repository.is_empty())
                .map(str::to_string),
            resolution,
            turn_index,
            recorded_at,
        }
    }

    /// Identity for deduplication: the same work referenced twice in one
    /// session is one entry, while the same number in two repositories is two.
    pub fn identity(&self) -> String {
        let scope = self
            .resolved_repository
            .as_deref()
            .filter(|_| self.resolution != RefResolution::SessionContext)
            .unwrap_or("");
        let host = self.resolved_host.as_deref().unwrap_or("");
        format!(
            "{}|{}|{}|{}",
            self.kind.as_str(),
            host,
            scope,
            self.normalized_value
        )
    }

    /// Whether a Git ref looks like a commit SHA. "Looks like" is the whole
    /// claim: it is a candidate, not proof the commit exists anywhere.
    pub fn is_commit_sha_shaped(&self) -> bool {
        matches!(self.kind, WorkRefKind::GitRef)
            && (7..=40).contains(&self.normalized_value.len())
            && self
                .normalized_value
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit())
    }

    /// The reference number, for pull requests and issues.
    pub fn number(&self) -> Option<u64> {
        self.kind
            .expects_number()
            .then(|| self.normalized_value.parse().ok())
            .flatten()
    }
}

struct ParsedUrl {
    host: String,
    repository: String,
    value: String,
}

/// Recognise `https://<host>/<owner>/<name>/(pull|issues|commit)/<value>`.
///
/// Only HTTP(S) is accepted; any other scheme in a database this process does
/// not own is refused outright rather than passed to a link handler.
fn parse_reference_url(value: &str) -> Option<ParsedUrl> {
    let rest = value
        .strip_prefix("https://")
        .or_else(|| value.strip_prefix("http://"))?;
    let rest = rest.split(['?', '#']).next()?;
    let mut segments = rest.split('/').filter(|segment| !segment.is_empty());
    let host = segments.next()?.to_ascii_lowercase();
    if host.is_empty() || host.contains('@') || !host.contains('.') {
        return None;
    }
    let owner = segments.next()?;
    let name = segments.next()?;
    let kind = segments.next()?;
    let tail = segments.next()?;
    if !matches!(kind, "pull" | "issues" | "commit") {
        return None;
    }
    if !is_repository_segment(owner) || !is_repository_segment(name) {
        return None;
    }
    let value = if kind == "commit" {
        tail.to_ascii_lowercase()
    } else {
        // Strip a trailing `/files` or similar, and reject a non-numeric tail.
        let number: u64 = tail.parse().ok()?;
        if number == 0 {
            return None;
        }
        number.to_string()
    };
    Some(ParsedUrl {
        host,
        repository: format!("{owner}/{name}"),
        value,
    })
}

fn is_repository_segment(segment: &str) -> bool {
    !segment.is_empty()
        && segment.len() <= 100
        && segment
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

fn normalize_bare_value(kind: &WorkRefKind, raw: &str) -> String {
    let trimmed = raw.trim().trim_start_matches('#');
    if kind.expects_number() {
        return match trimmed.parse::<u64>() {
            Ok(number) if number > 0 => number.to_string(),
            _ => String::new(),
        };
    }
    let lowered = trimmed.to_ascii_lowercase();
    if lowered.is_empty() || lowered.len() > MAX_REF_LEN {
        String::new()
    } else {
        lowered
    }
}
