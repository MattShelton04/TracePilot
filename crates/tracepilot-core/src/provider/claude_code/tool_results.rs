//! Tool normalization table, result half (mapping.md §2).
//!
//! `tool_result` blocks become `tool.execution_complete`. The text Claude
//! sent the model is the default content; where `toolUseResult` (TUR, the
//! structured result) has a better source, the content is rebuilt from it in
//! the shape the canonical renderer reads. A record's TUR is used only when
//! it carries a single `tool_result`, and only when it is an object: on an
//! error, TUR is the error string.
//!
//! Two tools are renamed here, by rewriting their start event before the
//! events are typed: `Write` over an existing file becomes `apply_patch`
//! (also `MultiEdit`), and `TaskStop` of a shell becomes `stop_powershell`.
//!
//! `persistedOutputPath` is recorded as a string; the file is never opened.

use serde_json::{Map, Value, json};

use super::records::{Blocks, Rec, block_type, tool_result_text};
use super::tools::{question_key, rename_keys};
use super::translate::{RecCtx, Stream, Translator};

/// `returnCodeInterpretation` explains a non-zero exit that is not an error
/// (`grep` without matches, `diff` with differences, `test` false). Claude
/// Code writes it only for exit code 1.
const INTERPRETED_EXIT_CODE: i64 = 1;

impl<F: Fn() -> bool> Translator<'_, F> {
    pub(super) fn tool_results(&mut self, st: &mut Stream<'_>, ctx: &mut RecCtx, rec: Rec<'_>) {
        let Blocks::Array(blocks) = rec.blocks() else {
            return;
        };
        let persisted = rec.ptr_str("/toolUseResult/persistedOutputPath").is_some();
        let results = blocks
            .iter()
            .filter(|b| block_type(b) == "tool_result")
            .count();
        let tur = rec.0.get("toolUseResult").filter(|_| results == 1);
        let mut interrupted = false;
        for block in blocks {
            match block_type(block) {
                "tool_result" => {
                    let id = block
                        .get("tool_use_id")
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    if let Some(call) = st.open_call.as_mut() {
                        call.pending.retain(|pending| pending != id);
                    }
                    let content = tool_result_text(block);
                    if persisted || content.contains("<persisted-output>") {
                        self.diagnostics.persisted_outputs += 1;
                    }
                    let failed = block.get("is_error").and_then(Value::as_bool) == Some(true);
                    let start = self.tool_starts.get(id).copied();
                    let outcome = {
                        let data = start
                            .and_then(|index| self.events.get(index))
                            .map(|e| &e.data);
                        let native = data
                            .and_then(|d| d.get("nativeToolName"))
                            .and_then(Value::as_str)
                            .unwrap_or("");
                        let args = data
                            .and_then(|d| d.get("arguments"))
                            .unwrap_or(&Value::Null);
                        reshape(native, args, tur, content, failed)
                    };
                    if let Some((name, arguments)) = outcome.restart
                        && let Some(event) = start.and_then(|index| self.events.get_mut(index))
                    {
                        event.data["toolName"] = json!(name);
                        event.data["arguments"] = arguments;
                    }
                    let data = json!({
                        "toolCallId": id,
                        "success": !failed,
                        "result": outcome.result,
                        "error": outcome.error,
                        "shellExecution": outcome.shell_execution,
                        "interactionId": st.interaction,
                        "parentToolCallId": st.owner_tool,
                    });
                    self.emit(st, ctx, "tool.execution_complete", data);
                }
                "text" => {
                    let text = block.get("text").and_then(Value::as_str).unwrap_or("");
                    interrupted |= text.starts_with("[Request interrupted by user");
                }
                _ => {}
            }
        }
        if interrupted {
            self.interrupt(st, ctx);
        }
    }
}

/// A reshaped result.
#[derive(Debug, Default)]
pub(super) struct Outcome {
    /// `{content, …}` on success.
    pub(super) result: Option<Value>,
    /// `{message}` on failure.
    pub(super) error: Option<Value>,
    /// `{exitCode}` for shells, when the exit code is known.
    pub(super) shell_execution: Option<Value>,
    /// The call's canonical name and arguments, when the result decides them.
    pub(super) restart: Option<(&'static str, Value)>,
}

impl Outcome {
    fn plain(text: String, failed: bool) -> Self {
        Self {
            result: (!failed).then(|| json!({"content": text})),
            error: failed.then(|| json!({"message": text})),
            ..Self::default()
        }
    }

