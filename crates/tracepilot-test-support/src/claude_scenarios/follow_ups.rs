//! Background agents that receive `SendMessage` follow-ups, in the order an
//! orchestrating session writes them.

use serde_json::json;

use crate::claude::{
    OPUS, SessionFiles, Subagent, Transcript, Usage, subagent_meta, text, tool_use, write_session,
};

/// A completed agent's `<task-notification>`. A resumed agent's names the
/// `SendMessage` call that resumed it as its `tool-use-id`.
fn completion(task: &str, tool: &str, result: &str, tokens: u64) -> String {
    format!(
        "<task-notification>\n<task-id>{task}</task-id>\n<tool-use-id>{tool}</tool-use-id>\n\
         <status>completed</status>\n<summary>Agent \"review\" finished</summary>\n\
         <result>{result}</result>\n<usage><subagent_tokens>{tokens}</subagent_tokens>\
         <tool_uses>4</tool_uses><duration_ms>20000</duration_ms></usage>\n</task-notification>"
    )
}

/// R is a background reviewer. It completes (a queued notification, a
/// hand-back, then the attachment and queue removal repeating the
/// notification), is resumed by a `SendMessage` (`resumedAgentId`), and
/// completes again with new totals. One carrier of its first completion
/// arrives only after the resume, and its second completion also comes as
/// the `user` record that wakes the idle session.
///
/// W gets a `SendMessage` while it is still running (no `resumedAgentId`),
/// sends a mid-run peer message that is not a hand-back, and completes once.
pub fn agent_follow_ups() -> SessionFiles {
    let mut t = Transcript::main();
    t.prompt("Review the change and write the docs.");
    let u = Usage::new(1, 10, 0, 1);
    let agent = |description: &str| {
        json!({"subagent_type": "general-purpose", "description": description,
            "prompt": description, "run_in_background": true})
    };
    t.call(
        "msg_o1",
        OPUS,
        vec![
            tool_use("toolu_R", "Agent", agent("review")),
            tool_use("toolu_W", "Agent", agent("docs")),
        ],
        u,
        "tool_use",
    );
    for (tool, agent_id) in [("toolu_R", "agentR"), ("toolu_W", "agentW")] {
        t.tool_result(
            tool,
            json!("Async agent launched successfully."),
            json!({"status": "async_launched", "isAsync": true, "agentId": agent_id}),
            false,
        );
    }
    let send = |t: &mut Transcript, message: &str, tool: &str, to: &str, resumed: bool| {
        t.call(
            message,
            OPUS,
            vec![tool_use(
                tool,
                "SendMessage",
                json!({"to": to, "message": "Go on.", "summary": "Go on"}),
            )],
            u,
            "tool_use",
        );
        let mut result = json!({"success": true, "message": "Message sent.", "pin": false});
        if resumed {
            result["resumedAgentId"] = json!(to);
        }
        t.tool_result(tool, json!("Message sent."), result, false);
    };
    send(&mut t, "msg_o2", "toolu_S1", "agentW", false);
    t.call(
        "msg_o3",
        OPUS,
        vec![text("Both agents are working.")],
        u,
        "end_turn",
    );

    let peer = |from: &str, body: &str, handback: bool| {
        let mut origin = json!({"kind": "peer", "from": from, "name": from, "body": body});
        if handback {
            origin["handback"] = json!(true);
        }
        json!({"isMeta": true, "origin": origin, "message": {"role": "user", "content": body}})
    };
    t.user(peer("agentW", "Halfway through the docs.", false));
    let first = completion("agentR", "toolu_R", "Found two issues.", 500);
    t.bookkeeping(json!({"type": "queue-operation", "operation": "enqueue", "content": first}));
    t.user(peer("agentR", "Found two issues.", true));
    t.record(
        "attachment",
        json!({"attachment": {"type": "queued_command", "prompt": first}}),
    );
    t.call(
        "msg_o4",
        OPUS,
        vec![text("The reviewer found two issues.")],
        u,
        "end_turn",
    );
    send(&mut t, "msg_o5", "toolu_S2", "agentR", true);
    // The first completion's last carrier, written after the resume.
    t.bookkeeping(json!({"type": "queue-operation", "operation": "remove", "content": first}));
    t.call(
        "msg_o6",
        OPUS,
        vec![text("Waiting for the fixes.")],
        u,
        "end_turn",
    );

    let second = completion("agentR", "toolu_S2", "Both issues are fixed.", 900);
    t.bookkeeping(json!({"type": "queue-operation", "operation": "enqueue", "content": second}));
    t.user(
        json!({"origin": {"kind": "task-notification"}, "turnOrigin": "task_notification",
        "message": {"role": "user", "content": second}}),
    );
    t.user(peer("agentR", "Both issues are fixed.", true));
    let docs = completion("agentW", "toolu_W", "Docs written.", 300);
    t.bookkeeping(json!({"type": "queue-operation", "operation": "enqueue", "content": docs}));
    t.user(peer("agentW", "Docs written.", true));
    t.record(
        "attachment",
        json!({"attachment": {"type": "queued_command", "prompt": docs}}),
    );
    t.call(
        "msg_o7",
        OPUS,
        vec![text("The issues are fixed and the docs are written.")],
        u,
        "end_turn",
    );

    let mut r = Transcript::subagent("agentR", 1);
    r.prompt("review");
    r.call(
        "msg_R1",
        OPUS,
        vec![text("Found two issues.")],
        Usage::new(2, 20, 0, 2),
        "end_turn",
    );
    r.meta("Go on.", Some(json!({"kind": "coordinator"})));
    r.call(
        "msg_R2",
        OPUS,
        vec![text("Both issues are fixed.")],
        Usage::new(2, 20, 0, 2),
        "end_turn",
    );
    let mut w = Transcript::subagent("agentW", 2);
    w.prompt("docs");
    w.meta("Go on.", Some(json!({"kind": "coordinator"})));
    w.call(
        "msg_W1",
        OPUS,
        vec![text("Docs written.")],
        Usage::new(3, 30, 0, 3),
        "end_turn",
    );
    let agents = [
        Subagent {
            agent_id: "agentR",
            transcript: &r,
            meta: Some(subagent_meta("toolu_R", "general-purpose", 1)),
        },
        Subagent {
            agent_id: "agentW",
            transcript: &w,
            meta: Some(subagent_meta("toolu_W", "general-purpose", 1)),
        },
    ];
    write_session(&t, &agents)
}
