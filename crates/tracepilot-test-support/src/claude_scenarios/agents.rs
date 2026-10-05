//! Scenarios with subagents, notifications and meta records.

use serde_json::json;

use crate::claude::{
    HAIKU, OPUS, SessionFiles, Subagent, Transcript, Usage, subagent_meta, task_notification, text,
    tool_use, write_session,
};

/// One human prompt plus every meta kind that must not open a turn: skill
/// context, a background-shell notification queued mid-turn,
/// auto-continuation, compaction and its summary, a subagent hand-back and a
/// mid-turn notification in a `user` record. With `idle_wake`, a final
/// notification arrives after the model ended its work, which opens one
/// system-initiated turn.
pub fn meta_records(idle_wake: bool) -> SessionFiles {
    let mut t = Transcript::main();
    t.prompt("Deploy the demo.");
    let u = Usage::new(1, 100, 0, 10);
    t.call(
        "msg_m1",
        OPUS,
        vec![tool_use("toolu_s1", "Skill", json!({"skill": "deploy"}))],
        u,
        "tool_use",
    );
    t.tool_result(
        "toolu_s1",
        json!("Launching skill: deploy"),
        json!({"success": true, "commandName": "deploy"}),
        false,
    );
    t.meta(
        "Base directory for this skill: C:\\skills\\deploy\n\n# Deploy\nRun the steps.",
        None,
    );
    t.call(
        "msg_m2",
        OPUS,
        vec![
            tool_use(
                "toolu_b1",
                "Bash",
                json!({"command": "npm run build", "run_in_background": true}),
            ),
            tool_use(
                "toolu_ag1",
                "Agent",
                json!({"subagent_type": "general-purpose",
                "description": "Map the indexer", "prompt": "Map it."}),
            ),
        ],
        u,
        "tool_use",
    );
    t.tool_result("toolu_b1", json!("Command running in background with ID: shell1"),
        json!({"stdout": "", "stderr": "", "interrupted": false, "isImage": false, "backgroundTaskId": "shell1"}), false);
    t.tool_result("toolu_ag1", json!("Async agent launched successfully."),
        json!({"status": "async_launched", "isAsync": true, "agentId": "a1", "description": "Map the indexer"}), false);
    t.bookkeeping(json!({"type": "queue-operation", "operation": "enqueue",
        "content": task_notification("shell1", "toolu_b1", "completed", None)}));
    t.meta(
        "Continue from where you left off.",
        Some(json!({"kind": "auto-continuation"})),
    );
    let before = t.last_uuid().unwrap_or_default();
    t.compact_boundary(&before, 380_000, 12_000);
    t.user(json!({"isCompactSummary": true, "isVisibleInTranscriptOnly": true,
        "message": {"role": "user", "content": "Summary: deploying the demo; an agent maps the indexer."}}));
    t.call(
        "msg_m3",
        OPUS,
        vec![text("Waiting for the indexer map.")],
        u,
        "tool_use",
    );
    t.user(
        json!({"isMeta": true, "origin": {"kind": "peer", "from": "a1", "handback": true,
        "body": "The indexer has three stages."}, "message": {"role": "user",
        "content": "The indexer has three stages."}}),
    );
    t.user(json!({"origin": {"kind": "task-notification"}, "turnOrigin": "task_notification",
        "message": {"role": "user", "content": task_notification("a1", "toolu_ag1", "completed", Some(180))}}));
    t.call(
        "msg_m4",
        OPUS,
        vec![text("Deployed; the indexer has three stages.")],
        u,
        "end_turn",
    );
    t.system(
        "turn_duration",
        json!({"durationMs": 30000, "messageCount": 20}),
    );
    if idle_wake {
        t.user(json!({"origin": {"kind": "task-notification"}, "turnOrigin": "task_notification",
            "message": {"role": "user", "content": task_notification("shell2", "toolu_b2", "completed", None)}}));
        t.call(
            "msg_m5",
            OPUS,
            vec![text("The second build finished.")],
            u,
            "end_turn",
        );
    }

    let mut a1 = Transcript::subagent("a1", 1);
    a1.prompt("Map it.");
    a1.call(
        "msg_c1",
        OPUS,
        vec![text("The indexer has three stages.")],
        Usage::new(2, 50, 0, 5),
        "end_turn",
    );
    let agents = [Subagent {
        agent_id: "a1",
        transcript: &a1,
        meta: Some(subagent_meta("toolu_ag1", "general-purpose", 1)),
    }];
    write_session(&t, &agents)
}

