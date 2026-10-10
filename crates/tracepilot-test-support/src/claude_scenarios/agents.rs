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

/// Foreground `Agent` calls, whose result comes back when the agent is done
/// and is never followed by a hand-back or notification:
/// - F has no transcript and a result that only says `completed` (the
///   renderer gallery's shape), 30 s after the call;
/// - G has a transcript and the totals of a synchronous result;
/// - H has a transcript and fails;
/// - I is an asynchronous launch that nothing has closed yet.
pub fn foreground_agents() -> SessionFiles {
    let mut t = Transcript::main();
    t.prompt("Check the flag, map the exporter and check the build.");
    let u = Usage::new(1, 10, 0, 1);
    let agent = |description: &str| json!({"subagent_type": "Explore", "description": description, "prompt": description});
    let launch = |t: &mut Transcript, message: &str, tool: &str, description: &str| {
        t.call(
            message,
            OPUS,
            vec![tool_use(tool, "Agent", agent(description))],
            u,
            "tool_use",
        );
    };
    launch(&mut t, "msg_f1", "toolu_F", "flag");
    t.idle(30);
    t.tool_result(
        "toolu_F",
        json!("The flag is ready."),
        json!({"status": "completed"}),
        false,
    );
    launch(&mut t, "msg_f2", "toolu_G", "exporter");
    t.tool_result(
        "toolu_G",
        json!([{"type": "text", "text": "Exporter mapped."}]),
        json!({"status": "completed", "agentId": "agentG", "prompt": "exporter",
            "content": [{"type": "text", "text": "Exporter mapped."}],
            "totalDurationMs": 61_000, "totalTokens": 900, "totalToolUseCount": 2}),
        false,
    );
    launch(&mut t, "msg_f3", "toolu_H", "build");
    t.tool_result(
        "toolu_H",
        json!("Agent failed: the build tool is unavailable."),
        json!("Error: Agent failed: the build tool is unavailable."),
        true,
    );
    launch(&mut t, "msg_f4", "toolu_I", "tests");
    t.tool_result(
        "toolu_I",
        json!("Async agent launched successfully."),
        json!({"status": "async_launched", "isAsync": true, "agentId": "agentI"}),
        false,
    );
    t.call(
        "msg_f5",
        OPUS,
        vec![text(
            "The flag is ready and the exporter is mapped; the build check failed.",
        )],
        u,
        "end_turn",
    );

    let mut g = Transcript::subagent("agentG", 1);
    g.prompt("exporter");
    g.call(
        "msg_G1",
        OPUS,
        vec![text("Exporter mapped.")],
        Usage::new(2, 20, 0, 2),
        "end_turn",
    );
    let mut h = Transcript::subagent("agentH", 2);
    h.prompt("build");
    h.call(
        "msg_H1",
        OPUS,
        vec![text("Checking the build.")],
        Usage::new(3, 30, 0, 3),
        None,
    );
    let agents = [
        Subagent {
            agent_id: "agentG",
            transcript: &g,
            meta: Some(subagent_meta("toolu_G", "Explore", 1)),
        },
        Subagent {
            agent_id: "agentH",
            transcript: &h,
            meta: Some(subagent_meta("toolu_H", "Explore", 1)),
        },
    ];
    write_session(&t, &agents)
}

/// Background work that finishes while the session is idle. An agent and a
/// background shell start together and the model ends its turn; both
/// completions are queued, then delivered in one `user` record that wakes
/// the session (the agent's with its report and totals, the shell's with its
/// exit code). A second shell finishes while the model is still busy, which
/// opens no turn.
pub fn notification_wake() -> SessionFiles {
    let mut t = Transcript::main();
    t.prompt("Build the demo and map the indexer.");
    let u = Usage::new(1, 100, 0, 10);
    let build = json!({"command": "npm run build", "run_in_background": true});
    t.call(
        "msg_w1",
        OPUS,
        vec![
            tool_use("toolu_sh1", "Bash", build.clone()),
            tool_use(
                "toolu_ag1",
                "Agent",
                json!({"subagent_type": "Explore", "description": "Map the indexer",
                    "prompt": "Map it."}),
            ),
        ],
        u,
        "tool_use",
    );
    let started = |id: &str| {
        json!({"stdout": "", "stderr": "", "interrupted": false, "isImage": false,
            "backgroundTaskId": id})
    };
    t.tool_result(
        "toolu_sh1",
        json!("Command running in background with ID: bsh1"),
        started("bsh1"),
        false,
    );
    t.tool_result("toolu_ag1", json!("Async agent launched successfully."),
        json!({"status": "async_launched", "isAsync": true, "agentId": "a1", "description": "Map the indexer"}), false);
    t.call(
        "msg_w2",
        OPUS,
        vec![text("Both are running.")],
        u,
        "end_turn",
    );

    let agent = "<task-notification>\n<task-id>a1</task-id>\n<tool-use-id>toolu_ag1</tool-use-id>\n\
        <output-file>C:\\tmp\\tasks\\a1.output</output-file>\n<status>completed</status>\n\
        <summary>Agent \"Map the indexer\" finished</summary>\n\
        <result>The indexer has **three** stages.</result>\n\
        <usage><subagent_tokens>180000</subagent_tokens><tool_uses>40</tool_uses>\
        <duration_ms>600000</duration_ms></usage>\n</task-notification>";
    let shell = "<task-notification>\n<task-id>bsh1</task-id>\n<tool-use-id>toolu_sh1</tool-use-id>\n\
        <output-file>C:\\tmp\\tasks\\bsh1.output</output-file>\n<status>failed</status>\n\
        <summary>Background command \"npm run build\" failed with exit code 2</summary>\n\
        </task-notification>";
    for note in [agent, shell] {
        t.bookkeeping(json!({"type": "queue-operation", "operation": "enqueue", "content": note}));
    }
    t.user(
        json!({"origin": {"kind": "task-notification"}, "turnOrigin": "task_notification",
        "message": {"role": "user", "content": format!("{agent}\n{shell}")}}),
    );
    t.call(
        "msg_w3",
        OPUS,
        vec![
            text("The map is ready; the build failed, so I'm rebuilding."),
            tool_use("toolu_sh2", "Bash", build),
        ],
        u,
        "tool_use",
    );
    t.tool_result(
        "toolu_sh2",
        json!("Command running in background with ID: bsh2"),
        started("bsh2"),
        false,
    );
    let busy = "<task-notification>\n<task-id>bsh2</task-id>\n<tool-use-id>toolu_sh2</tool-use-id>\n\
        <status>completed</status>\n\
        <summary>Background command \"npm run build\" completed (exit code 0)</summary>\n\
        </task-notification>";
    t.user(
        json!({"origin": {"kind": "task-notification"}, "turnOrigin": "task_notification",
        "message": {"role": "user", "content": busy}}),
    );
    t.call(
        "msg_w4",
        OPUS,
        vec![text("The rebuild passed.")],
        u,
        "end_turn",
    );
    write_session(&t, &[])
}
