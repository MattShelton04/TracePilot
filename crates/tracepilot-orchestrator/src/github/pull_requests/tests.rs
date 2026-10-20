//! `gh api graphql` batching, variables and response mapping, against a fake
//! runner (no network, no real `gh`).

use std::collections::VecDeque;
use std::sync::Mutex;

use super::*;

/// Records every call and answers from a queue (the last answer repeats).
pub(super) struct FakeGh {
    calls: Mutex<Vec<Vec<String>>>,
    pub(super) options: Mutex<Vec<GhRunOptions>>,
    answers: Mutex<VecDeque<Result<GhOutput, GhCallError>>>,
}

impl FakeGh {
    pub(super) fn new(answers: Vec<Result<GhOutput, GhCallError>>) -> Self {
        Self {
            calls: Mutex::new(Vec::new()),
            options: Mutex::new(Vec::new()),
            answers: Mutex::new(answers.into()),
        }
    }

    pub(super) fn calls(&self) -> Vec<Vec<String>> {
        self.calls.lock().unwrap().clone()
    }
}

/// The answers of a batch that must not have failed.
pub(super) fn answered<T>(batch: GhBatch<T>) -> Vec<Option<GhLookup<T>>> {
    assert_eq!(batch.error, None);
    batch.results
}

impl GhRunner for FakeGh {
    fn run(&self, args: &[String], options: GhRunOptions) -> Result<GhOutput, GhCallError> {
        self.calls.lock().unwrap().push(args.to_vec());
        self.options.lock().unwrap().push(options);
        let mut answers = self.answers.lock().unwrap();
        if answers.len() > 1 {
            answers.pop_front().unwrap()
        } else {
            answers.front().cloned().unwrap()
        }
    }
}

pub(super) fn ok(stdout: serde_json::Value) -> Result<GhOutput, GhCallError> {
    Ok(GhOutput {
        success: true,
        stdout: stdout.to_string(),
        stderr: String::new(),
    })
}

pub(super) fn pr_node(number: u32) -> serde_json::Value {
    serde_json::json!({
        "number": number, "title": "Fix ripeness", "state": "OPEN", "isDraft": false,
        "mergedAt": null, "closedAt": null, "createdAt": "2026-09-10T00:02:00Z",
        "headRefName": "fix/ripe", "baseRefName": "main",
        "headRepositoryOwner": {"login": "example"}, "reviewDecision": "APPROVED",
        "commits": {"nodes": [{"commit": {"statusCheckRollup": {"state": "SUCCESS"}}}]}
    })
}

pub(super) fn query(number: u32) -> PullRequestQuery {
    PullRequestQuery {
        owner: "example".into(),
        repo: "orchard".into(),
        number,
    }
}

/// The value after `flag name=` in an argument vector.
pub(super) fn variable(args: &[String], flag: &str, name: &str) -> Option<String> {
    args.windows(2)
        .find(|pair| pair[0] == flag && pair[1].starts_with(&format!("{name}=")))
        .map(|pair| pair[1][name.len() + 1..].to_string())
}

pub(super) fn query_text(args: &[String]) -> String {
    variable(args, "-f", "query").expect("query")
}

