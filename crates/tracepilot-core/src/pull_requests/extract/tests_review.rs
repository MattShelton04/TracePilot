//! Regression tests from review: hostile hosts and text, output another
//! command printed, `cd` out of the repository, and parser edge cases.

use std::time::{Duration, Instant};

use serde_json::json;

use super::command::{Shell, parse_command};
use super::test_support::*;
use super::text::{Hosts, branch_ref, clean_title, valid_host};
use crate::pull_requests::model::{PullRequestEvidence as Evidence, RepositoryHint};

const PR: &str = "https://github.com/MattShelton04/TracePilot/pull";

#[test]
fn a_repo_flag_host_must_be_a_real_host_name() {
    for host in [
        "evil.com#.ghe.com",
        "evil.com?.ghe.com",
        "evil.com@x.ghe.com",
        "evil.com\\.ghe.com",
        "evil.com:443.ghe.com",
    ] {
        let command = format!("gh pr merge 12 -R '{host}/o1/r1' --squash");
        let found = extract_flat(vec![
            vec![start(REPO, None)],
            claude_shell("m1", 1, &command, "", 0),
        ]);
        assert!(
            found.pull_requests.is_empty(),
            "{host}: {:?}",
            summary(&found)
        );
        assert!(!Hosts::default().allows(host), "{host}");
    }
    let tenant = extract_flat(vec![claude_shell(
        "m1",
        1,
        "gh pr merge 12 -R acme.ghe.com/o1/r1",
        "",
        0,
    )]);
    assert_eq!(
        only(&tenant).key.url(),
        "https://acme.ghe.com/o1/r1/pull/12"
    );
}

#[test]
fn ip_addresses_are_not_hosts() {
    assert!(!valid_host("10.0.0.5"));
    assert!(!valid_host("192.168.1.1"));
    assert!(valid_host("code.example.com"));
    let found = extract(&[
        start(REPO, Some("10.0.0.5")),
        user(1, "https://10.0.0.5/team/app/pull/1"),
    ]);
    assert!(found.pull_requests.is_empty());
}

#[test]
fn invisible_characters_leave_titles_and_disqualify_refs() {
    assert_eq!(
        clean_title("fix\u{202e}: evil\u{200b} \u{feff}title\u{00ad}").as_deref(),
        Some("fix: evil title")
    );
    assert_eq!(clean_title("\u{2066}\u{2069}"), None);
    assert_eq!(branch_ref("feat/\u{200b}x"), None);
    assert_eq!(branch_ref("feat/\u{202a}x"), None);
    assert_eq!(branch_ref("feat/x").as_deref(), Some("feat/x"));
}

#[test]
fn a_merge_line_in_another_command_output_is_not_a_merge() {
    let output = "Old work\nMerged pull request #7 (Old work)\nbody text";
    let command = "gh pr merge 5 --squash; gh pr view 6";
    let found = extract_flat(vec![
        vec![start(REPO, None)],
        copilot_shell("c1", 1, command, output, 0),
    ]);
    assert_eq!(
        summary(&found),
        [
            "MattShelton04/TracePilot#5:merged",
            "MattShelton04/TracePilot#6:reviewed"
        ]
    );
}

#[test]
fn several_merges_resolve_bare_status_lines_by_their_own_repo() {
    let command = "gh pr merge 3 -R o1/r1 --squash; gh pr merge 4 -R o2/r2 --squash";
    let output = "Merged pull request #3\nMerged pull request #4";
    let found = extract_flat(vec![
        vec![start(REPO, None)],
        copilot_shell("c1", 1, command, output, 0),
    ]);
    assert_eq!(summary(&found), ["o2/r2#4:merged", "o1/r1#3:merged"]);
}

#[test]
fn a_viewed_address_beside_a_create_is_not_created() {
    let command = "gh pr create --fill && gh pr view 12 --json url --jq .url";
    let output = format!("{PR}/40\n{PR}/12");
    let found = extract_flat(vec![
        vec![start(REPO, None)],
        claude_shell("c1", 1, command, &output, 0),
    ]);
    assert_eq!(
        summary(&found),
        [
            "MattShelton04/TracePilot#40:created",
            "MattShelton04/TracePilot#12:reviewed"
        ]
    );
    // A list's addresses beyond one per create aren't created either.
    let command = "gh pr create --fill; gh pr list --json url --jq '.[].url'";
    let output = format!("{PR}/41\n{PR}/2\n{PR}/3");
    let found = extract_flat(vec![claude_shell("c1", 1, command, &output, 0)]);
    assert_eq!(summary(&found), ["MattShelton04/TracePilot#41:created"]);
}

#[test]
fn view_current_ignores_a_failed_view_and_listed_addresses() {
    let command = "gh pr view --json url --jq .url; gh pr list --json url --jq '.[].url'";
    let output = format!("no pull requests found for branch \"feat\"\n{PR}/33");
    let found = extract_flat(vec![copilot_shell("c1", 1, command, &output, 0)]);
    assert!(found.pull_requests.is_empty(), "{:?}", summary(&found));
    let failed = extract_flat(vec![copilot_shell(
        "c1",
        1,
        "gh pr view --jq .url",
        &format!("{PR}/34"),
        1,
    )]);
    assert!(failed.pull_requests.is_empty());
    let jq = extract_flat(vec![copilot_shell(
        "c1",
        1,
        "gh pr view --json url --jq .url",
        &format!("{PR}/35"),
        0,
    )]);
    assert_eq!(summary(&jq), ["MattShelton04/TracePilot#35:updated"]);
    assert!(
        jq.pull_requests[0]
            .evidence
            .contains(Evidence::GhViewCurrent)
    );
}

