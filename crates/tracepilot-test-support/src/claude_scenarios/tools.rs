//! One call per tool family, covering every mapping.md §2 row with the
//! `toolUseResult` shapes in record-shapes.md: success, error and the
//! polymorphic variants (interpreted exit codes, background shells, image
//! output, create vs overwrite, shell vs agent stops).

use serde_json::{Value, json};

use super::IMAGE_BASE64;
use crate::claude::{OPUS, SessionFiles, Transcript, Usage, image, text, tool_use, write_session};

/// `(tool_use id, native name, input, result content, toolUseResult, is_error)`.
type Case = (&'static str, &'static str, Value, Value, Value, bool);

/// A persisted output path; the file does not exist and must never be read.
pub const PERSISTED_PATH: &str =
    "C:\\Users\\demo\\.claude\\projects\\C--work-demo\\s\\tool-results\\big.txt";

/// Every tool call has a result, so the session ends complete.
pub fn tool_catalog() -> SessionFiles {
    let mut t = Transcript::main();
    t.prompt("Exercise every tool.");
    let groups = [shells(), files(), search_and_ask(), control()];
    for (index, cases) in groups.into_iter().enumerate() {
        let blocks = cases
            .iter()
            .map(|(id, name, input, ..)| tool_use(id, name, input.clone()))
            .collect();
        let id = format!("msg_tools{index}");
        t.call(&id, OPUS, blocks, Usage::new(1, 10, 0, 5), "tool_use");
        for (id, _, _, content, tur, is_error) in cases {
            t.tool_result(id, content, tur, is_error);
        }
    }
    t.call(
        "msg_tools_done",
        OPUS,
        vec![text("Done.")],
        Usage::new(1, 10, 0, 5),
        "end_turn",
    );
    write_session(&t, &[])
}

fn shell_result(stdout: &str, extra: Value) -> Value {
    let mut tur = json!({"stdout": stdout, "stderr": "", "interrupted": false,
        "isImage": false, "noOutputExpected": false});
    if let (Some(tur), Value::Object(extra)) = (tur.as_object_mut(), extra) {
        tur.extend(extra);
    }
    tur
}

fn shells() -> Vec<Case> {
    let failed = "Error: Exit code 2\ncargo: no such command";
    vec![
        (
            "toolu_bash_ok",
            "Bash",
            json!({"command": "cargo test", "description": "Run tests", "timeout": 60000}),
            json!("test result: ok\nwarning: unused"),
            json!({"stdout": "test result: ok\n", "stderr": "warning: unused\n",
                "interrupted": false, "isImage": false, "noOutputExpected": false}),
            false,
        ),
        (
            "toolu_bash_nomatch",
            "Bash",
            json!({"command": "grep -c todo notes.txt"}),
            json!("No matches found"),
            shell_result(
                "0\n",
                json!({"returnCodeInterpretation": "No matches found"}),
            ),
            false,
        ),
        (
            "toolu_bash_fail",
            "Bash",
            json!({"command": "cargo nope"}),
            json!(failed),
            json!(failed),
            true,
        ),
        (
            "toolu_bash_bg",
            "Bash",
            json!({"command": "npm run dev", "run_in_background": true}),
            json!("Command running in background with ID: bg_1"),
            shell_result("", json!({"backgroundTaskId": "bg_1"})),
            false,
        ),
        (
            "toolu_bash_image",
            "Bash",
            json!({"command": "cat chart.png"}),
            json!([image(IMAGE_BASE64)]),
            shell_result(
                &format!("data:image/png;base64,{IMAGE_BASE64}"),
                json!({"isImage": true}),
            ),
            false,
        ),
        (
            "toolu_bash_big",
            "Bash",
            json!({"command": "cargo build -vv"}),
            json!(format!(
                "<persisted-output>\nOutput too large (41.5KB). Full output saved to: \
                 {PERSISTED_PATH}\n\nPreview (first 2KB):\nCompiling demo\n</persisted-output>"
            )),
            shell_result(
                "Compiling demo\nFinished\n",
                json!({"persistedOutputPath": PERSISTED_PATH, "persistedOutputSize": 42000}),
            ),
            false,
        ),
        (
            "toolu_ps",
            "PowerShell",
            json!({"command": "Get-Date", "description": "Show the date"}),
            json!("Monday"),
            json!({"stdout": "Monday\r\n", "stderr": "", "interrupted": false, "isImage": false}),
            false,
        ),
    ]
}