/// Two parallel subagents (A, B) and one nested in A (C). B has no
/// `meta.json` and is linked through its `Agent` result. D is referenced by
/// nothing (an orphan). A's completion is duplicated across a `user` record,
/// a `queue-operation` and an `attachment:queued_command`.
///
/// Main calls: p1 (1, 10, 0, 1), p2 (1, 10, 0, 1). Subagent calls:
/// A (2, 20, 0, 2) + A2 (2, 20, 0, 2), B (3, 30, 0, 3), C (4, 40, 0, 4), D (5, 50, 0, 5).
pub fn subagents() -> SessionFiles {
    let mut t = Transcript::main();
    t.prompt("Map the indexer and the exporter.");
    let agent = |description: &str| json!({"subagent_type": "Explore", "description": description, "prompt": description});
    t.call(
        "msg_p1",
        OPUS,
        vec![
            tool_use("toolu_A", "Agent", agent("indexer")),
            tool_use("toolu_B", "Agent", agent("exporter")),
        ],
        Usage::new(1, 10, 0, 1),
        "tool_use",
    );
    for (tool, agent_id) in [("toolu_A", "agentA"), ("toolu_B", "agentB")] {
        t.tool_result(
            tool,
            json!("Async agent launched successfully."),
            json!({"status": "async_launched", "isAsync": true, "agentId": agent_id}),
            false,
        );
    }
    let note_a = task_notification("agentA", "toolu_A", "completed", Some(700));
    t.bookkeeping(json!({"type": "queue-operation", "operation": "enqueue", "content": note_a}));
    t.record(
        "attachment",
        json!({"attachment": {"type": "queued_command", "prompt": note_a}}),
    );
    t.user(json!({"origin": {"kind": "task-notification"}, "message": {"role": "user", "content": note_a}}));
    let note_b = task_notification("agentB", "toolu_B", "completed", Some(300));
    t.user(json!({"origin": {"kind": "task-notification"}, "message": {"role": "user", "content": note_b}}));
    t.call(
        "msg_p2",
        OPUS,
        vec![text("Both maps are ready.")],
        Usage::new(1, 10, 0, 1),
        "end_turn",
    );

    let mut a = Transcript::subagent("agentA", 1);
    a.prompt("indexer");
    a.call(
        "msg_A1",
        OPUS,
        vec![tool_use("toolu_C", "Agent", agent("indexer tests"))],
        Usage::new(2, 20, 0, 2),
        "tool_use",
    );
    a.tool_result(
        "toolu_C",
        json!("Async agent launched successfully."),
        json!({"status": "async_launched", "isAsync": true, "agentId": "agentC"}),
        false,
    );
    a.call(
        "msg_A2",
        OPUS,
        vec![text("Indexer mapped.")],
        Usage::new(2, 20, 0, 2),
        "end_turn",
    );
    let mut b = Transcript::subagent("agentB", 2);
    b.prompt("exporter");
    b.call(
        "msg_B1",
        OPUS,
        vec![text("Exporter mapped.")],
        Usage::new(3, 30, 0, 3),
        "end_turn",
    );
    let mut c = Transcript::subagent("agentC", 3);
    c.prompt("indexer tests");
    c.call(
        "msg_C1",
        HAIKU,
        vec![text("Tests mapped.")],
        Usage::new(4, 40, 0, 4),
        "end_turn",
    );
    let mut d = Transcript::subagent("agentD", 4);
    d.prompt("stray");
    d.call(
        "msg_D1",
        OPUS,
        vec![text("Stray agent.")],
        Usage::new(5, 50, 0, 5),
        "end_turn",
    );
    let agents = [
        Subagent {
            agent_id: "agentA",
            transcript: &a,
            meta: Some(subagent_meta("toolu_A", "Explore", 1)),
        },
        Subagent {
            agent_id: "agentB",
            transcript: &b,
            meta: None,
        },
        Subagent {
            agent_id: "agentC",
            transcript: &c,
            meta: Some(subagent_meta("toolu_C", "Explore", 2)),
        },
        Subagent {
            agent_id: "agentD",
            transcript: &d,
            meta: None,
        },
    ];
    write_session(&t, &agents)
}
