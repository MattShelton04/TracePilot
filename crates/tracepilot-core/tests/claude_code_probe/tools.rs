//! Tool normalization census (mapping.md §2, C4): calls by canonical kind and
//! native name, the natives that fall back to their own name, and how often
//! each result reshape found its structured input. Counts only; tool names
//! are printed only when they look like plain identifiers, and MCP tools are
//! grouped so server names never print.

use std::collections::BTreeMap;

use serde_json::Value;
use tracepilot_core::models::ConversationTurn;
use tracepilot_core::provider::claude_code::ClaudeParse;

#[derive(Default)]
pub struct ToolCensus {
    /// (canonical, native) → [calls, succeeded, failed, pending].
    kinds: BTreeMap<(String, String), [usize; 4]>,
    shapes: BTreeMap<&'static str, usize>,
    task_types: BTreeMap<String, usize>,
}

/// A printable tool name: MCP tools grouped, anything unusual hidden.
fn label(name: &str) -> String {
    if name.starts_with("mcp__") {
        return "mcp__*".into();
    }
    let plain = name.len() <= 40
        && name.chars().next().is_some_and(|c| c.is_ascii_alphabetic())
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if plain { name.into() } else { "(other)".into() }
}

impl ToolCensus {
    pub fn add(&mut self, parsed: &ClaudeParse, turns: &[ConversationTurn]) {
        for tc in turns.iter().flat_map(|t| &t.tool_calls) {
            let native = tc.native_tool_name.as_deref().unwrap_or("(none)");
            let key = (label(&tc.tool_name), label(native));
            let row = self.kinds.entry(key).or_default();
            row[0] += 1;
            match (tc.is_complete, tc.success) {
                (true, Some(false)) => row[2] += 1,
                (true, _) => row[1] += 1,
                (false, _) => row[3] += 1,
            }
            let content = tc.result_content.as_deref().unwrap_or("");
            match tc.tool_name.as_str() {
                "shell" | "powershell" if tc.is_complete => bump(
                    &mut self.shapes,
                    match (tc.exit_code, tc.success) {
                        (Some(_), _) => "shell: exit code known",
                        (None, Some(false)) => "shell: exit code unknown (failed, no exit line)",
                        (None, _) => "shell: exit code unknown (background/interrupt/timeout)",
                    },
                ),
                "view" if tc.success == Some(true) => bump(
                    &mut self.shapes,
                    if content.starts_with("[image: ") {
                        "view: image placeholder"
                    } else if numbered(content) {
                        "view: numbered from file.content"
                    } else {
                        "view: text fallback"
                    },
                ),
                "web_search" if tc.success == Some(true) => {
                    let annotated = serde_json::from_str::<Value>(content).is_ok_and(|body| {
                        body.pointer("/text/annotations")
                            .and_then(Value::as_array)
                            .is_some_and(|a| !a.is_empty())
                    });
                    bump(
                        &mut self.shapes,
                        if annotated {
                            "web_search: with citations"
                        } else {
                            "web_search: no citations"
                        },
                    );
                }
                "ask_user" if tc.success == Some(true) => {
                    let answered = serde_json::from_str::<Value>(content)
                        .is_ok_and(|v| v.as_object().is_some_and(|o| !o.is_empty()));
                    bump(
                        &mut self.shapes,
                        if answered {
                            "ask_user: answers keyed"
                        } else {
                            "ask_user: text fallback"
                        },
                    );
                }
                _ => {}
            }
        }
        for event in &parsed.events {
            let data = &event.raw.data;
            if event.raw.event_type == "tool.execution_complete" {
                if data
                    .pointer("/result/persistedOutputPath")
                    .is_some_and(Value::is_string)
                {
                    bump(&mut self.shapes, "shell: persisted output path recorded");
                }
                if data.pointer("/result/detailedContent").is_some() {
                    bump(&mut self.shapes, "edit: structuredPatch hunks");
                }
                let native = event.raw.native.as_ref().map(|n| &n.data);
                if native
                    .and_then(|n| n.pointer("/toolUseResult/file/content"))
                    .and_then(Value::as_str)
                    == Some("")
                {
                    bump(&mut self.shapes, "view: empty file (text kept)");
                }
                let results = native
                    .and_then(|n| n.pointer("/message/content"))
                    .and_then(Value::as_array)
                    .map_or(0, |blocks| {
                        blocks.iter().filter(|b| b["type"] == "tool_result").count()
                    });
                if let Some(tur) = native
                    .and_then(|n| n.get("toolUseResult"))
                    .filter(|tur| tur.get("stdout").is_some())
                {
                    let set = |key: &str| tur.get(key).is_some_and(|v| !v.is_null() && v != false);
                    for (key, reason) in [
                        ("backgroundTaskId", "shell result: background"),
                        ("interrupted", "shell result: interrupted"),
                        ("timedOutAfterMs", "shell result: timed out"),
                        (
                            "returnCodeInterpretation",
                            "shell result: interpreted exit code",
                        ),
                    ] {
                        if set(key) {
                            bump(&mut self.shapes, reason);
                        }
                    }
                }
                if results > 1 {
                    bump(
                        &mut self.shapes,
                        "results sharing one toolUseResult (text kept)",
                    );
                }
                if let Some(kind) = native
                    .and_then(|n| n.pointer("/toolUseResult/task_type"))
                    .and_then(Value::as_str)
                {
                    *self.task_types.entry(label(kind)).or_default() += 1;
                }
                if native
                    .and_then(|n| n.pointer("/toolUseResult/isImage"))
                    .and_then(Value::as_bool)
                    == Some(true)
                {
                    bump(&mut self.shapes, "shell: image output");
                }
            }
        }
    }

    pub fn print(&self) {
        println!("\n### Tool normalization (C4)\n");
        println!("| Canonical | Native | Calls | OK | Failed | Pending |");
        println!("| --- | --- | ---: | ---: | ---: | ---: |");
        for ((canonical, native), [calls, ok, failed, pending]) in &self.kinds {
            println!("| {canonical} | {native} | {calls} | {ok} | {failed} | {pending} |");
        }
        let fallback: usize = self
            .kinds
            .iter()
            .filter(|((canonical, native), _)| canonical == native)
            .map(|(_, row)| row[0])
            .sum();
        let total: usize = self.kinds.values().map(|row| row[0]).sum();
        println!("\n- Native fallback (canonical = native): {fallback} of {total} calls");
        for (key, n) in &self.shapes {
            println!("- {key}: {n}");
        }
        println!("- TaskStop task types: {:?}", self.task_types);
    }
}

fn bump(shapes: &mut BTreeMap<&'static str, usize>, key: &'static str) {
    *shapes.entry(key).or_default() += 1;
}

fn numbered(content: &str) -> bool {
    let mut lines = content.lines();
    lines.next().is_some_and(|first| {
        first
            .split_once(". ")
            .is_some_and(|(n, _)| n.parse::<u64>().is_ok())
    })
}
