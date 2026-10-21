//! Non-shell evidence (prompts, `pr-link`, MCP tools, app binding), the
//! address grammar, and how results are merged, ordered and ranked.

use serde_json::json;

use super::test_support::*;
use super::text::pr_urls;
use crate::pull_requests::model::{PullRequestEvidence as Evidence, PullRequestRole as Role};

#[test]
fn a_url_in_a_user_prompt_is_a_mention() {
    let found = extract(&[
        user(
            1,
            "Please review https://github.com/MattShelton04/TracePilot/pull/12.",
        ),
        event(
            "user.message",
            2,
            json!({"content": "https://github.com/MattShelton04/TracePilot/pull/13", "source": "user"}),
        ),
    ]);
    assert_eq!(
        summary(&found),
        [
            "MattShelton04/TracePilot#13:mentioned",
            "MattShelton04/TracePilot#12:mentioned"
        ]
    );
    assert!(
        found.pull_requests[0]
            .evidence
            .contains(Evidence::UserMessage)
    );
}

#[test]
fn urls_outside_tool_output_and_prompts_are_ignored() {
    let url = "https://github.com/MattShelton04/TracePilot/pull/12";
    let mut events = vec![
        event(
            "assistant.message",
            1,
            json!({"content": format!("Opened {url}")}),
        ),
        event("system.message", 2, json!({"content": url})),
        event(
            "user.message",
            3,
            json!({"content": url, "source": "system"}),
        ),
        event(
            "user.message",
            4,
            json!({"content": url, "source": "skill-pdf"}),
        ),
        event(
            "session.compaction_complete",
            5,
            json!({"summaryContent": url}),
        ),
        event(
            "hook.start",
            6,
            json!({"input": {"toolResult": {"textResultForLlm": url}}}),
        ),
    ];
    let mut subagent_prompt = user(7, url);
    subagent_prompt.raw.agent_id = Some("agent-1".into());
    events.push(subagent_prompt);
    events.extend(tool(
        "w1",
        8,
        "web_fetch",
        json!({"url": url}),
        json!({"success": true, "result": {"content": url}}),
    ));
    events.extend(tool(
        "v1",
        10,
        "view",
        json!({"path": "notes.md"}),
        json!({"success": true, "result": {"content": url}}),
    ));
    events.extend(tool(
        "l1", 12, "github-mcp-server-list_pull_requests",
        json!({"owner": "MattShelton04", "repo": "TracePilot"}),
        json!({"success": true, "result": {"content": format!("[{{\"number\":12,\"html_url\":\"{url}\"}}]")}}),
    ));
    events.extend(tool(
        "s1",
        14,
        "github-mcp-server-search_pull_requests",
        json!({"query": "is:pr"}),
        json!({"success": true, "result": {"content": url}}),
    ));
    events.extend(copilot_shell("g1", 16, "gh pr list --state open", url, 0));
    let found = extract(&events);
    assert!(found.pull_requests.is_empty(), "{:?}", summary(&found));
}

#[test]
fn url_grammar_rejects_non_pull_requests() {
    let rejected = [
        "https://github.com/MattShelton04/TracePilot/pull/new/feat/a",
        "https://github.com/MattShelton04/TracePilot/compare/main...feat",
        "https://github.com/MattShelton04/TracePilot/pull/12abc",
        "https://github.com/MattShelton04/TracePilot/pull/0",
        "https://github.com/MattShelton04/TracePilot/pull/1234567890",
        "https://github.com/owner/repo/pull/1",
        "https://github.com/OWNER/REPO/pull/1",
        "https://github.com/octo-org/octo-repo/pull/1",
        "https://github.com/octocat/Hello-World/pull/1",
        "https://github.com/your-org/app/pull/1",
        "https://github.com/example/repo/pull/1",
        "https://github.com/<owner>/<repo>/pull/1",
        "https://github.com/-bad/app/pull/1",
        "https://github.com/a/../pull/1",
        "ftp://github.com/a/b/pull/1",
    ];
    for text in rejected {
        assert_eq!(pr_urls(text).count(), 0, "{text}");
    }
    let accepted = [
        (
            "(see https://github.com/MattShelton04/TracePilot/pull/12).",
            12,
        ),
        ("\"HTTPS://GitHub.com/a-b/c.d_e/pull/7/files\"", 7),
        (
            "glued TracePilothttps://github.com/MattShelton04/TracePilot/pull/9",
            9,
        ),
        (
            "https://github.com/MattShelton04/TracePilot/pull/5#issuecomment-1",
            5,
        ),
    ];
    for (text, number) in accepted {
        let urls: Vec<_> = pr_urls(text).collect();
        assert_eq!(urls.len(), 1, "{text}");
        assert_eq!(urls[0].number, number);
        assert_eq!(urls[0].host, "github.com");
    }
}

#[test]
fn hosts_outside_the_allowlist_are_ignored() {
    let found = extract(&[
        user(1, "https://gitlab.com/MattShelton04/TracePilot/pull/12"),
        user(2, "https://github.example.org/team/app/pull/3"),
    ]);
    assert!(found.pull_requests.is_empty());
}

