//! When a pull request lookup is due, and which pull requests a pushed-branch
//! lookup accepts. Pure functions of stored rows and `now`.

use chrono::{DateTime, Duration, Utc};
use tracepilot_indexer::index_db::{PullRequestFetchState, PushedBranchLookup};
use tracepilot_orchestrator::github::pull_requests::{
    BranchQuery, GhPullRequest, PullRequestQuery, valid_host,
};

/// An open or draft pull request's state is refetched after this long.
pub(crate) const OPEN_STALE_AFTER: Duration = Duration::minutes(10);
/// A pull request whose last lookup failed is retried after this long.
pub(crate) const ERROR_RETRY_AFTER: Duration = Duration::hours(1);
/// A pushed branch is looked up again after this long, while its session's
/// window is open.
pub(crate) const BRANCH_RECHECK_AFTER: Duration = Duration::minutes(30);
/// How long after a session's last activity a pull request it pushed for can
/// still be opened.
pub(crate) const SESSION_WINDOW: Duration = Duration::hours(24);

/// Branches that are never a pull request's head worth looking up.
const EXCLUDED_BRANCHES: [&str; 4] = ["main", "master", "develop", "gh-pages"];

pub(crate) fn parse_time(value: Option<&str>) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value?)
        .ok()
        .map(|time| time.with_timezone(&Utc))
}

pub(crate) fn excluded_branch(branch: &str) -> bool {
    EXCLUDED_BRANCHES
        .iter()
        .any(|name| name.eq_ignore_ascii_case(branch))
}

/// The query for a stored pull request, when every part is safe to send.
pub(crate) fn status_query(fetch: &PullRequestFetchState) -> Option<PullRequestQuery> {
    let query = PullRequestQuery {
        owner: fetch.key.owner.clone(),
        repo: fetch.key.repo.clone(),
        number: fetch.key.number,
    };
    (valid_host(&fetch.key.host) && query.is_valid()).then_some(query)
}

/// The query for a pushed branch, when it is worth asking about and every
/// part is safe to send.
pub(crate) fn branch_query(branch: &PushedBranchLookup) -> Option<BranchQuery> {
    let query = BranchQuery {
        owner: branch.owner.clone(),
        repo: branch.repo.clone(),
        branch: branch.branch.clone(),
    };
    (valid_host(&branch.host) && !excluded_branch(&branch.branch) && query.is_valid())
        .then_some(query)
}

/// Whether a pull request's state should be fetched: never fetched; open or
/// draft and older than 10 minutes; failed more than an hour ago. Merged and
/// closed pull requests are final unless `force`.
pub(crate) fn status_due(fetch: &PullRequestFetchState, now: DateTime<Utc>, force: bool) -> bool {
    if force {
        return true;
    }
    let Some(fetched_at) = parse_time(fetch.fetched_at.as_deref()) else {
        return true;
    };
    let age = now - fetched_at;
    if fetch.error.is_some() {
        return age >= ERROR_RETRY_AFTER;
    }
    match fetch.state.as_deref() {
        Some("merged" | "closed") => false,
        _ => age >= OPEN_STALE_AFTER,
    }
}

/// The end of the window in which a session's pushes can still turn into
/// pull requests: its last activity plus 24 hours.
fn window_end(created_at: Option<&str>, updated_at: Option<&str>) -> Option<DateTime<Utc>> {
    parse_time(updated_at)
        .or_else(|| parse_time(created_at))
        .map(|end| end + SESSION_WINDOW)
}

/// Whether a pushed branch should be looked up: never looked up, or last
/// looked up before the session's window closed and over 30 minutes ago.
pub(crate) fn branch_due(
    branch: &PushedBranchLookup,
    created_at: Option<&str>,
    updated_at: Option<&str>,
    now: DateTime<Utc>,
    force: bool,
) -> bool {
    if force {
        return true;
    }
    let Some(last) = parse_time(branch.last_lookup_at.as_deref()) else {
        return true;
    };
    let Some(end) = window_end(created_at, updated_at) else {
        return false;
    };
    last < end && now - last >= BRANCH_RECHECK_AFTER
}

/// When a session was pushing to a branch: from its first push (or the
/// session's start) to its last activity plus 24 hours. Unknown bounds are
/// open.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ActiveSpan {
    pub start: Option<DateTime<Utc>>,
    pub end: Option<DateTime<Utc>>,
}

impl ActiveSpan {
    pub(crate) fn new(
        first_push_at: Option<&str>,
        created_at: Option<&str>,
        updated_at: Option<&str>,
    ) -> Self {
        Self {
            start: parse_time(first_push_at).or_else(|| parse_time(created_at)),
            end: window_end(created_at, updated_at),
        }
    }
}