#[test]
fn fifty_one_pull_requests_take_two_calls_to_one_host() {
    let mut first = serde_json::Map::new();
    for i in 0..50 {
        first.insert(
            format!("pr{i}"),
            serde_json::json!({"pullRequest": pr_node(i + 1)}),
        );
    }
    let gh = FakeGh::new(vec![
        ok(serde_json::json!({ "data": first })),
        ok(serde_json::json!({"data": {"pr0": {"pullRequest": pr_node(51)}}})),
    ]);
    let queries: Vec<_> = (1..=51).map(query).collect();
    let results = answered(gh_pull_requests(&gh, "github.com", &queries));

    let calls = gh.calls();
    assert_eq!(calls.len(), 2);
    for call in &calls {
        assert_eq!(&call[..4], ["api", "graphql", "--hostname", "github.com"]);
    }
    assert!(query_text(&calls[0]).contains("pr49: repository"));
    assert!(!query_text(&calls[0]).contains("pr50:"));
    assert!(query_text(&calls[1]).contains("pr0: repository"));
    assert!(!query_text(&calls[1]).contains("pr1:"));
    assert_eq!(variable(&calls[1], "-F", "p0").as_deref(), Some("51"));
    let numbers: Vec<u32> = results
        .iter()
        .map(|result| match result {
            Some(GhLookup::Found(pr)) => pr.number,
            other => panic!("unexpected {other:?}"),
        })
        .collect();
    assert_eq!(numbers, (1..=51).collect::<Vec<_>>());
}

#[test]
fn values_travel_as_raw_variables_never_in_the_query() {
    let gh = FakeGh::new(vec![ok(serde_json::json!({"data": {
        "pr0": {"pullRequest": pr_node(7)}, "pr1": {"pullRequest": pr_node(8)}
    }}))]);
    let queries = vec![
        query(7),
        PullRequestQuery {
            owner: "@etc-passwd".into(),
            repo: "orchard".into(),
            number: 9,
        },
        PullRequestQuery {
            owner: "Octo-Cat".into(),
            repo: "my.repo_name".into(),
            number: 8,
        },
        PullRequestQuery {
            owner: "example".into(),
            repo: "orchard".into(),
            number: 0,
        },
    ];
    let results = answered(gh_pull_requests(&gh, "github.com", &queries));
    let calls = gh.calls();
    assert_eq!(calls.len(), 1);
    let args = &calls[0];
    assert_eq!(variable(args, "-f", "o0").as_deref(), Some("example"));
    assert_eq!(variable(args, "-f", "n0").as_deref(), Some("orchard"));
    assert_eq!(variable(args, "-F", "p0").as_deref(), Some("7"));
    assert_eq!(variable(args, "-f", "o1").as_deref(), Some("Octo-Cat"));
    assert_eq!(variable(args, "-f", "n1").as_deref(), Some("my.repo_name"));
    // The `@` owner and the zero number were never sent.
    assert!(args.iter().all(|arg| !arg.contains('@')));
    assert!(variable(args, "-f", "o2").is_none());
    let text = query_text(args);
    for value in ["example", "orchard", "Octo-Cat", "my.repo_name"] {
        assert!(!text.contains(value), "{value} leaked into the query");
    }
    // Only numbers go through -F.
    for pair in args.windows(2).filter(|pair| pair[0] == "-F") {
        let value = pair[1].split_once('=').unwrap().1;
        assert!(value.parse::<u32>().is_ok());
    }
    assert!(matches!(results[0], Some(GhLookup::Found(_))));
    assert!(results[1].is_none());
    assert!(matches!(results[2], Some(GhLookup::Found(_))));
    assert!(results[3].is_none());
}

#[test]
fn invalid_hosts_owners_repos_and_branches_are_rejected() {
    for host in ["github.com", "acme.ghe.com", "git.example.internal", "ghes"] {
        assert!(valid_host(host), "{host}");
    }
    for host in [
        "",
        "-x.com",
        ".github.com",
        "github..com",
        "git hub.com",
        "a/b",
        "h@x",
    ] {
        assert!(!valid_host(host), "{host}");
    }
    assert!(valid_owner("a-b-1"));
    assert!(!valid_owner("-a") && !valid_owner("@a") && !valid_owner(&"a".repeat(40)));
    assert!(valid_repo("a.b_c-d") && !valid_repo("..") && !valid_repo("a/b"));
    assert!(valid_number(1) && valid_number(999_999_999));
    assert!(!valid_number(0) && !valid_number(1_000_000_000));
    assert!(valid_branch("feature/@odd=name"));
    assert!(!valid_branch("") && !valid_branch("a\nb") && !valid_branch(&"b".repeat(256)));

    let gh = FakeGh::new(vec![ok(serde_json::json!({"data": {}}))]);
    let results = answered(gh_pull_requests(&gh, "-evil.com", &[query(1)]));
    assert_eq!(results, vec![None]);
    assert!(gh.calls().is_empty());
}