#[test]
fn repeated_pr_links_dedupe_to_one_entry_per_pull_request() {
    let mut events = Vec::new();
    for second in 0..50 {
        events.push(pr_link(second * 10, if second < 20 { 996 } else { 997 }));
    }
    let found = extract(&events);
    assert_eq!(
        summary(&found),
        [
            "MattShelton04/TracePilot#997:updated",
            "MattShelton04/TracePilot#996:updated"
        ]
    );
    let latest = &found.pull_requests[0];
    assert!(latest.primary);
    assert_eq!(latest.event_index, Some(20));
    assert_eq!(
        (latest.first_seen_at, latest.last_seen_at),
        (Some(at(200)), Some(at(490)))
    );
    assert!(latest.evidence.contains(Evidence::PrLink));
}

#[test]
fn a_pr_link_for_a_created_pull_request_stays_created() {
    let url = "https://github.com/MattShelton04/TracePilot/pull/1034";
    let mut events = claude_shell("c1", 1, "gh pr create --fill", url, 0);
    events.push(pr_link(3, 1034));
    events.push(pr_link(9, 1034));
    let found = extract(&events);
    let pr = only(&found);
    assert_eq!(describe(pr), "MattShelton04/TracePilot#1034:created");
    assert!(pr.evidence.contains(Evidence::PrLink) && pr.evidence.contains(Evidence::GhCreate));
    assert_eq!(pr.event_index, Some(0));
    assert_eq!(pr.last_seen_at, Some(at(9)));
}

#[test]
fn ccd_bind_pr_is_an_update() {
    let url = "https://github.com/MattShelton04/TracePilot/pull/1030";
    let found = extract_flat(vec![
        tool(
            "b1",
            1,
            "mcp__ccd_pr__bind_pr",
            json!({"url": url}),
            json!({"success": true, "result": {"content": "Bound MattShelton04/TracePilot#1030 to this session."}}),
        ),
        tool(
            "b2",
            3,
            "mcp__ccd_pr__bind_pr",
            json!({"url": url.replace("1030", "1057")}),
            json!({"success": true, "result": {"content": "MattShelton04/TracePilot#1057 is already bound to this session."}}),
        ),
        tool(
            "b3",
            5,
            "mcp__ccd_pr__bind_pr",
            json!({"url": url.replace("1030", "1058")}),
            json!({"success": false, "error": {"message": "No such pull request"}}),
        ),
    ]);
    assert_eq!(
        summary(&found),
        [
            "MattShelton04/TracePilot#1057:updated",
            "MattShelton04/TracePilot#1030:updated"
        ]
    );
    assert!(
        found.pull_requests[0]
            .evidence
            .contains(Evidence::AppBinding)
    );
}

#[test]
fn github_mcp_reads_are_reviews() {
    let found = extract_flat(vec![
        tool(
            "m1",
            1,
            "github-mcp-server-pull_request_read",
            json!({"method": "get", "owner": "MattShelton04", "repo": "TracePilot", "pullNumber": 325}),
            json!({"success": true, "result": {"content":
                "{\"number\":325,\"title\":\"Faster search\",\"head\":{\"ref\":\"feat/search\"},\"base\":{\"ref\":\"main\"}}"}}),
        ),
        tool(
            "m2",
            3,
            "mcp__github__get_pull_request",
            json!({"owner": "MattShelton04", "repo": "TracePilot", "pull_number": "326"}),
            json!({"success": true, "result": {"content": "{}"}}),
        ),
        tool(
            "m3",
            5,
            "github-mcp-server-pull_request_read",
            json!({"method": "get_diff", "owner": "MattShelton04", "repo": "TracePilot", "pullNumber": 327}),
            json!({"success": false, "error": {"message": "Not Found"}}),
        ),
    ]);
    assert_eq!(
        summary(&found),
        [
            "MattShelton04/TracePilot#326:reviewed",
            "MattShelton04/TracePilot#325:reviewed"
        ]
    );
    let pr = &found.pull_requests[1];
    assert!(pr.evidence.contains(Evidence::McpTool));
    assert_eq!(pr.title.as_deref(), Some("Faster search"));
    assert_eq!(pr.head_ref.as_deref(), Some("feat/search"));
}

#[test]
fn roles_accumulate_and_the_strongest_sets_the_event() {
    let url = "https://github.com/MattShelton04/TracePilot/pull/50";
    let mut events = vec![start(REPO, None), user(1, url)];
    events.extend(copilot_shell("v1", 2, "gh pr view 50", "title: x", 0));
    events.extend(copilot_shell(
        "m1",
        4,
        "gh pr merge 50 --squash",
        &format!("Merged pull request {REPO}#50"),
        0,
    ));
    let found = extract(&events);
    let pr = only(&found);
    assert_eq!(
        describe(pr),
        "MattShelton04/TracePilot#50:merged,reviewed,mentioned"
    );
    assert_eq!(pr.event_index, Some(4));
    assert_eq!(
        (pr.first_seen_at, pr.last_seen_at),
        (Some(at(1)), Some(at(4)))
    );
}

