//! Synthetic Claude Code sessions reproducing the hazards measured in real
//! transcripts (implementation-plan.md §5). Expected values live in the
//! tests that use them; usage numbers are chosen to be easy to sum by hand.

mod agents;
mod tools;

pub use agents::{meta_records, subagents};
pub use tools::{PERSISTED_PATH, tool_catalog};

use serde_json::json;

use crate::claude::{
    HAIKU, OPUS, SessionFiles, Transcript, Usage, image, text, thinking, tool_use, write_session,
};

/// Base64 the sanitizer must remove everywhere.
pub const IMAGE_BASE64: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk";

/// Tool hazards: per-block records with growing output, an empty thinking
/// block, a string `toolUseResult` on error, an out-of-order timestamp,
/// parallel tool calls, an image Read and a persisted output. Ends with an
/// identical `cost-state` pair that also counts a Haiku side model.
///
/// Calls: a1 (10, 1000, 200, 90), a2 (5, 1200, 0, 40), a3 (3, 1300, 50, 20).
pub fn tool_hazards() -> SessionFiles {
    let mut t = Transcript::main();
    t.prompt("Run the tests and look at the screenshot.");
    let a1 = Usage::new(10, 1000, 200, 90);
    t.call(
        "msg_a1",
        OPUS,
        vec![
            thinking(""),
            text("Running the tests."),
            tool_use("toolu_t1", "Bash", json!({"command": "npm test"})),
        ],
        a1,
        "tool_use",
    );
    let error = "Error: Exit code 1\nnpm ERR! test failed";
    t.tool_result("toolu_t1", json!(error), json!(error), true);
    t.at(1).record(
        "attachment",
        json!({"attachment": {"type": "edited_text_file", "filename": "src\\upload.ts"}}),
    );
    t.call(
        "msg_a2",
        OPUS,
        vec![
            tool_use(
                "toolu_t2",
                "Read",
                json!({"file_path": "C:\\work\\demo\\shot.png"}),
            ),
            tool_use("toolu_t3", "Bash", json!({"command": "npm run lint"})),
        ],
        Usage::new(5, 1200, 0, 40),
        "tool_use",
    );
    t.tool_result(
        "toolu_t2",
        json!([image(IMAGE_BASE64)]),
        json!({"type": "image", "file": {"base64": IMAGE_BASE64, "type": "image/png",
            "originalSize": 2048, "dimensions": {"originalWidth": 1, "originalHeight": 1}}}),
        false,
    );
    let persisted = "<persisted-output>\nOutput too large (41.5KB). Full output saved to: \
        C:\\Users\\demo\\.claude\\projects\\C--work-demo\\s\\tool-results\\abc123.txt\n\n\
        Preview (first 2KB):\nlint ok\n</persisted-output>";
    t.tool_result(
        "toolu_t3",
        json!(persisted),
        json!({"stdout": "lint ok", "stderr": "", "interrupted": false, "isImage": false,
            "persistedOutputPath": "C:\\Users\\demo\\.claude\\projects\\C--work-demo\\s\\tool-results\\abc123.txt",
            "persistedOutputSize": 42000}),
        false,
    );
    t.call(
        "msg_a3",
        OPUS,
        vec![text("The tests fail on the upload client; lint is clean.")],
        Usage::new(3, 1300, 50, 20),
        "end_turn",
    );
    t.system(
        "turn_duration",
        json!({"durationMs": 9000, "messageCount": 9}),
    );
    t.bookkeeping(json!({"type": "ai-title", "aiTitle": "Run the tests"}));
    let side = Usage::new(400, 0, 0, 30);
    let opus = Usage {
        input: 18,
        cache_read: 3500,
        cache_write_1h: 250,
        output: 150,
        ..Usage::default()
    };
    for _ in 0..2 {
        t.cost_state(&[(OPUS, opus, 1.25), (HAIKU, side, 0.01)]);
    }
    write_session(&t, &[])
}

