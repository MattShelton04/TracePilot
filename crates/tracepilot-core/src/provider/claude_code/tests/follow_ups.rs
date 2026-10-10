//! Background agents resumed by `SendMessage` (mapping.md §1.3).

use tracepilot_test_support::claude_scenarios as fixtures;

use super::parse;
use crate::agent_runs::{AgentRunOutcome, extract_agent_runs};
use crate::models::{ConversationTurn, TurnToolCall};
use crate::turns::reconstruct_turns;

fn tool_call<'a>(turns: &'a [ConversationTurn], id: &str) -> &'a TurnToolCall {
    turns
        .iter()
        .flat_map(|t| &t.tool_calls)
        .find(|tc| tc.tool_call_id.as_deref() == Some(id))
        .unwrap_or_else(|| panic!("tool call {id}"))
}

/// A resumed agent completes again, with its new totals, and every carrier
/// of one completion still counts once, even one written after the resume.
/// A follow-up to a running agent and a peer message that is not a hand-back
/// leave the agent to its own completion.
#[test]
fn a_resumed_background_agent_completes_again() {
    let parsed = parse(&fixtures::agent_follow_ups());
    let turns = reconstruct_turns(&parsed.events);

    let review = tool_call(&turns, "toolu_R");
    assert!(review.is_subagent);
    assert!(review.is_complete, "the resumed reviewer completes again");
    assert_eq!(review.success, Some(true));
    assert_eq!(review.agent_status.as_deref(), Some("completed"));
    assert_eq!(
        review.total_tokens,
        Some(900),
        "the second completion's totals"
    );

    let docs = tool_call(&turns, "toolu_W");
    assert!(docs.is_complete, "a follow-up to a running agent");
    assert_eq!(docs.agent_status.as_deref(), Some("completed"));

    for send in ["toolu_S1", "toolu_S2"] {
        let send = tool_call(&turns, send);
        assert_eq!(send.tool_name, "write_agent");
        assert!(
            !send.is_subagent,
            "a resumed completion names its SendMessage"
        );
        assert!(send.is_complete);
    }

    let runs = extract_agent_runs(&parsed.events, &turns).runs;
    assert_eq!(runs.len(), 2);
    assert!(
        runs.iter().all(|r| r.outcome == AgentRunOutcome::Completed),
        "{:?}",
        runs.iter().map(|r| r.outcome).collect::<Vec<_>>()
    );

    let terminals: Vec<_> = parsed
        .events
        .iter()
        .filter(|e| e.raw.event_type == "subagent.completed")
        .map(|e| (e.raw.agent_id.as_deref(), e.raw.data["toolCallId"].as_str()))
        .collect();
    assert_eq!(
        terminals,
        [
            (Some("agentR"), Some("toolu_R")),
            (Some("agentR"), Some("toolu_R")),
            (Some("agentW"), Some("toolu_W")),
        ],
        "one per completion, on the launching call"
    );
    let notifications = parsed
        .events
        .iter()
        .filter(|e| e.raw.event_type == "system.notification")
        .count();
    assert_eq!(notifications, 3);
    assert_eq!(parsed.diagnostics.duplicate_notifications, 4);
}