#[test]
fn ordering_and_primary_selection() {
    let mut events = vec![start(REPO, None)];
    events.extend(copilot_shell("v1", 1, "gh pr view 7", "", 0));
    events.extend(copilot_shell(
        "c1",
        3,
        "gh pr create --fill",
        "https://github.com/MattShelton04/TracePilot/pull/5",
        0,
    ));
    events.extend(copilot_shell(
        "c2",
        5,
        "gh pr create --fill",
        "https://github.com/MattShelton04/TracePilot/pull/4",
        0,
    ));
    events.extend(copilot_shell("m1", 7, "gh pr merge 3", "", 0));
    events.extend(copilot_shell("m2", 7, "gh pr merge 2", "", 0));
    events.push(pr_link(8, 6));
    let found = extract(&events);
    assert_eq!(
        summary(&found),
        [
            "MattShelton04/TracePilot#4:created",
            "MattShelton04/TracePilot#5:created",
            "MattShelton04/TracePilot#6:updated",
            "MattShelton04/TracePilot#3:merged",
            "MattShelton04/TracePilot#2:merged",
            "MattShelton04/TracePilot#7:reviewed",
        ]
    );
    let primaries: Vec<_> = found.pull_requests.iter().map(|p| p.primary).collect();
    assert_eq!(primaries, [true, false, false, false, false, false]);
    assert!(found.primary().is_some_and(|p| p.key.number == 4));
}

#[test]
fn a_session_with_only_mentions_still_has_a_primary() {
    let found = extract(&[user(
        1,
        "https://github.com/MattShelton04/TracePilot/pull/1",
    )]);
    assert!(only(&found).primary);
    assert!(extract(&[]).primary().is_none());
}

#[test]
fn dedupe_is_case_insensitive_and_keeps_first_casing() {
    let found = extract(&[
        user(1, "https://github.com/mattshelton04/tracepilot/pull/8"),
        user(2, "https://GITHUB.COM/MattShelton04/TracePilot/pull/8"),
    ]);
    let pr = only(&found);
    assert_eq!(
        (
            pr.key.host.as_str(),
            pr.key.owner.as_str(),
            pr.key.repo.as_str()
        ),
        ("github.com", "mattshelton04", "tracepilot")
    );
    assert_eq!(
        pr.key.url(),
        "https://github.com/mattshelton04/tracepilot/pull/8"
    );
    assert_eq!(pr.last_seen_at, Some(at(2)));
}

#[test]
fn titles_are_cleaned_and_capped() {
    let long = "word ".repeat(100);
    let command = format!("gh pr create --title '  {long}\t' --body x");
    let found = extract_flat(vec![claude_shell(
        "c1",
        1,
        &command,
        "https://github.com/MattShelton04/TracePilot/pull/3",
        0,
    )]);
    let title = only(&found).title.clone().unwrap();
    assert!(title.chars().count() <= 200);
    assert!(title.starts_with("word word") && !title.ends_with(' '));
}

#[test]
fn context_changes_move_the_repository_for_bare_numbers() {
    let mut events = vec![start(REPO, None)];
    events.extend(copilot_shell("m1", 1, "gh pr merge 1", "", 0));
    events.push(event(
        "session.context_changed",
        2,
        json!({"repository": "other-owner/other-repo", "hostType": "github"}),
    ));
    events.extend(copilot_shell("m2", 3, "gh pr merge 2", "", 0));
    let found = extract(&events);
    assert_eq!(
        summary(&found),
        [
            "other-owner/other-repo#2:merged",
            "MattShelton04/TracePilot#1:merged"
        ]
    );
    assert!(
        found
            .pull_requests
            .iter()
            .all(|p| p.roles.contains(Role::Merged))
    );
}

#[test]
fn a_key_from_outside_is_valid_only_with_parts_the_extractor_keeps() {
    use crate::pull_requests::PullRequestKey;
    let key = |host: &str, owner: &str, repo: &str, number: u32| PullRequestKey {
        host: host.into(),
        owner: owner.into(),
        repo: repo.into(),
        number,
    };
    assert!(key("github.com", "Example", "orchard.rs_x-1", 58).is_valid());
    assert!(key("ghe.example.com", "e", "o", 999_999_999).is_valid());
    for bad in [
        key("github.com", "example", "orchard", 0),
        key("github.com", "example", "orchard", 1_000_000_000),
        key("localhost", "example", "orchard", 1),
        key("https://github.com", "example", "orchard", 1),
        key("github.com/x", "example", "orchard", 1),
        key(&format!("{}.com", "a".repeat(250)), "example", "orchard", 1),
        key("github.com", "a/b", "c", 1),
        key("github.com", "a", "b c", 1),
        key("github.com", "'; DROP", "orchard", 1),
        key("github.com", "-example", "orchard", 1),
        key("github.com", &"a".repeat(40), "orchard", 1),
        key("github.com", "example", &"r".repeat(101), 1),
        key("github.com", "example", "..", 1),
        key("github.com", "", "orchard", 1),
    ] {
        assert!(!bad.is_valid(), "{bad:?}");
    }
}