#[test]
fn bare_numbers_use_the_pr_link_host_for_the_same_repository() {
    let link = event(
        "pr-link",
        1,
        json!({"type": "pr-link", "prNumber": 5, "prRepository": "acme/widgets",
            "prUrl": "https://ghe.corp.example.com/acme/widgets/pull/5"}),
    );
    let mut events = vec![
        event(
            "session.start",
            0,
            json!({"context": {"cwd": "/w", "repository": "acme/widgets"}}),
        ),
        link,
    ];
    events.extend(claude_shell("m1", 2, "gh pr merge 5 --squash", "", 0));
    events.extend(claude_shell("m2", 4, "gh pr merge 6 --squash", "", 0));
    let found = extract(&events);
    let hosts: Vec<_> = found.pull_requests.iter().map(|p| p.key.url()).collect();
    // #5 is also linked (updated), which ranks above a merge.
    assert_eq!(
        hosts,
        [
            "https://ghe.corp.example.com/acme/widgets/pull/5",
            "https://ghe.corp.example.com/acme/widgets/pull/6",
        ]
    );
    // The hint alone, as the indexer passes it.
    let events = vec![
        events[1].clone(),
        claude_shell("m1", 2, "gh pr merge 6", "", 0).remove(0),
        claude_shell("m1", 2, "gh pr merge 6", "", 0).remove(1),
    ];
    let hint = RepositoryHint {
        repository: Some("acme/widgets"),
        host_type: None,
    };
    let found = super::extract_pull_requests(&events, hint);
    assert!(
        found
            .pull_requests
            .iter()
            .all(|p| p.key.host == "ghe.corp.example.com")
    );
}

#[test]
fn help_is_not_the_action() {
    assert!(
        parse_command("gh pr merge 5 --help", Shell::Bash)
            .gh
            .is_empty()
    );
    assert!(parse_command("gh pr create -h", Shell::Bash).gh.is_empty());
    let found = extract_flat(vec![
        vec![start(REPO, None)],
        claude_shell("m1", 1, "gh pr merge 5 --help", "Usage: gh pr merge", 0),
    ]);
    assert!(found.pull_requests.is_empty());
}

#[test]
fn a_cd_out_of_the_repository_leaves_bare_numbers_unknown() {
    let mut events = vec![start(REPO, None)];
    for (i, command) in [
        "cd ../other && gh pr merge 5",
        "cd /elsewhere/repo && gh pr merge 6",
        "cd ~ && gh pr merge 7",
        "cd $dir; gh pr merge 8",
        // Inside the session's directory, the repository is unchanged.
        "cd .agent/worktrees/x && gh pr merge 9",
        "cd /work/sub && gh pr merge 10",
        "cd ../other && gh pr merge 11 -R other-owner/other-repo",
    ]
    .into_iter()
    .enumerate()
    {
        events.extend(claude_shell(
            &format!("m{i}"),
            (i as u32) * 2 + 1,
            command,
            "",
            0,
        ));
    }
    let found = extract(&events);
    assert_eq!(
        summary(&found),
        [
            "other-owner/other-repo#11:merged",
            "MattShelton04/TracePilot#10:merged",
            "MattShelton04/TracePilot#9:merged",
        ]
    );
}

#[test]
fn already_exists_stays_linear_on_hostile_output() {
    let output = "already exists:\n".repeat(60_000);
    let begun = Instant::now();
    let found = extract_flat(vec![claude_shell(
        "c1",
        1,
        "gh pr create --fill",
        &output,
        1,
    )]);
    assert!(found.pull_requests.is_empty());
    assert!(begun.elapsed() < Duration::from_secs(10));
}

#[test]
fn powershell_backslashes_and_block_comments() {
    let quoted = r#"cd "C:\repo\"; echo "; gh pr merge 12""#;
    assert!(parse_command(quoted, Shell::PowerShell).gh.is_empty());
    let comment = "<# gh pr merge 12\n#>\nWrite-Output done";
    assert!(parse_command(comment, Shell::PowerShell).gh.is_empty());
    // PowerShell's own escape keeps a quote inside a string.
    let escaped = "echo \"a`\"; gh pr merge 1\"; gh pr merge 13";
    let parsed = parse_command(escaped, Shell::PowerShell);
    assert_eq!(parsed.gh.len(), 1);
}

#[test]
fn slash_command_prompts_are_mentions() {
    let url = format!("{PR}/9");
    let found = extract(&[
        event(
            "user.message",
            1,
            json!({"content": format!("/review {url}"), "source": "command-review"}),
        ),
        event(
            "user.message",
            2,
            json!({"content": format!("{PR}/10"), "source": "command-local"}),
        ),
    ]);
    assert_eq!(summary(&found), ["MattShelton04/TracePilot#9:mentioned"]);
}
