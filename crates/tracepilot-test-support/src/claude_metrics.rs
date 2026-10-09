//! C5 accounting fixtures. Kept apart from WP9's tool/renderer fixtures.
//! Numbers are synthetic; expected inclusive totals are computed in the tests.

use serde_json::json;

use crate::claude::{
    HAIKU, OPUS, SessionFiles, Subagent, Transcript, Usage, subagent_meta, text, thinking,
    tool_use, write_session,
};

/// Covered main (1,10,100,2) + child (3,30,300,4), side (5,50,500,6).
/// Optional tail: main (7,70,700,8) + new child (9,90,900,10).
/// Duplicate blocks and exit snapshots must never multiply these values.
pub fn snapshot_and_tail(tail: bool) -> SessionFiles {
    let mut t = Transcript::main();
    t.prompt("First human prompt.");
    t.call(
        "main_before",
        OPUS,
        vec![
            thinking("Plan."),
            tool_use("before", "Agent", json!({"prompt":"Inspect."})),
        ],
        Usage::new(1, 10, 100, 2),
        "tool_use",
    );
    let mut before = Transcript::subagent("before", 1);
    // Wall-clock order cannot replace the launching tool_use's file position.
    before.at(100);
    before.prompt("Inspect.");
    before.call(
        "child_before",
        OPUS,
        vec![text("Done.")],
        Usage::new(3, 30, 300, 4),
        "end_turn",
    );
    t.tool_result("before", json!("Done."), json!({"agentId":"before"}), false);
    let snapshot = json!({"type":"cost-state", "totalCostUSD": 1.25,
    "totalAPIDuration":1000, "totalAPIDurationWithoutRetries":900,
    "totalToolDuration":800, "totalDuration":2000, "startTime":1790000000000_u64,
    "totalLinesAdded":12, "totalLinesRemoved":3,
    "modelUsage":{
        OPUS: {"inputTokens":4,"cacheReadInputTokens":40,
            "cacheCreationInputTokens":400,"outputTokens":6,"thinkingTokens":2},
        HAIKU: {"inputTokens":5,"cacheReadInputTokens":50,
            "cacheCreationInputTokens":500,"outputTokens":6}
    }});
    t.bookkeeping(snapshot.clone());
    // The second copy has newer durations, but the same cumulative tokens/cost.
    let mut duplicate = snapshot;
    duplicate["totalDuration"] = json!(2100);
    t.bookkeeping(duplicate);
    let mut after = Transcript::subagent("after", 2);
    if tail {
        t.prompt("Resume.");
        t.call(
            "main_after",
            OPUS,
            vec![
                thinking("Resume."),
                tool_use("after", "Agent", json!({"prompt":"Check."})),
            ],
            Usage::new(7, 70, 700, 8),
            "tool_use",
        );
        after.prompt("Check.");
        after.call(
            "child_after",
            OPUS,
            vec![text("Checked.")],
            Usage::new(9, 90, 900, 10),
            "end_turn",
        );
    }
    let mut children = vec![Subagent {
        agent_id: "before",
        transcript: &before,
        meta: Some(subagent_meta("before", "general-purpose", 1)),
    }];
    if tail {
        children.push(Subagent {
            agent_id: "after",
            transcript: &after,
            meta: Some(subagent_meta("after", "general-purpose", 1)),
        });
    }
    write_session(&t, &children)
}

/// No snapshot: repeated blocks for one call, an unlinked child and no cost.
pub fn recorded_only() -> SessionFiles {
    let mut t = Transcript::main();
    t.prompt("Record only.");
    t.call(
        "single",
        OPUS,
        vec![thinking("Plan."), text("Done.")],
        Usage {
            input: 2,
            cache_read: 20,
            cache_write_5m: 3,
            cache_write_1h: 7,
            output: 4,
            thinking: 1,
        },
        "end_turn",
    );
    let mut orphan = Transcript::subagent("orphan", 3);
    orphan.prompt("Check.");
    orphan.call(
        "orphan",
        HAIKU,
        vec![text("Done.")],
        Usage::new(5, 50, 0, 6),
        "end_turn",
    );
    write_session(
        &t,
        &[Subagent {
            agent_id: "orphan",
            transcript: &orphan,
            meta: None,
        }],
    )
}

/// A successful edit remains a code change after its conversation is rewound.
pub fn rewound_edit() -> SessionFiles {
    let mut t = Transcript::main();
    let usage = Usage::new(1, 0, 0, 1);
    t.prompt("Start.");
    t.call("first", OPUS, vec![text("Ready.")], usage, "end_turn");
    let fork = t.last_uuid();
    t.prompt("Edit a file.");
    t.call(
        "edit",
        OPUS,
        vec![tool_use(
            "edit",
            "Edit",
            json!({"file_path":"src/rewound.rs"}),
        )],
        usage,
        "tool_use",
    );
    t.tool_result(
        "edit",
        json!("Edited."),
        json!({"filePath":"src/rewound.rs"}),
        false,
    );
    t.parent_next(fork.as_deref());
    t.prompt("Replace the conversation.");
    t.call("replacement", OPUS, vec![text("Done.")], usage, "end_turn");
    write_session(&t, &[])
}

/// A plan's recorded filePath identifies a reference, not a file mutation.
pub fn existing_plan() -> SessionFiles {
    let mut t = Transcript::main();
    t.prompt("Use the existing plan.");
    t.call(
        "plan",
        OPUS,
        vec![tool_use("plan", "ExitPlanMode", json!({}))],
        Usage::new(1, 0, 0, 1),
        "tool_use",
    );
    t.tool_result(
        "plan",
        json!("Approved."),
        json!({"filePath":"plans/existing.md","plan":"Existing plan."}),
        false,
    );
    write_session(&t, &[])
}

/// One run per day: day 1 (main + side model), resumed on day 2, and an
/// optional unsnapshotted tail on day 3. Each exit writes an identical pair.
pub fn resumed_across_days(tail: bool) -> SessionFiles {
    let mut t = Transcript::main();
    t.prompt("Start.");
    t.call(
        "first",
        OPUS,
        vec![text("Ready.")],
        Usage::new(1, 10, 100, 2),
        "end_turn",
    );
    let side = Usage::new(5, 50, 0, 6);
    for _ in 0..2 {
        t.cost_state(&[(OPUS, Usage::new(1, 10, 100, 2), 0.4), (HAIKU, side, 0.1)]);
    }
    t.idle(86_400);
    t.prompt("Resume.");
    t.call(
        "second",
        OPUS,
        vec![text("Resumed.")],
        Usage::new(7, 70, 700, 8),
        "end_turn",
    );
    for _ in 0..2 {
        t.cost_state(&[(OPUS, Usage::new(8, 80, 800, 10), 1.15), (HAIKU, side, 0.1)]);
    }
    if tail {
        t.idle(86_400);
        t.prompt("Continue.");
        t.call(
            "third",
            OPUS,
            vec![text("Continued.")],
            Usage::new(9, 90, 900, 10),
            "end_turn",
        );
    }
    write_session(&t, &[])
}