/// A rewind: the second prompt and its call are abandoned when the user
/// edits that prompt, which forks from the end of the first exchange.
///
/// Calls: r1 (1, 0, 0, 10), r2 abandoned (2, 0, 0, 20), r3 (3, 0, 0, 30).
pub fn rewind_fork() -> SessionFiles {
    let mut t = Transcript::main();
    t.prompt("Write a haiku.");
    t.call(
        "msg_r1",
        OPUS,
        vec![text("Autumn wind...")],
        Usage::new(1, 0, 0, 10),
        "end_turn",
    );
    let fork = t.last_uuid();
    t.prompt("Make it about rain.");
    t.call(
        "msg_r2",
        OPUS,
        vec![text("Rain on the roof...")],
        Usage::new(2, 0, 0, 20),
        "end_turn",
    );
    t.parent_next(fork.as_deref());
    t.prompt("Make it about snow.");
    t.call(
        "msg_r3",
        OPUS,
        vec![text("Snow on the pines...")],
        Usage::new(3, 0, 0, 30),
        "end_turn",
    );
    write_session(&t, &[])
}

/// An interrupted call, a call whose tool result never arrives followed by
/// another prompt, and a live file that ends with a tool result pending.
pub fn interrupted_and_live() -> SessionFiles {
    let mut t = Transcript::main();
    let u = Usage::new(1, 0, 0, 1);
    t.prompt("Run the slow script.");
    t.call(
        "msg_i1",
        OPUS,
        vec![tool_use("toolu_i1", "Bash", json!({"command": "slow.sh"}))],
        u,
        "tool_use",
    );
    let refused = "The user doesn't want to proceed with this tool use.";
    t.user(json!({"message": {"role": "user", "content": [
        {"type": "tool_result", "tool_use_id": "toolu_i1", "is_error": true, "content": refused},
        {"type": "text", "text": "[Request interrupted by user for tool use]"}]},
        "toolUseResult": format!("Error: {refused}")}));
    t.prompt("Read the config instead.");
    t.call(
        "msg_i2",
        OPUS,
        vec![tool_use(
            "toolu_i2",
            "Read",
            json!({"file_path": "C:\\work\\demo\\a.json"}),
        )],
        u,
        "tool_use",
    );
    t.prompt("Never mind; list the files.");
    t.call(
        "msg_i3",
        OPUS,
        vec![
            text("Listing."),
            tool_use("toolu_i3", "Bash", json!({"command": "ls"})),
        ],
        u,
        "tool_use",
    );
    write_session(&t, &[])
}

/// A malformed middle line and a partial last line cut inside a UTF-8
/// sequence (`é` is `C3 A9`).
pub fn damaged_lines() -> SessionFiles {
    let mut t = Transcript::main();
    t.prompt("Hello.");
    t.raw_line("{\"type\":\"user\",\"message\":");
    t.call(
        "msg_d1",
        OPUS,
        vec![text("Hi.")],
        Usage::new(1, 0, 0, 1),
        "end_turn",
    );
    let mut tail = br#"{"type":"user","message":{"role":"user","content":"caf"#.to_vec();
    tail.push(0xC3);
    t.partial_tail(&tail);
    write_session(&t, &[])
}

/// Compaction whose logical parent is a record written after the boundary
/// (a `logicalParentUuid` cycle), then a synthetic 429.
pub fn compaction_cycle() -> SessionFiles {
    let mut t = Transcript::main();
    let u = Usage::new(1, 0, 0, 1);
    t.prompt("Refactor the parser.");
    t.call("msg_k1", OPUS, vec![text("Refactoring.")], u, "end_turn");
    let preserved = t.upcoming_uuid(2);
    let boundary = t.compact_boundary(&preserved, 200_000, 9_000);
    t.parent_next(Some(&boundary));
    t.user(json!({"isCompactSummary": true, "message": {"role": "user", "content": "Summary: refactoring."}}));
    t.prompt("Keep going.");
    t.record("assistant", json!({"isApiErrorMessage": true, "error": "rate_limit", "apiErrorStatus": 429,
        "message": {"id": "msg_err", "model": "<synthetic>", "role": "assistant", "stop_reason": "stop_sequence",
            "content": [text("You've hit your session limit · resets 8pm")],
            "usage": {"input_tokens": 0, "output_tokens": 0, "cache_read_input_tokens": 0,
                "cache_creation_input_tokens": 0}}}));
    write_session(&t, &[])
}

