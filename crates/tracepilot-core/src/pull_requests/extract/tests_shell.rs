//! Shell evidence: `gh pr` commands and their output. Outputs follow the
//! real shapes: Copilot's TTY spinner with the address glued on, the
//! mojibake check mark, and trailers.

use super::command::{Shell, Target, Verb, parse_command};
use super::test_support::*;
use crate::pull_requests::model::PullRequestEvidence as Evidence;

#[test]
fn copilot_tty_create_with_spinner_and_glued_url() {
    let output = format!(
        "\u{28fe}\u{28fd}\u{28fb}\nCreating pull request for Matt/Fix_x into main in {REPO}\u{28fe}\u{28fd}{URL_475}"
    );
    let command = "cd C:\\work; gh pr create --title 'fix: the thing' --body $body";
    let found = extract_flat(vec![
        vec![start(REPO, None)],
        copilot_shell("c1", 5, command, &output, 0),
    ]);
    let pr = only(&found);
    assert_eq!(describe(pr), "MattShelton04/TracePilot#475:created");
    assert!(pr.evidence.contains(Evidence::GhCreate));
    assert_eq!(pr.head_ref.as_deref(), Some("Matt/Fix_x"));
    assert_eq!(pr.base_ref.as_deref(), Some("main"));
    assert_eq!(pr.title.as_deref(), Some("fix: the thing"));
    assert_eq!(pr.event_index, Some(1));
    assert_eq!(pr.first_seen_at, Some(at(5)));
    assert!(pr.primary);
}

#[test]
fn ansi_escapes_and_carriage_returns_are_ignored() {
    let output = format!(
        "\u{1b}[2K\rCreating draft pull request for feat into dev in {REPO}\r{URL_475}\u{1b}[0m"
    );
    let found = extract_flat(vec![copilot_shell(
        "c1",
        1,
        "gh pr create --draft --fill",
        &output,
        0,
    )]);
    let pr = only(&found);
    assert_eq!(pr.head_ref.as_deref(), Some("feat"));
    assert_eq!(pr.base_ref.as_deref(), Some("dev"));
}

#[test]
fn non_tty_create_prints_only_the_url() {
    let command =
        "git push -u origin feat && gh pr create --base main --head feat --title \"Add $thing\"";
    let found = extract_flat(vec![claude_shell(
        "c1",
        1,
        command,
        &format!("Warning: 1 uncommitted change\n{URL_475}"),
        0,
    )]);
    let pr = only(&found);
    assert_eq!(describe(pr), "MattShelton04/TracePilot#475:created");
    assert_eq!(pr.head_ref.as_deref(), Some("feat"));
    // A title with a variable in double quotes isn't knowable.
    assert_eq!(pr.title, None);
}

#[test]
fn one_call_can_create_several_pull_requests() {
    let command =
        "gh pr create --head a --title A --body x\ngh pr create --head b --title B --body y";
    let output = "https://github.com/MattShelton04/TracePilot/pull/996\nhttps://github.com/MattShelton04/TracePilot/pull/997";
    let found = extract_flat(vec![claude_shell("c1", 1, command, output, 0)]);
    assert_eq!(found.pull_requests.len(), 2);
    let titles: Vec<_> = found
        .pull_requests
        .iter()
        .map(|p| p.title.clone().unwrap_or_default())
        .collect();
    assert!(titles.contains(&"A".to_string()) && titles.contains(&"B".to_string()));
    let pr_996 = found
        .pull_requests
        .iter()
        .find(|p| p.key.number == 996)
        .unwrap();
    assert_eq!(pr_996.title.as_deref(), Some("A"));
    assert_eq!(pr_996.head_ref.as_deref(), Some("a"));
}

#[test]
fn a_create_without_an_address_links_nothing() {
    let failed = "GraphQL: No commits between main and feat (createPullRequest)";
    let found = extract_flat(vec![
        copilot_shell("c1", 1, "gh pr create --fill", failed, 1),
        // Help text and docs mention addresses that aren't bare lines.
        copilot_shell(
            "c2",
            3,
            "gh pr create --help",
            &format!("See {URL_475} for details"),
            0,
        ),
    ]);
    assert!(found.pull_requests.is_empty());
}

