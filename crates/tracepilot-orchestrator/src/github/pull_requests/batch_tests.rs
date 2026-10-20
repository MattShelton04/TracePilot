//! Branch-lookup failure kinds, command-line budgets, partial batches and the
//! environment `gh` gets per host.

use super::tests::{FakeGh, answered, ok, pr_node, query, variable};
use super::*;

fn branch(name: &str) -> BranchQuery {
    BranchQuery {
        owner: "example".into(),
        repo: "orchard".into(),
        branch: name.into(),
    }
}

#[test]
fn only_a_missing_repository_counts_as_a_branch_with_nothing_found() {
    let gh = FakeGh::new(vec![Ok(GhOutput {
        success: false,
        stdout: serde_json::json!({"data": {
            "b0": null,
            "b1": null,
            "b2": {"defaultBranchRef": {"name": "main"}, "pullRequests": null},
            "b3": {"defaultBranchRef": {"name": "main"}},
            "b4": null,
            "b5": {"defaultBranchRef": {"name": "main"}, "pullRequests": {"nodes": []}}
        }, "errors": [
            {"type": "NOT_FOUND", "path": ["b0"], "message": "Could not resolve to a Repository"},
            {"type": "FORBIDDEN", "path": ["b1"], "message": "Resource protected by SAML"},
            {"type": "SERVICE_UNAVAILABLE", "path": ["b2", "pullRequests"], "message": "try later"}
        ]})
        .to_string(),
        stderr: String::new(),
    })]);
    let queries: Vec<_> = (0..6).map(|i| branch(&format!("fix/{i}"))).collect();
    let results = answered(gh_branch_pull_requests(&gh, "github.com", &queries));
    assert!(matches!(results[0], Some(GhLookup::NotFound(_))));
    assert_eq!(
        results[1],
        Some(GhLookup::Failed(
            "FORBIDDEN: Resource protected by SAML".into()
        ))
    );
    assert_eq!(
        results[2],
        Some(GhLookup::Failed("SERVICE_UNAVAILABLE: try later".into()))
    );
    assert!(matches!(results[3], Some(GhLookup::Failed(_))));
    // A null alias without an error says nothing about the repository.
    assert!(matches!(results[4], Some(GhLookup::Failed(_))));
    assert!(
        matches!(results[5], Some(GhLookup::Found(ref found)) if found.pull_requests.is_empty())
    );
}

#[test]
fn long_values_split_batches_under_the_command_line_budget() {
    let gh = FakeGh::new(vec![ok(serde_json::json!({"data": {}, "errors": [
        {"type": "NOT_FOUND", "path": ["b0"], "message": "x"}]}))]);
    let long = |i: usize| BranchQuery {
        owner: "o".repeat(39),
        repo: "r".repeat(100),
        branch: format!("{i:03}{}", "\"\\b".repeat(84)),
    };
    let queries: Vec<_> = (0..50).map(long).collect();
    gh_branch_pull_requests(&gh, "github.com", &queries);
    let calls = gh.calls();
    assert!(calls.len() > 1, "50 long branches fit one command line");
    let mut sent = 0;
    for call in &calls {
        assert!(query::argv_bytes(call) <= MAX_ARGV_BYTES);
        sent += (0..MAX_ALIASES_PER_CALL)
            .filter(|i| variable(call, "-f", &format!("h{i}")).is_some())
            .count();
    }
    assert_eq!(sent, 50);

    // Short values still go 50 to a call.
    let gh = FakeGh::new(vec![ok(serde_json::json!({"data": {}, "errors": [
        {"type": "NOT_FOUND", "path": ["b0"], "message": "x"}]}))]);
    let queries: Vec<_> = (0..50).map(|i| branch(&format!("fix/{i}"))).collect();
    gh_branch_pull_requests(&gh, "github.com", &queries);
    assert_eq!(gh.calls().len(), 1);
}

#[test]
fn a_failed_later_call_keeps_the_answers_of_earlier_ones() {
    let mut first = serde_json::Map::new();
    for i in 0..50 {
        first.insert(
            format!("pr{i}"),
            serde_json::json!({"pullRequest": pr_node(i + 1)}),
        );
    }
    let gh = FakeGh::new(vec![
        ok(serde_json::json!({ "data": first })),
        Err(GhCallError::Timeout(30)),
    ]);
    let queries: Vec<_> = (1..=51).map(query).collect();
    let batch = gh_pull_requests(&gh, "github.com", &queries);
    assert_eq!(batch.error, Some(GhCallError::Timeout(30)));
    assert!(
        batch.results[..50]
            .iter()
            .all(|result| matches!(result, Some(GhLookup::Found(_))))
    );
    assert_eq!(batch.results[50], None);
}

#[test]
fn only_github_hosts_may_use_environment_tokens() {
    for (host, strip) in [
        ("github.com", false),
        ("GitHub.com", false),
        ("acme.ghe.com", false),
        ("git.example.internal", true),
        ("ghe.com.evil.example", true),
    ] {
        let gh = FakeGh::new(vec![
            Ok(GhOutput {
                success: true,
                ..GhOutput::default()
            }),
            ok(serde_json::json!({"data": {"pr0": {"pullRequest": pr_node(1)}}})),
        ]);
        gh_host_auth(&gh, host).unwrap();
        gh_pull_requests(&gh, host, &[query(1)]);
        let options = gh.options.lock().unwrap().clone();
        assert_eq!(options.len(), 2, "{host}");
        assert!(
            options
                .iter()
                .all(|options| options.strip_enterprise_tokens == strip),
            "{host}"
        );
    }
}