#[test]
fn every_enum_maps_and_unknown_values_are_none() {
    let mut nodes = serde_json::Map::new();
    let cases = [
        ("OPEN", true, "REVIEW_REQUIRED", Some("PENDING")),
        ("CLOSED", false, "CHANGES_REQUESTED", Some("FAILURE")),
        ("MERGED", false, "APPROVED", Some("ERROR")),
        ("WHATEVER", false, "SOMETHING", Some("EXPECTED")),
        ("OPEN", false, "APPROVED", None),
    ];
    for (i, (state, draft, review, checks)) in cases.iter().enumerate() {
        let mut node = pr_node(i as u32 + 1);
        node["state"] = serde_json::json!(state);
        node["isDraft"] = serde_json::json!(draft);
        node["reviewDecision"] = serde_json::json!(review);
        node["commits"] = match checks {
            Some(checks) => {
                serde_json::json!({"nodes": [{"commit": {"statusCheckRollup": {"state": checks}}}]})
            }
            None => serde_json::json!({"nodes": [{"commit": {"statusCheckRollup": null}}]}),
        };
        nodes.insert(format!("pr{i}"), serde_json::json!({ "pullRequest": node }));
    }
    let gh = FakeGh::new(vec![ok(serde_json::json!({ "data": nodes }))]);
    let queries: Vec<_> = (1..=5).map(query).collect();
    let found: Vec<GhPullRequest> = answered(gh_pull_requests(&gh, "github.com", &queries))
        .into_iter()
        .map(|result| match result {
            Some(GhLookup::Found(pr)) => pr,
            other => panic!("unexpected {other:?}"),
        })
        .collect();
    let summary: Vec<_> = found
        .iter()
        .map(|pr| {
            (
                pr.state.map(GhPullRequestState::as_str),
                pr.is_draft,
                pr.review_decision,
                pr.checks_state,
            )
        })
        .collect();
    assert_eq!(
        summary,
        vec![
            (Some("open"), true, Some("review_required"), Some("pending")),
            (
                Some("closed"),
                false,
                Some("changes_requested"),
                Some("failure")
            ),
            (Some("merged"), false, Some("approved"), Some("error")),
            (None, false, None, Some("expected")),
            (Some("open"), false, Some("approved"), None),
        ]
    );
    assert_eq!(found[0].head_owner.as_deref(), Some("example"));
    assert_eq!(found[0].created_at.as_deref(), Some("2026-09-10T00:02:00Z"));
}

#[test]
fn a_missing_repository_or_pull_request_is_a_per_item_error() {
    // What gh 2.88 prints for a repository that does not resolve: exit 1,
    // the JSON body on stdout, the alias itself null.
    let stdout = r#"{"data":{"pr0":null,"pr1":{"pullRequest":null},"pr2":{"pullRequest":{"number":3,"state":"MERGED"}}},"errors":[{"type":"NOT_FOUND","path":["pr0"],"locations":[{"line":1,"column":2}],"message":"Could not resolve to a Repository with the name 'example/orchard'."},{"type":"NOT_FOUND","path":["pr1","pullRequest"],"message":"Could not resolve to a PullRequest with the number of 2."}]}"#;
    let gh = FakeGh::new(vec![Ok(GhOutput {
        success: false,
        stdout: stdout.into(),
        stderr: "gh: Could not resolve to a Repository with the name 'example/orchard'.".into(),
    })]);
    let results = answered(gh_pull_requests(
        &gh,
        "github.com",
        &[query(1), query(2), query(3)],
    ));
    assert_eq!(
        results[0],
        Some(GhLookup::NotFound(
            "NOT_FOUND: Could not resolve to a Repository with the name 'example/orchard'.".into()
        ))
    );
    assert_eq!(
        results[1],
        Some(GhLookup::NotFound(
            "NOT_FOUND: Could not resolve to a PullRequest with the number of 2.".into()
        ))
    );
    match &results[2] {
        Some(GhLookup::Found(pr)) => {
            assert_eq!(pr.state, Some(GhPullRequestState::Merged));
            assert_eq!(pr.checks_state, None);
        }
        other => panic!("unexpected {other:?}"),
    }
}

