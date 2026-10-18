//! A Claude Code 2.1.301+ session with request records, and the same
//! session without them.

use serde_json::json;

use crate::claude::{
    OPUS, SessionFiles, Subagent, Transcript, Usage, subagent_meta, text, tool_use, write_session,
};

/// Main shape hash of [`request_records`].
pub const MAIN_SHAPE: &str = "shape-main-1";
/// Subagent shape hash of [`request_records`].
pub const AGENT_SHAPE: &str = "shape-agent-1";

/// A prompt, a foreground `Explore` subagent and a final answer, with a
/// cost snapshot. With `with_requests`, Claude Code's request records
/// precede each call, in both files, and one follows the last call (a
/// request whose response never arrived). They are stamped at the
/// preceding record's time, so both variants have the same record times.
///
/// Calls: msg_q1 (2, 100, 50, 10), agent msg_q2 (1, 40, 0, 5), msg_q3
/// (3, 150, 0, 20).
pub fn request_records(with_requests: bool) -> SessionFiles {
    let mut t = Transcript::main();
    t.prompt("Map the exporter, then summarize it.");
    let tools = vec![
        json!({"name": "Agent", "description": "Launch a subagent.",
            "input_schema": {"type": "object", "properties": {"prompt": {"type": "string"}}, "required": ["prompt"]}}),
        json!({"name": "Read", "description": "Read a file.",
            "input_schema": {"type": "object", "properties": {"file_path": {"type": "string"}}}}),
    ];
    if with_requests {
        t.api_request_shape(
            MAIN_SHAPE,
            &[
                "You are a synthetic coding agent.",
                "Synthetic environment notes.",
            ],
            tools.clone(),
        );
        t.api_request_blob(
            "blob-1",
            "user",
            json!("<system-reminder>Synthetic CLAUDE.md text.</system-reminder>"),
        );
        t.api_request_blob(
            "blob-2",
            "user",
            json!("Map the exporter, then summarize it."),
        );
        t.api_request("req-1", None, MAIN_SHAPE, OPUS, &["blob-1", "blob-2"]);
    }
    t.call(
        "msg_q1",
        OPUS,
        vec![tool_use(
            "toolu_Q",
            "Agent",
            json!({"subagent_type": "Explore", "description": "exporter", "prompt": "Map the exporter."}),
        )],
        Usage::new(2, 100, 50, 10),
        "tool_use",
    );
    t.idle(20);
    t.tool_result(
        "toolu_Q",
        json!([{"type": "text", "text": "The exporter has two stages."}]),
        json!({"status": "completed", "agentId": "agentQ", "prompt": "Map the exporter.",
            "content": [{"type": "text", "text": "The exporter has two stages."}],
            "totalDurationMs": 18_000, "totalTokens": 46, "totalToolUseCount": 0}),
        false,
    );
    if with_requests {
        t.api_request_blob("blob-3", "user", json!("The exporter has two stages."));
        t.api_request("req-3", Some("req-1"), MAIN_SHAPE, OPUS, &["blob-3"]);
    }
    let q3 = Usage::new(3, 150, 0, 20);
    t.call(
        "msg_q3",
        OPUS,
        vec![text("The exporter has two stages.")],
        q3,
        "end_turn",
    );
    if with_requests {
        t.api_request("req-4", Some("req-3"), MAIN_SHAPE, OPUS, &[]);
    }
    t.cost_state_since(0, &[(OPUS, Usage::new(5, 250, 50, 30), 0.25)]);

    let mut q = Transcript::subagent("agentQ", 1);
    q.idle(2);
    q.prompt("Map the exporter.");
    if with_requests {
        q.api_request_shape(
            AGENT_SHAPE,
            &["You are a synthetic Explore agent."],
            tools[1..].to_vec(),
        );
        q.api_request("req-2", None, AGENT_SHAPE, OPUS, &["blob-q1"]);
    }
    q.call(
        "msg_q2",
        OPUS,
        vec![text("The exporter has two stages.")],
        Usage::new(1, 40, 0, 5),
        "end_turn",
    );
    write_session(
        &t,
        &[Subagent {
            agent_id: "agentQ",
            transcript: &q,
            meta: Some(subagent_meta("toolu_Q", "Explore", 1)),
        }],
    )
}