    /// Replace the success content, plus extra fields; a no-op on failure.
    fn set(&mut self, key: &str, value: Value) {
        if let Some(Value::Object(result)) = self.result.as_mut() {
            result.insert(key.into(), value);
        }
    }
}

/// Reshape one result. `native` and `args` come from the call's start event
/// (empty and null when it has none); `text` is the `tool_result` text.
pub(super) fn reshape(
    native: &str,
    args: &Value,
    tur: Option<&Value>,
    text: String,
    failed: bool,
) -> Outcome {
    let structured = tur.filter(|tur| tur.is_object());
    let exit_code = matches!(native, "Bash" | "PowerShell").then(|| {
        if failed {
            failed_exit_code(&text)
        } else {
            structured.and_then(success_exit_code)
        }
    });
    let mut outcome = Outcome::plain(text, failed);
    outcome.shell_execution = exit_code.flatten().map(|code| json!({"exitCode": code}));
    let Some(tur) = structured.filter(|_| !failed) else {
        return outcome;
    };
    match native {
        "Bash" | "PowerShell" => shell(&mut outcome, tur),
        "Read" => {
            if let Some(content) = read_content(tur) {
                outcome.set("content", content.into());
            }
        }
        "Edit" => {
            if let Some(hunks) = hunks(tur) {
                outcome.set("detailedContent", hunks.into());
            }
        }
        "Write" | "MultiEdit" => {
            let update = native == "MultiEdit" || str_at(tur, "type") == Some("update");
            if update && let Some(hunks) = hunks(tur) {
                let path = str_at(tur, "filePath")
                    .or_else(|| str_at(args, "path"))
                    .or_else(|| str_at(args, "file_path"))
                    .unwrap_or_default();
                let patch =
                    format!("*** Begin Patch\n*** Update File: {path}\n{hunks}\n*** End Patch");
                outcome.restart = Some(("apply_patch", Value::String(patch)));
            }
        }
        "Glob" => {
            let names = strings(tur.get("filenames"));
            if !names.is_empty() {
                outcome.set("content", names.join("\n").into());
            }
        }
        "WebFetch" => {
            if let Some(result) = str_at(tur, "result") {
                outcome.set("content", result.into());
            }
        }
        "WebSearch" => outcome.set("content", web_search(tur).into()),
        "AskUserQuestion" => {
            if let Some(answers) = ask_user_answers(tur, args) {
                outcome.set("content", answers.into());
            }
        }
        "TaskStop" => {
            if str_at(tur, "task_type") == Some("local_bash") {
                let args = rename_keys(args, &[("agent_id", "shellId")]);
                outcome.restart = Some(("stop_powershell", args));
            }
            if let Some(message) = str_at(tur, "message") {
                outcome.set("content", message.into());
            }
        }
        _ => {}
    }
    outcome
}

/// `stdout` then `stderr`; image output keeps the text placeholder.
fn shell(outcome: &mut Outcome, tur: &Value) {
    if tur.get("isImage").and_then(Value::as_bool) != Some(true) {
        let output: Vec<&str> = ["stdout", "stderr"]
            .into_iter()
            .filter_map(|key| str_at(tur, key))
            .map(str::trim_end)
            .filter(|text| !text.is_empty())
            .collect();
        if !output.is_empty() {
            outcome.set("content", output.join("\n").into());
        }
    }
    for key in ["persistedOutputPath", "persistedOutputSize"] {
        if let Some(value) = tur.get(key).filter(|v| v.is_string() || v.is_number()) {
            outcome.set(key, value.clone());
        }
    }
}

/// 0, or 1 with `returnCodeInterpretation`. Unknown while the command still
/// runs (background, timed out) or after an interrupt.
fn success_exit_code(tur: &Value) -> Option<i64> {
    let unfinished = tur.get("interrupted").and_then(Value::as_bool) == Some(true)
        || tur.get("backgroundTaskId").is_some_and(|v| !v.is_null())
        || tur.get("timedOutAfterMs").is_some_and(|v| !v.is_null());
    if unfinished {
        return None;
    }
    Some(if str_at(tur, "returnCodeInterpretation").is_some() {
        INTERPRETED_EXIT_CODE
    } else {
        0
    })
}

/// `Exit code N` on the first line, optionally after `Error: `.
fn failed_exit_code(text: &str) -> Option<i64> {
    let line = text.lines().next()?.trim();
    let line = line.strip_prefix("Error: ").unwrap_or(line);
    line.strip_prefix("Exit code ")?.trim().parse().ok()
}

/// A text Read as `N. line` from `file.content` and `file.startLine`, the
/// numbered form the `view` renderer reads; an image Read as a placeholder
/// with its dimensions. Other kinds (notebook, PDF) keep the text.
fn read_content(tur: &Value) -> Option<String> {
    let file = tur.get("file")?;
    match str_at(tur, "type")? {
        "text" => {
            let content = str_at(file, "content").filter(|c| !c.is_empty())?;
            let start = file.get("startLine").and_then(Value::as_u64).unwrap_or(1);
            let body = content.strip_suffix('\n').unwrap_or(content);
            let numbered: Vec<String> = body
                .split('\n')
                .enumerate()
                .map(|(i, line)| format!("{}. {line}", start + i as u64))
                .collect();
            Some(numbered.join("\n"))
        }
        "image" => {
            let dims = file.get("dimensions");
            let size = |keys: [&str; 2]| {
                keys.iter()
                    .find_map(|key| dims.and_then(|d| d.get(*key)).and_then(Value::as_u64))
            };
            let mut parts = Vec::new();
            if let (Some(w), Some(h)) = (
                size(["originalWidth", "displayWidth"]),
                size(["originalHeight", "displayHeight"]),
            ) {
                parts.push(format!("{w}×{h}"));
            }
            if let Some(mime) = str_at(file, "type") {
                parts.push(mime.to_string());
            }
            if let Some(bytes) = file.get("originalSize").and_then(Value::as_u64) {
                parts.push(format!("{bytes} bytes"));
            }
            Some(format!("[image: {}]", parts.join(", ")))
        }
        _ => None,
    }
}

/// `structuredPatch` as `@@ -a,b +c,d @@` hunks with their real line numbers.
fn hunks(tur: &Value) -> Option<String> {
    let patch = tur.get("structuredPatch")?.as_array()?;
    let mut out = Vec::new();
    for hunk in patch {
        let n = |key: &str| hunk.get(key).and_then(Value::as_u64).unwrap_or(0);
        out.push(format!(
            "@@ -{},{} +{},{} @@",
            n("oldStart"),
            n("oldLines"),
            n("newStart"),
            n("newLines")
        ));
        out.extend(strings(hunk.get("lines")).into_iter().map(str::to_string));
    }
    Some(out.join("\n"))
}

/// The `{text: {value, annotations}}` envelope the `web_search` renderer
/// reads: commentary strings joined, and each link as a `url_citation`.
fn web_search(tur: &Value) -> String {
    let mut texts = Vec::new();
    let mut annotations = Vec::new();
    for item in tur
        .get("results")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        match item {
            Value::String(text) if !text.trim().is_empty() => texts.push(text.as_str()),
            Value::Object(_) => {
                let links = item.get("content").and_then(Value::as_array);
                for link in links.into_iter().flatten() {
                    if let Some(url) = str_at(link, "url") {
                        let title = str_at(link, "title").unwrap_or(url);
                        annotations.push(json!({
                            "type": "url_citation",
                            "url_citation": {"url": url, "title": title},
                        }));
                    }
                }
            }
            _ => {}
        }
    }
    let value = if texts.is_empty() {
        let query = str_at(tur, "query").unwrap_or_default();
        format!("Web search results for query: \"{query}\"")
    } else {
        texts.join("\n\n")
    };
    json!({"text": {"value": value, "annotations": annotations}}).to_string()
}

/// `answers` (keyed by question text) as `{"q1": answer, …}` JSON, keyed
/// like the `requestedSchema` built from the same questions.
fn ask_user_answers(tur: &Value, args: &Value) -> Option<String> {
    let answers = tur.get("answers")?.as_object()?;
    let questions = tur
        .get("questions")
        .or_else(|| args.get("questions"))
        .and_then(Value::as_array)?;
    let mut out = Map::new();
    for (index, question) in questions.iter().enumerate() {
        if let Some(answer) = str_at(question, "question").and_then(|q| answers.get(q)) {
            out.insert(question_key(index), answer.clone());
        }
    }
    Some(Value::Object(out).to_string())
}

fn str_at<'v>(value: &'v Value, key: &str) -> Option<&'v str> {
    value.get(key).and_then(Value::as_str)
}

fn strings(value: Option<&Value>) -> Vec<&str> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect()
}