#[test]
fn a_create_command_must_be_at_command_position() {
    let commands = [
        "grep -rn 'gh pr create' docs/",
        "echo \"run gh pr create when ready\"",
        "rg \"gh pr create\" && cat notes.md",
        "# gh pr create --fill\ncat notes.md",
        "$body = @'\nThen run:\ngh pr create --fill\n'@\nWrite-Output $body",
        "cat <<'EOF' > notes.md\ngh pr create --fill\nEOF\ncat notes.md",
    ];
    for command in commands {
        for shell in [Shell::Bash, Shell::PowerShell] {
            assert!(parse_command(command, shell).gh.is_empty(), "{command}");
        }
        let found = extract_flat(vec![claude_shell("c1", 1, command, URL_475, 0)]);
        assert!(found.pull_requests.is_empty(), "{command}");
    }
}

#[test]
fn command_position_allows_prefixes_and_assignments() {
    let commands = [
        "cd /x && gh pr create --fill",
        "GH_PROMPT_DISABLED=1 gh pr create --fill",
        "$url = gh pr create --fill",
        "& gh pr create --fill",
        "url=$(gh pr create --fill)",
        "if ($ok) { gh pr create --fill }",
        "gh pr create --fill 2>&1 | Out-String",
    ];
    for command in commands {
        for shell in [Shell::Bash, Shell::PowerShell] {
            let parsed = parse_command(command, shell);
            assert_eq!(parsed.gh.len(), 1, "{command}");
            assert_eq!(parsed.gh[0].verb, Verb::Create, "{command}");
        }
    }
    let parsed = parse_command(
        "gh pr view 2>&1; gh pr view 12 -R o1/r1; gh pr view $n",
        Shell::Bash,
    );
    let targets: Vec<_> = parsed.gh.iter().map(|g| g.target.clone()).collect();
    assert_eq!(
        targets,
        [Target::Current, Target::Number(12), Target::Unknown]
    );
}

#[test]
fn already_exists_is_an_update_with_its_branches() {
    let output = format!(
        "a pull request for branch \"cli/tech_debt\" into branch \"main\" already exists:\n{URL_475}"
    );
    let found = extract_flat(vec![copilot_shell(
        "c1",
        1,
        "gh pr create --fill",
        &output,
        1,
    )]);
    let pr = only(&found);
    assert_eq!(describe(pr), "MattShelton04/TracePilot#475:updated");
    assert!(pr.evidence.contains(Evidence::GhCreateExists));
    assert!(!pr.evidence.contains(Evidence::GhCreate));
    assert_eq!(pr.head_ref.as_deref(), Some("cli/tech_debt"));
    assert_eq!(pr.base_ref.as_deref(), Some("main"));
}

#[test]
fn merge_output_with_mojibake_and_deleted_branch() {
    let output = format!(
        "\u{d4}\u{a3}\u{f4} Pull request {REPO}#261 is marked as \"ready for review\"\n\
         \u{d4}\u{a3}\u{f4} Squashed and merged pull request {REPO}#261 (refactor: split  the writer)\n\
         \u{d4}\u{a3}\u{f4} Deleted local branch copilot/split\n\
         \u{d4}\u{a3}\u{f4} Deleted remote branch copilot/split"
    );
    let command =
        "gh pr ready 261 2>&1 && gh pr merge 261 --squash --delete-branch --body \"x\" 2>&1";
    let found = extract_flat(vec![copilot_shell("c1", 1, command, &output, 0)]);
    let pr = only(&found);
    assert_eq!(describe(pr), "MattShelton04/TracePilot#261:updated,merged");
    assert!(pr.evidence.contains(Evidence::GhMerge));
    assert_eq!(pr.title.as_deref(), Some("refactor: split the writer"));
    assert_eq!(pr.head_ref.as_deref(), Some("copilot/split"));
}

#[test]
fn a_failed_merge_is_not_a_merge() {
    let output = "GraphQL: Pull Request is still a draft (mergePullRequest)";
    let found = extract_flat(vec![
        vec![start(REPO, None)],
        copilot_shell("c1", 1, "gh pr merge 261 --squash", output, 1),
    ]);
    assert!(found.pull_requests.is_empty());
}

