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