/// A session resumed once. Each exit writes an identical `cost-state` pair,
/// cumulative across the resume. With `still_running`, a third prompt after
/// the last pair is the uncovered tail.
///
/// Calls: e1 (10, 100, 20, 5), e2 (20, 200, 40, 7), e3 (30, 300, 60, 11).
/// Side model per snapshot: Haiku (50, 0, 0, 4) then (80, 0, 0, 6).
pub fn resumed(still_running: bool) -> SessionFiles {
    let mut t = Transcript::main();
    let e1 = Usage::new(10, 100, 20, 5);
    let e2 = Usage::new(20, 200, 40, 7);
    t.prompt("First.");
    t.call("msg_e1", OPUS, vec![text("One.")], e1, "end_turn");
    t.system("turn_duration", json!({"durationMs": 1000}));
    for _ in 0..2 {
        t.cost_state(&[(OPUS, e1, 0.10), (HAIKU, Usage::new(50, 0, 0, 4), 0.001)]);
    }
    t.prompt("Second.");
    t.call("msg_e2", OPUS, vec![text("Two.")], e2, "end_turn");
    t.system("turn_duration", json!({"durationMs": 1000}));
    let both = Usage::new(30, 300, 60, 12);
    for _ in 0..2 {
        t.cost_state(&[(OPUS, both, 0.30), (HAIKU, Usage::new(80, 0, 0, 6), 0.002)]);
    }
    if still_running {
        t.prompt("Third.");
        t.call(
            "msg_e3",
            OPUS,
            vec![text("Three.")],
            Usage::new(30, 300, 60, 11),
            "end_turn",
        );
    }
    write_session(&t, &[])
}

/// A `/compact` command (`<command-message>` before `<command-name>`), its
/// local output, the compaction, then a prompt.
pub fn slash_command() -> SessionFiles {
    let mut t = Transcript::main();
    t.prompt("Start.");
    t.call(
        "msg_s1",
        OPUS,
        vec![text("Started.")],
        Usage::new(1, 0, 0, 1),
        "end_turn",
    );
    let command = "<command-message>compact</command-message>
<command-name>/compact</command-name>";
    t.user(json!({"message": {"role": "user", "content": command}}));
    t.user(json!({"message": {"role": "user",
        "content": "<local-command-stdout>Compacted.</local-command-stdout>"}}));
    let before = t.last_uuid().unwrap_or_default();
    t.compact_boundary(&before, 50_000, 2_000);
    t.prompt("Continue.");
    t.call(
        "msg_s2",
        OPUS,
        vec![text("Continuing.")],
        Usage::new(1, 0, 0, 1),
        "end_turn",
    );
    write_session(&t, &[])
}

/// A typed `/compact` as Claude Code writes it: the typed text first (a
/// string body with only a `promptId`), then the manual compaction and its
/// summary, a meta record, and only then the `<command-name>` record for the
/// same prompt and its output. Then a prompt.
pub fn typed_compact() -> SessionFiles {
    let mut t = Transcript::main();
    let u = Usage::new(1, 0, 0, 1);
    t.prompt("Start.");
    t.call("msg_c1", OPUS, vec![text("Started.")], u, "end_turn");
    t.next_prompt_id();
    let typed = t.user(json!({"message": {"role": "user", "content": "/compact"}}));
    t.bookkeeping(json!({"type": "last-prompt", "lastPrompt": "/compact"}));
    t.compact_boundary_with(&typed, "manual", 80_000, 3_000);
    t.user(json!({"isCompactSummary": true,
        "message": {"role": "user", "content": "Summary: started."}}));
    t.meta(
        "Caveat: the messages below were generated by local commands.",
        None,
    );
    t.user(json!({"message": {"role": "user", "content":
        "<command-name>/compact</command-name>
<command-message>compact</command-message>
<command-args></command-args>"}}));
    t.user(json!({"message": {"role": "user",
        "content": "<local-command-stdout>Compacted.</local-command-stdout>"}}));
    t.prompt("Continue.");
    t.call("msg_c2", OPUS, vec![text("Continuing.")], u, "end_turn");
    write_session(&t, &[])
}