fn files() -> Vec<Case> {
    let patch = |old: &str, new: &str| {
        json!([{"oldStart": 3, "oldLines": 1, "newStart": 3, "newLines": 1,
            "lines": [format!("-{old}"), format!("+{new}")]}])
    };
    vec![
        (
            "toolu_read",
            "Read",
            json!({"file_path": "src/lib.rs", "offset": 10, "limit": 2}),
            json!(
                "    10\tfn a() {}\n    11\tfn b() {}\n\n<system-reminder>Reminder.</system-reminder>"
            ),
            json!({"type": "text", "file": {"filePath": "src/lib.rs",
                "content": "fn a() {}\nfn b() {}\n", "numLines": 2, "startLine": 10,
                "totalLines": 40}}),
            false,
        ),
        (
            "toolu_read_image",
            "Read",
            json!({"file_path": "shot.png"}),
            json!([image(IMAGE_BASE64)]),
            json!({"type": "image", "file": {"base64": IMAGE_BASE64, "type": "image/png",
                "originalSize": 2048, "dimensions": {"originalWidth": 640, "originalHeight": 480,
                "displayWidth": 640, "displayHeight": 480}}}),
            false,
        ),
        (
            "toolu_read_missing",
            "Read",
            json!({"file_path": "missing.rs"}),
            json!("File does not exist."),
            json!("Error: File does not exist."),
            true,
        ),
        (
            "toolu_edit",
            "Edit",
            json!({"file_path": "src/lib.rs", "old_string": "old()", "new_string": "new()"}),
            json!("The file src/lib.rs has been updated successfully."),
            json!({"filePath": "src/lib.rs", "oldString": "old()", "newString": "new()",
                "originalFile": "fn x() {}\n", "structuredPatch": patch("    old()", "    new()"),
                "userModified": false, "replaceAll": false}),
            false,
        ),
        (
            "toolu_write_new",
            "Write",
            json!({"file_path": "src/ready.rs", "content": "pub const READY: bool = true;\n"}),
            json!("File created successfully at: src/ready.rs"),
            json!({"type": "create", "filePath": "src/ready.rs",
                "content": "pub const READY: bool = true;\n", "structuredPatch": [],
                "originalFile": null}),
            false,
        ),
        (
            "toolu_write_over",
            "Write",
            json!({"file_path": "src/main.rs", "content": "fn main() {}\n"}),
            json!("The file src/main.rs has been updated."),
            json!({"type": "update", "filePath": "src/main.rs", "content": "fn main() {}\n",
                "structuredPatch": patch("fn main() { todo!() }", "fn main() {}"),
                "originalFile": "fn main() { todo!() }\n", "userModified": false}),
            false,
        ),
        (
            "toolu_multi",
            "MultiEdit",
            json!({"file_path": "src/a.rs", "edits": [{"old_string": "a", "new_string": "b"}]}),
            json!("Applied 1 edit to src/a.rs"),
            json!({"filePath": "src/a.rs", "edits": [{"old_string": "a", "new_string": "b"}],
                "structuredPatch": patch("a", "b"), "userModified": false}),
            false,
        ),
    ]
}