#[test]
fn long_errors_are_truncated_without_control_characters() {
    let message = format!("line\none {}", "x".repeat(400));
    let stdout = serde_json::json!({"data": {"pr0": null},
        "errors": [{"type": "FORBIDDEN", "path": ["pr0"], "message": message}]});
    let gh = FakeGh::new(vec![ok(stdout)]);
    let results = answered(gh_pull_requests(&gh, "github.com", &[query(1)]));
    let Some(GhLookup::Failed(error)) = &results[0] else {
        panic!("expected a failure");
    };
    assert_eq!(error.chars().count(), 200);
    assert!(error.starts_with("FORBIDDEN: line one"));
}

#[test]
fn whole_call_failures_fail_the_lookup() {
    let failures = [
        Err(GhCallError::NotInstalled),
        Err(GhCallError::Timeout(30)),
        Ok(GhOutput {
            success: false,
            stdout: String::new(),
            stderr: "HTTP 401: Bad credentials".into(),
        }),
        Ok(GhOutput {
            success: false,
            stdout: r#"{"message":"Bad credentials"}"#.into(),
            stderr: String::new(),
        }),
        ok(
            serde_json::json!({"data": null, "errors": [{"type": "RATE_LIMITED", "message": "API rate limit exceeded"}]}),
        ),
        Ok(GhOutput {
            success: true,
            stdout: "not json".into(),
            stderr: String::new(),
        }),
    ];
    for failure in failures {
        let gh = FakeGh::new(vec![failure.clone()]);
        let batch = gh_pull_requests(&gh, "github.com", &[query(1)]);
        assert!(batch.error.is_some(), "{failure:?} should fail the call");
        assert_eq!(batch.results, vec![None]);
    }
    let gh = FakeGh::new(vec![Err(GhCallError::NotInstalled)]);
    assert_eq!(
        gh_pull_requests(&gh, "github.com", &[query(1)]).error,
        Some(GhCallError::NotInstalled)
    );
}

#[test]
fn branch_lookups_send_the_branch_raw_and_read_the_default_branch() {
    let mut merged = pr_node(12);
    merged["state"] = serde_json::json!("MERGED");
    merged["mergedAt"] = serde_json::json!("2026-09-11T00:00:00Z");
    let gh = FakeGh::new(vec![ok(serde_json::json!({"data": {
        "b0": {"defaultBranchRef": {"name": "trunk"},
               "pullRequests": {"nodes": [pr_node(14), merged, null]}},
        "b1": null
    }, "errors": [{"type": "NOT_FOUND", "path": ["b1"], "message": "gone"}]}))]);
    let queries = vec![
        BranchQuery {
            owner: "example".into(),
            repo: "orchard".into(),
            branch: "@fix/ripe".into(),
        },
        BranchQuery {
            owner: "example".into(),
            repo: "missing".into(),
            branch: "feature".into(),
        },
        BranchQuery {
            owner: "example".into(),
            repo: "orchard".into(),
            branch: "bad\u{7}".into(),
        },
    ];
    let results = answered(gh_branch_pull_requests(&gh, "acme.ghe.com", &queries));
    let calls = gh.calls();
    assert_eq!(calls.len(), 1);
    let args = &calls[0];
    assert_eq!(&args[2..4], ["--hostname", "acme.ghe.com"]);
    assert_eq!(variable(args, "-f", "h0").as_deref(), Some("@fix/ripe"));
    assert!(variable(args, "-F", "h0").is_none());
    assert!(variable(args, "-f", "h2").is_none());
    let text = query_text(args);
    assert!(text.contains("pullRequests(headRefName: $h0, first: 5"));
    assert!(!text.contains("ripe"));

    match &results[0] {
        Some(GhLookup::Found(found)) => {
            assert_eq!(found.default_branch.as_deref(), Some("trunk"));
            let numbers: Vec<u32> = found.pull_requests.iter().map(|pr| pr.number).collect();
            assert_eq!(numbers, vec![14, 12]);
            assert_eq!(
                found.pull_requests[1].state,
                Some(GhPullRequestState::Merged)
            );
        }
        other => panic!("unexpected {other:?}"),
    }
    assert_eq!(
        results[1],
        Some(GhLookup::NotFound("NOT_FOUND: gone".into()))
    );
    assert_eq!(results[2], None);
}