/// A `SendMessage` to a killed agent fails with `{success: false}` and no
/// `is_error`. It is a failed `write_agent`, so the agent stays ended
/// instead of reopening as running.
#[test]
fn a_failed_send_message_leaves_a_killed_agent_ended() {
    use serde_json::json;
    use tracepilot_test_support::claude::{
        OPUS, Transcript, Usage, task_notification, text, tool_use, write_session,
    };

    let mut t = Transcript::main();
    t.prompt("Run the reviewer.");
    let u = Usage::new(1, 10, 0, 1);
    let agent = json!({"subagent_type": "general-purpose", "description": "review",
        "prompt": "review", "run_in_background": true});
    t.call(
        "msg_1",
        OPUS,
        vec![tool_use("toolu_K", "Agent", agent)],
        u,
        "tool_use",
    );
    t.tool_result(
        "toolu_K",
        json!("Async agent launched successfully."),
        json!({"status": "async_launched", "isAsync": true, "agentId": "agentK"}),
        false,
    );
    t.user(
        json!({"origin": {"kind": "task-notification"}, "message": {"role": "user",
        "content": task_notification("agentK", "toolu_K", "killed", None)}}),
    );
    t.call(
        "msg_2",
        OPUS,
        vec![tool_use(
            "toolu_S",
            "SendMessage",
            json!({"to": "agentK", "message": "Go on.", "summary": "Go on"}),
        )],
        u,
        "tool_use",
    );
    t.tool_result(
        "toolu_S",
        json!([{"type": "text", "text": "No agent named agentK is running."}]),
        json!({"success": false, "message": "No agent named agentK is running."}),
        false,
    );
    t.call("msg_3", OPUS, vec![text("It was stopped.")], u, "end_turn");
    let parsed = parse(&write_session(&t, &[]));
    let turns = reconstruct_turns(&parsed.events);

    let killed = tool_call(&turns, "toolu_K");
    assert!(killed.is_complete, "the killed agent stays ended");
    assert_ne!(killed.agent_status.as_deref(), Some("running"));
    let send = tool_call(&turns, "toolu_S");
    assert_eq!(send.tool_name, "write_agent");
    assert_eq!(send.success, Some(false), "a refused message failed");
}

/// A background agent launched before the session's last `cost-state` and
/// resumed by `SendMessage` after the session resumed: its later calls are
/// made after the snapshot, so they are in the tail, not counted as covered.
#[test]
fn a_resumed_agents_later_calls_are_not_covered_by_an_earlier_snapshot() {
    use tracepilot_test_support::claude::OPUS;

    use crate::provider::claude_code::{TokenTotals, sum_calls_by_model};

    let parsed = parse(&fixtures::agent_resumed_after_session_resume());
    assert_eq!(parsed.cost_snapshots.len(), 1);
    let mut tail: Vec<_> = parsed.tail_calls().map(|c| c.message_id.as_str()).collect();
    tail.sort_unstable();
    assert_eq!(
        tail,
        ["msg_R2", "msg_R3", "msg_m4", "msg_m5", "msg_m6", "msg_m7"],
        "R's first call is covered; its calls after each resume are not"
    );
    let snapshot = parsed.cost_snapshots[0].line;
    let anchor = |id: &str| {
        parsed
            .calls
            .iter()
            .find(|c| c.message_id == id)
            .and_then(|c| c.snapshot_anchor)
            .unwrap()
    };
    assert!(anchor("msg_R1") < snapshot);
    assert_eq!(anchor("msg_R2"), anchor("msg_m4"), "anchored at its resume");
    assert_eq!(anchor("msg_R3"), anchor("msg_m6"));
    assert_eq!(
        sum_calls_by_model(parsed.tail_calls())[OPUS],
        TokenTotals {
            calls: 6,
            input_tokens: 11,
            cache_read_tokens: 110,
            cache_write_tokens: 0,
            output_tokens: 11,
        }
    );
}

/// Claude Code's tool uses and duration count from the agent's latest
/// restart: a resume that restarts them reports that episode alone, one that
/// continues them reports the total since the restart. The run's totals add
/// each restart's last report; its tokens are Claude Code's latest figure.
#[test]
fn a_resumed_agents_run_totals_add_up_across_restarts() {
    let parsed = parse(&fixtures::agent_resumed_after_session_resume());
    let turns = reconstruct_turns(&parsed.events);
    let review = tool_call(&turns, "toolu_R");
    assert!(review.is_complete);
    assert_eq!(
        (
            review.total_tool_calls,
            review.duration_ms,
            review.total_tokens
        ),
        (Some(8), Some(85_000), Some(1300)),
        "5 + (2, continued to 3) tool uses; 60 s + 25 s"
    );
    let runs = extract_agent_runs(&parsed.events, &turns).runs;
    let run = runs
        .iter()
        .find(|r| r.tool_call_id.as_deref() == Some("toolu_R"))
        .unwrap();
    assert_eq!(run.outcome, AgentRunOutcome::Completed);
    assert_eq!(
        (run.total_tool_calls, run.duration_ms, run.total_tokens),
        (Some(8), Some(85_000), Some(1300))
    );
}