fn search_and_ask() -> Vec<Case> {
    let question = json!({"question": "Which viewport?", "header": "Viewport",
        "multiSelect": false, "options": [{"label": "Desktop", "description": "1440 × 960"},
        {"label": "Minimum", "description": "960 × 640"}]});
    vec![
        (
            "toolu_grep",
            "Grep",
            json!({"pattern": "fn", "path": "src", "output_mode": "content", "-n": true, "-i": true}),
            json!("src/lib.rs:10:fn a() {}"),
            json!({"mode": "content", "numFiles": 1, "filenames": [],
                "content": "src/lib.rs:10:fn a() {}", "numLines": 1}),
            false,
        ),
        (
            "toolu_glob",
            "Glob",
            json!({"pattern": "**/*.rs"}),
            json!("src/lib.rs\nsrc/main.rs"),
            json!({"filenames": ["src/lib.rs", "src/main.rs"], "numFiles": 2,
                "truncated": false, "durationMs": 3}),
            false,
        ),
        (
            "toolu_fetch",
            "WebFetch",
            json!({"url": "https://example.com/guide", "prompt": "Summarize"}),
            json!("The guide describes fixtures."),
            json!({"url": "https://example.com/guide", "code": 200, "codeText": "OK",
                "bytes": 1000, "result": "The guide describes fixtures.", "durationMs": 10}),
            false,
        ),
        (
            "toolu_search",
            "WebSearch",
            json!({"query": "synthetic cache"}),
            json!("Web search results for query: \"synthetic cache\"\n\nLinks: []"),
            json!({"query": "synthetic cache", "results": [
                {"tool_use_id": "srvtoolu_1", "content": [
                    {"title": "Cache guide", "url": "https://example.com/cache"}]},
                "Caches keep the whole response envelope."],
                "durationSeconds": 1.2, "searchCount": 1}),
            false,
        ),
        (
            "toolu_ask",
            "AskUserQuestion",
            json!({"questions": [question.clone()]}),
            json!("User has answered your questions: \"Which viewport?\"=\"Minimum\"."),
            json!({"questions": [question], "answers": {"Which viewport?": "Minimum"},
                "annotations": {}}),
            false,
        ),
    ]
}

fn control() -> Vec<Case> {
    vec![
        (
            "toolu_send",
            "SendMessage",
            json!({"to": "reviewer", "message": "Check wrapping."}),
            json!("Message sent to reviewer."),
            json!({"success": true}),
            false,
        ),
        (
            "toolu_stop_shell",
            "TaskStop",
            json!({"task_id": "bg_1"}),
            json!("{\"message\":\"Successfully stopped task: bg_1 (npm run dev)\"}"),
            json!({"message": "Successfully stopped task: bg_1 (npm run dev)",
                "task_id": "bg_1", "task_type": "local_bash", "command": "npm run dev"}),
            false,
        ),
        (
            "toolu_stop_agent",
            "TaskStop",
            json!({"task_id": "a77"}),
            json!("{\"message\":\"Successfully stopped task: a77\"}"),
            json!({"message": "Successfully stopped task: a77", "task_id": "a77",
                "task_type": "local_agent"}),
            false,
        ),
        (
            "toolu_kill",
            "KillShell",
            json!({"shell_id": "bg_2"}),
            json!("Shell bg_2 killed."),
            json!({"message": "Shell bg_2 killed.", "shell_id": "bg_2"}),
            false,
        ),
        (
            "toolu_mcp",
            "mcp__docs__search_pages",
            json!({"q": "cache"}),
            json!([{"type": "text", "text": "2 pages"}]),
            json!([{"type": "text", "text": "2 pages"}]),
            false,
        ),
        (
            "toolu_monitor",
            "Monitor",
            json!({"command": "tail -f log"}),
            json!("Monitoring started."),
            json!({"taskId": "m1"}),
            false,
        ),
        (
            "toolu_tool_search",
            "ToolSearch",
            json!({"query": "select:Read,mcp__docs__search_pages", "max_results": 5}),
            json!([{"type": "tool_reference", "tool_name": "Read"},
                {"type": "tool_reference", "tool_name": "mcp__docs__search_pages"}]),
            json!({"matches": ["Read", "mcp__docs__search_pages"],
                "query": "select:Read,mcp__docs__search_pages"}),
            false,
        ),
    ]
}