#[test]
fn a_bare_merge_number_resolves_to_the_session_repository() {
    let found = extract_flat(vec![
        vec![start(REPO, None)],
        copilot_shell("c1", 1, "gh pr merge 976 --squash", "", 0),
        // `-R` names another repository.
        copilot_shell(
            "c2",
            3,
            "gh pr merge 12 -R other-owner/other-repo --rebase",
            "",
            0,
        ),
        // Without any repository a bare number is dropped.
    ]);
    assert_eq!(
        summary(&found),
        [
            "other-owner/other-repo#12:merged",
            "MattShelton04/TracePilot#976:merged"
        ]
    );
    let none = extract_flat(vec![copilot_shell(
        "c1",
        1,
        "gh pr merge 976 --squash",
        "",
        0,
    )]);
    assert!(none.pull_requests.is_empty());
}

#[test]
fn the_repository_hint_resolves_numbers_when_the_session_has_none() {
    use crate::pull_requests::model::RepositoryHint;
    let events: Vec<_> = copilot_shell("c1", 1, "gh pr merge 976", "", 0);
    let hint = RepositoryHint {
        repository: Some(REPO),
        host_type: Some("github"),
    };
    let found = super::extract_pull_requests(&events, hint);
    assert_eq!(summary(&found), ["MattShelton04/TracePilot#976:merged"]);
    let ado = RepositoryHint {
        repository: Some(REPO),
        host_type: Some("ado"),
    };
    assert!(
        super::extract_pull_requests(&events, ado)
            .pull_requests
            .is_empty()
    );
}

#[test]
fn view_without_a_number_is_the_current_branch_pull_request() {
    let output = format!(
        "BRANCH=release/v0.9.3\n{{\"baseRefName\":\"main\",\"headRefName\":\"release/v0.9.3\",\"number\":1069,\"title\":\"chore: release v0.9.3\",\"url\":\"https://github.com/{REPO}/pull/1069\"}}"
    );
    let command = "$branch = git branch --show-current; gh pr view --json number,title,url,headRefName,baseRefName 2>$null";
    let found = extract_flat(vec![copilot_shell("c1", 1, command, &output, 0)]);
    let pr = only(&found);
    assert_eq!(describe(pr), "MattShelton04/TracePilot#1069:updated");
    assert!(pr.evidence.contains(Evidence::GhViewCurrent));
    assert_eq!(pr.head_ref.as_deref(), Some("release/v0.9.3"));
    assert_eq!(pr.base_ref.as_deref(), Some("main"));
    assert_eq!(pr.title.as_deref(), Some("chore: release v0.9.3"));
    let none = extract_flat(vec![copilot_shell(
        "c1",
        1,
        "gh pr view",
        "no pull requests found for branch \"x\"",
        1,
    )]);
    assert!(none.pull_requests.is_empty());
}

#[test]
fn view_with_a_number_is_a_review() {
    let found = extract_flat(vec![
        vec![start(REPO, None)],
        copilot_shell(
            "c1",
            1,
            "gh pr view 12 --json title,number",
            "{\"number\":12,\"title\":\"Fix it\"}",
            0,
        ),
        copilot_shell(
            "c2",
            3,
            &format!("gh pr diff {URL_475}"),
            "diff --git a/x b/x",
            0,
        ),
        copilot_shell("c3", 5, "gh pr checks 540", "build  fail", 1),
        copilot_shell(
            "c4",
            7,
            "gh pr view 13",
            "GraphQL: Could not resolve to a PullRequest",
            1,
        ),
    ]);
    assert_eq!(
        summary(&found),
        [
            "MattShelton04/TracePilot#540:reviewed",
            "MattShelton04/TracePilot#475:reviewed",
            "MattShelton04/TracePilot#12:reviewed",
        ]
    );
    let pr_12 = &found.pull_requests[2];
    assert_eq!(pr_12.title.as_deref(), Some("Fix it"));
    assert!(pr_12.evidence.contains(Evidence::GhCommand));
}

#[test]
fn edits_and_comments_are_updates() {
    let found = extract_flat(vec![
        vec![start(REPO, None)],
        copilot_shell(
            "c1",
            1,
            "gh pr edit 471 --body x",
            URL_475.replace("475", "471").as_str(),
            0,
        ),
        copilot_shell(
            "c2",
            3,
            "gh pr comment --body ok",
            &format!("{URL_475}#issuecomment-1"),
            0,
        ),
        copilot_shell(
            "c3",
            5,
            "gh pr close 9 --comment no",
            "X Could not close",
            1,
        ),
    ]);
    assert_eq!(
        summary(&found),
        [
            "MattShelton04/TracePilot#475:updated",
            "MattShelton04/TracePilot#471:updated"
        ]
    );
}