#[test]
fn two_hosts_are_separate_calls() {
    let gh = FakeGh::new(vec![ok(
        serde_json::json!({"data": {"pr0": {"pullRequest": pr_node(1)}}}),
    )]);
    answered(gh_pull_requests(&gh, "github.com", &[query(1)]));
    answered(gh_pull_requests(&gh, "acme.ghe.com", &[query(1)]));
    let hosts: Vec<String> = gh.calls().iter().map(|call| call[3].clone()).collect();
    assert_eq!(hosts, vec!["github.com", "acme.ghe.com"]);
}

#[test]
fn auth_status_names_the_host_and_reads_why_it_failed() {
    let signed_in = FakeGh::new(vec![Ok(GhOutput {
        success: true,
        ..GhOutput::default()
    })]);
    assert_eq!(
        gh_host_auth(&signed_in, "acme.ghe.com"),
        Ok(GhHostAuth::SignedIn)
    );
    assert_eq!(
        signed_in.calls(),
        vec![vec![
            "auth",
            "status",
            "--active",
            "--hostname",
            "acme.ghe.com"
        ]]
    );
    for text in [
        "You are not logged into any GitHub hosts. To log in, run: gh auth login",
        "github.com\n  X Failed to log in to github.com account octo (default)\n  - To re-authenticate, run: gh auth login -h github.com",
    ] {
        let signed_out = FakeGh::new(vec![Ok(GhOutput {
            success: false,
            stdout: String::new(),
            stderr: text.into(),
        })]);
        assert_eq!(
            gh_host_auth(&signed_out, "github.com"),
            Ok(GhHostAuth::SignedOut)
        );
    }
    // Offline or a slow server is not a sign-out.
    let offline = FakeGh::new(vec![Ok(GhOutput {
        success: false,
        stdout: String::new(),
        stderr: "error connecting to api.github.com".into(),
    })]);
    assert_eq!(
        gh_host_auth(&offline, "github.com"),
        Err(GhCallError::Response("auth_status"))
    );
    let missing = FakeGh::new(vec![Err(GhCallError::NotInstalled)]);
    assert_eq!(
        gh_host_auth(&missing, "github.com"),
        Err(GhCallError::NotInstalled)
    );
}

#[test]
fn an_old_gh_without_active_is_asked_again_without_it() {
    let gh = FakeGh::new(vec![
        Ok(GhOutput {
            success: false,
            stdout: String::new(),
            stderr: "unknown flag: --active\n\nUsage:  gh auth status [flags]".into(),
        }),
        Ok(GhOutput {
            success: true,
            ..GhOutput::default()
        }),
    ]);
    assert_eq!(gh_host_auth(&gh, "github.com"), Ok(GhHostAuth::SignedIn));
    assert_eq!(
        gh.calls(),
        vec![
            vec!["auth", "status", "--active", "--hostname", "github.com"],
            vec!["auth", "status", "--hostname", "github.com"],
        ]
    );
}