/// Whether a pull request found for a pushed branch belongs to the session:
/// its head is in the pushing owner's repository, and it was open at some
/// point during the session's span.
pub(crate) fn accept_branch_pull_request(
    pr: &GhPullRequest,
    owner: &str,
    span: ActiveSpan,
) -> bool {
    let same_owner = pr
        .head_owner
        .as_deref()
        .is_some_and(|head| head.eq_ignore_ascii_case(owner));
    let Some(opened) = parse_time(pr.created_at.as_deref()) else {
        return false;
    };
    let ended = parse_time(pr.merged_at.as_deref()).or_else(|| parse_time(pr.closed_at.as_deref()));
    let opened_in_time = span.end.is_none_or(|end| opened <= end);
    let still_open_at_start = match (span.start, ended) {
        (Some(start), Some(ended)) => ended >= start,
        _ => true,
    };
    same_owner && opened_in_time && still_open_at_start
}

#[cfg(test)]
mod tests {
    use super::*;
    use tracepilot_core::pull_requests::PullRequestKey;

    fn time(value: &str) -> DateTime<Utc> {
        parse_time(Some(value)).unwrap()
    }

    fn fetch(state: Option<&str>, error: Option<&str>) -> PullRequestFetchState {
        PullRequestFetchState {
            key: PullRequestKey {
                host: "github.com".into(),
                owner: "example".into(),
                repo: "orchard".into(),
                number: 7,
            },
            fetched_at: Some("2026-09-10T00:00:00Z".into()),
            state: state.map(str::to_string),
            is_draft: false,
            error: error.map(str::to_string),
        }
    }

    #[test]
    fn staleness_boundaries() {
        let fetched = time("2026-09-10T00:00:00Z");
        let open = fetch(Some("open"), None);
        assert!(!status_due(&open, fetched + Duration::seconds(599), false));
        assert!(status_due(&open, fetched + OPEN_STALE_AFTER, false));
        let failed = fetch(Some("open"), Some("FORBIDDEN: no"));
        assert!(!status_due(&failed, fetched + Duration::minutes(59), false));
        assert!(status_due(&failed, fetched + ERROR_RETRY_AFTER, false));
        for state in ["merged", "closed"] {
            let done = fetch(Some(state), None);
            assert!(!status_due(&done, fetched + Duration::days(365), false));
            assert!(status_due(&done, fetched, true));
        }
        let never = PullRequestFetchState {
            fetched_at: None,
            ..fetch(None, None)
        };
        assert!(status_due(&never, fetched, false));
    }

    #[test]
    fn default_style_branches_and_unsafe_values_are_never_asked() {
        let branch = |name: &str, owner: &str| PushedBranchLookup {
            host: "github.com".into(),
            owner: owner.into(),
            repo: "orchard".into(),
            branch: name.into(),
            first_push_at: None,
            last_lookup_at: None,
        };
        for name in ["main", "MASTER", "Develop", "gh-pages"] {
            assert!(branch_query(&branch(name, "example")).is_none(), "{name}");
        }
        assert!(branch_query(&branch("fix/ripe", "@example")).is_none());
        assert!(branch_query(&branch("fix/ripe", "example")).is_some());
        let mut bad_host = fetch(None, None);
        bad_host.key.host = "-x.com".into();
        assert!(status_query(&bad_host).is_none());
    }

    #[test]
    fn acceptance_needs_the_pushing_owner_and_an_overlapping_span() {
        let span = ActiveSpan::new(
            Some("2026-09-10T00:10:00Z"),
            Some("2026-09-10T00:00:00Z"),
            Some("2026-09-10T01:00:00Z"),
        );
        let pr = |owner: Option<&str>, created: &str, ended: Option<&str>| GhPullRequest {
            number: 1,
            title: None,
            state: None,
            is_draft: false,
            created_at: Some(created.into()),
            merged_at: None,
            closed_at: ended.map(str::to_string),
            head_ref: None,
            base_ref: None,
            head_owner: owner.map(str::to_string),
            review_decision: None,
            checks_state: None,
        };
        let accept = |pr: GhPullRequest| accept_branch_pull_request(&pr, "Example", span);
        assert!(accept(pr(Some("example"), "2026-09-10T00:20:00Z", None)));
        assert!(accept(pr(Some("example"), "2026-09-01T00:00:00Z", None)));
        assert!(accept(pr(Some("example"), "2026-09-11T01:00:00Z", None)));
        assert!(!accept(pr(Some("example"), "2026-09-11T01:00:01Z", None)));
        assert!(!accept(pr(
            Some("example"),
            "2026-09-01T00:00:00Z",
            Some("2026-09-10T00:09:59Z")
        )));
        assert!(!accept(pr(Some("fork"), "2026-09-10T00:20:00Z", None)));
        assert!(!accept(pr(None, "2026-09-10T00:20:00Z", None)));
    }
}