/// Two parallel `SendMessage`s resume A and B after the snapshot, and both
/// results share one record whose `toolUseResult` names only B. Each
/// message counts for the agent it was sent to, so both agents' later calls
/// are in the tail.
#[test]
fn parallel_resumes_sharing_one_result_record_each_leave_the_snapshot() {
    use serde_json::json;
    use tracepilot_test_support::claude::{
        HAIKU, OPUS, Subagent, Transcript, Usage, subagent_meta, text, tool_use, write_session,
    };

    let u = Usage::new(1, 10, 0, 1);
    let mut t = Transcript::main();
    t.prompt("Review both.");
    for (message, tool, agent) in [
        ("msg_m1", "toolu_A", "agentA"),
        ("msg_m2", "toolu_B", "agentB"),
    ] {
        let input = json!({"subagent_type": "general-purpose", "description": "review",
            "prompt": "review", "run_in_background": true});
        t.call(
            message,
            OPUS,
            vec![tool_use(tool, "Agent", input)],
            u,
            "tool_use",
        );
        t.tool_result(
            tool,
            json!("Async agent launched successfully."),
            json!({"status": "async_launched", "isAsync": true, "agentId": agent}),
            false,
        );
    }
    t.call("msg_m3", OPUS, vec![text("Both done.")], u, "end_turn"); // 6 s
    for _ in 0..2 {
        t.cost_state(&[(OPUS, Usage::new(5, 50, 0, 5), 0.05), (HAIKU, u, 0.001)]);
    }
    t.idle(1000);
    t.prompt("Go on."); // 1007 s
    let send = |tool: &str, to: &str| {
        tool_use(tool, "SendMessage", json!({"to": to, "message": "Go on."}))
    };
    t.call(
        "msg_m4",
        OPUS,
        vec![send("toolu_SA", "agentA"), send("toolu_SB", "agentB")],
        u,
        "tool_use",
    ); // 1008 s, 1009 s
    t.user(json!({
        "message": {"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": "toolu_SA", "content": "Message sent."},
            {"type": "tool_result", "tool_use_id": "toolu_SB", "content": "Message sent."},
        ]},
        "toolUseResult": {"success": true, "message": "Message sent.", "resumedAgentId": "agentB"},
    }));
    let agent = |id: &str, namespace: u32, first: &str, later: &str| {
        let mut a = Transcript::subagent(id, namespace);
        a.at(3).prompt("review");
        a.at(4).call(
            first,
            OPUS,
            vec![text("Done.")],
            Usage::new(2, 20, 0, 2),
            "end_turn",
        );
        a.at(1010).call(
            later,
            OPUS,
            vec![text("Again.")],
            Usage::new(2, 20, 0, 2),
            "end_turn",
        );
        a
    };
    let a = agent("agentA", 1, "msg_A1", "msg_A2");
    let b = agent("agentB", 2, "msg_B1", "msg_B2");
    let files = write_session(
        &t,
        &[
            Subagent {
                agent_id: "agentA",
                transcript: &a,
                meta: Some(subagent_meta("toolu_A", "general-purpose", 1)),
            },
            Subagent {
                agent_id: "agentB",
                transcript: &b,
                meta: Some(subagent_meta("toolu_B", "general-purpose", 1)),
            },
        ],
    );
    let parsed = parse(&files);
    let mut tail: Vec<_> = parsed.tail_calls().map(|c| c.message_id.as_str()).collect();
    tail.sort_unstable();
    assert_eq!(tail, ["msg_A2", "msg_B2", "msg_m4"]);
}
