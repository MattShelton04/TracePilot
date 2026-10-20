//! Shell evidence, continued: async shells read back through their shell id,
//! `git push` branches, enterprise hosts and large outputs.

use serde_json::json;

use super::command::{Shell, parse_command};
use super::test_support::*;
use crate::pull_requests::model::PullRequestRole as Role;

#[test]
fn async_shell_output_is_joined_through_its_shell_id() {
    let running = "<command with shellId: 50 is still running after 30 seconds. Use read_powershell to continue waiting.>";
    let output = format!(
        "Creating pull request for feat into main in {REPO}{URL_475}\n<shellId: 50 completed with exit code 0>"
    );
    let found = extract_flat(vec![
        tool(
            "c1",
            1,
            "powershell",
            json!({"command": "gh pr create --fill", "mode": "async"}),
            json!({"success": true, "result": {"content": running}}),
        ),
        tool(
            "r1",
            40,
            "read_powershell",
            json!({"shellId": "50", "delay": 10}),
            json!({"success": true, "result": {"content": output}}),
        ),
    ]);
    let pr = only(&found);
    assert_eq!(describe(pr), "MattShelton04/TracePilot#475:created");
    // The command's own start event, not the read.
    assert_eq!(pr.event_index, Some(0));
}

#[test]
fn claude_background_shell_is_read_through_bash_output() {
    let found = extract_flat(vec![
        tool(
            "c1",
            1,
            "shell",
            json!({"command": "gh pr create --fill", "shellId": "bg1", "mode": "background"}),
            json!({"success": true, "result": {"content": "Command running in background with ID: bg1"}}),
        ),
        tool(
            "r1",
            9,
            "read_powershell",
            json!({"shellId": "bg1"}),
            json!({"success": true, "result": {"content": URL_475}}),
        ),
    ]);
    assert_eq!(summary(&found), ["MattShelton04/TracePilot#475:created"]);
}

#[test]
fn pushes_record_updated_branches() {
    let output = "To https://github.com/MattShelton04/TracePilot.git\n \
        * [new branch]      feat/a -> feat/a\n   \
        1a2b3c4..5d6e7f8  main -> main\n \
        + 1a2b3c4...5d6e7f8 feat/b -> feat/b (forced update)\n \
        ! [rejected]        feat/c -> feat/c (fetch first)\n \
        - [deleted]         old\n \
        * [new tag]         v1 -> v1\n \
        = [up to date]      feat/d -> feat/d\n\
        remote: Create a pull request for 'feat/a' on GitHub by visiting:\n\
        remote:      https://github.com/MattShelton04/TracePilot/pull/new/feat/a";
    let found = extract_flat(vec![
        claude_shell(
            "p1",
            1,
            "git push -u origin feat/a main feat/b feat/c",
            output,
            1,
        ),
        claude_shell(
            "p2",
            5,
            "git -C ../wt push",
            "To git@github.com:MattShelton04/TracePilot.git\n   0000aaa..1111bbb  feat/a -> feat/a",
            0,
        ),
        claude_shell(
            "p3",
            7,
            "git push",
            "To ssh://git@gitlab.com/someone/project.git\n * [new branch] x -> x",
            0,
        ),
    ]);
    assert!(found.pull_requests.is_empty(), "{:?}", summary(&found));
    let branches: Vec<_> = found
        .pushed_branches
        .iter()
        .map(|b| (b.branch.as_str(), b.push_count))
        .collect();
    assert_eq!(branches, [("feat/a", 2), ("main", 1), ("feat/b", 1)]);
    let a = &found.pushed_branches[0];
    assert_eq!(
        (a.host.as_str(), a.owner.as_str(), a.repo.as_str()),
        ("github.com", "MattShelton04", "TracePilot")
    );
    assert_eq!(
        (a.first_push_at, a.last_push_at),
        (Some(at(1)), Some(at(5)))
    );
}

#[test]
fn ref_lines_need_a_github_remote_first() {
    let found = extract_flat(vec![claude_shell(
        "p1",
        1,
        "git push",
        " * [new branch] x -> x",
        0,
    )]);
    assert!(found.pushed_branches.is_empty());
}

#[test]
fn ghe_hosts_come_from_the_session() {
    let ghe_url = "https://code.example.com/team/app/pull/7";
    let tenant = "https://acme.ghe.com/team/app/pull/8";
    let unknown = "https://gitlab.com/team/app/pull/9";
    let output = format!("{ghe_url}\n{tenant}\n{unknown}");
    let with_host = extract_flat(vec![
        vec![start("team/app", Some("code.example.com"))],
        copilot_shell("c1", 1, "gh pr create --fill", &output, 0),
        copilot_shell("c2", 3, "gh pr merge 5", "", 0),
    ]);
    let hosts: Vec<_> = with_host
        .pull_requests
        .iter()
        .map(|p| (p.key.host.as_str(), p.key.number))
        .collect();
    assert_eq!(
        hosts,
        [
            ("acme.ghe.com", 8),
            ("code.example.com", 7),
            ("code.example.com", 5)
        ]
    );
    let without = extract_flat(vec![copilot_shell(
        "c1",
        1,
        "gh pr create --fill",
        &output,
        0,
    )]);
    assert_eq!(summary(&without), ["team/app#8:created"]);
}

#[test]
fn large_outputs_are_read_at_their_edges() {
    let filler = "x".repeat(2 << 20);
    let output = format!("{URL_475}\n{filler}\n{}", URL_475.replace("475", "476"));
    let found = extract_flat(vec![claude_shell(
        "c1",
        1,
        "gh pr create --fill",
        &output,
        0,
    )]);
    assert_eq!(found.pull_requests.len(), 2);
    assert!(
        found
            .pull_requests
            .iter()
            .all(|p| p.roles.contains(Role::Created))
    );
}

#[test]
fn a_truncated_preview_keeps_the_glued_address() {
    let preview = format!(
        "Output too large to read at once (23.6 KB). Saved to: /tmp/out.txt\n\nPreview (first 128 chars):\nePilot\u{28fe}\u{28fd}{URL_475}\n___BEGIN___COMMAND_DONE_MARKER___0"
    );
    let found = extract_flat(vec![copilot_shell(
        "c1",
        1,
        "gh pr create --fill",
        &preview,
        0,
    )]);
    assert_eq!(summary(&found), ["MattShelton04/TracePilot#475:created"]);
}

#[test]
fn escaped_backticks_in_double_quotes_do_not_hide_later_commands() {
    let command = r#"grep -n "Commit \`" body.md && git push -u origin feat 2>&1 | tail -2 && gh pr create --head feat --title "fix: x""#;
    let parsed = parse_command(command, Shell::Bash);
    assert!(parsed.pushes);
    assert_eq!(parsed.gh.len(), 1);
    assert_eq!(parsed.gh[0].title.as_deref(), Some("fix: x"));
}

#[test]
fn a_background_merge_counts_only_once_its_exit_code_is_known() {
    let background = || {
        let mut events = vec![start(REPO, None)];
        events.extend(tool("c1", 1, "shell", json!({"command": "gh pr merge 950 --squash", "shellId": "bg1", "mode": "background"}),
            json!({"success": true, "result": {"content": "Command running in background with ID: bg1"}})));
        events
    };
    assert!(extract(&background()).pull_requests.is_empty());
    let mut events = background();
    events.push(event("system.notification", 9, json!({"content": "done",
        "kind": {"type": "shell_completed", "shellId": "bg1", "status": "completed", "exitCode": 0}})));
    assert_eq!(
        summary(&extract(&events)),
        ["MattShelton04/TracePilot#950:merged"]
    );
}
