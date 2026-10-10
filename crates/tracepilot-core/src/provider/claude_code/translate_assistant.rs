//! `assistant` and `system` records, `cost-state` and the synthesized
//! `session.start` (mapping.md §1, §1.2).

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde_json::{Value, json};

use super::reader::Line;
use super::records::{CompactMetadata, Rec, block_type};
use super::tools;
use super::translate::{OpenCall, RecCtx, Stream, Translator, base_id, strip_nulls};
use super::usage::{CallSite, CostSnapshot};
use crate::error::Result;

impl<F: Fn() -> bool> Translator<'_, F> {
    pub(super) fn observe_call(
        &mut self,
        st: &Stream<'_>,
        rec: Rec<'_>,
        line: &Line,
        abandoned: bool,
    ) {
        let site = CallSite {
            agent_id: st.agent_id.as_deref(),
            line: line.line,
            snapshot_anchor: self.snapshot_anchor(st, line.line, rec.timestamp()),
            abandoned,
            requested_at: st.previous_ts,
            at: rec.timestamp(),
        };
        self.calls.observe(rec, site);
    }

    /// The main-file line that orders a record of `st` at `at` against
    /// `cost-state` snapshots: its own line in the main file. In a subagent
    /// file, its launch's line, or the line of the latest `SendMessage` that
    /// resumed the agent before `at` when that is later: a resumed agent's
    /// next calls come after that message, and may come after a snapshot
    /// that its launch is before. `None` for an orphan subagent.
    fn snapshot_anchor(
        &self,
        st: &Stream<'_>,
        line: usize,
        at: Option<DateTime<Utc>>,
    ) -> Option<usize> {
        let Some(agent) = st.agent_id.as_deref() else {
            return Some(line);
        };
        let launch = st.anchor?;
        let resumed = at.and_then(|at| {
            let resumes = self.resumes.get(agent)?;
            resumes
                .iter()
                .filter(|(when, _)| *when <= at)
                .map(|(_, line)| *line)
                .max()
        });
        Some(resumed.map_or(launch, |line| line.max(launch)))
    }

    pub(super) fn assistant(
        &mut self,
        st: &mut Stream<'_>,
        ctx: &mut RecCtx,
        rec: Rec<'_>,
        line: &Line,
    ) -> Result<()> {
        if rec.is_synthetic_error() {
            let data = json!({
                "errorType": rec.str("error").unwrap_or("api_error"),
                "statusCode": rec.0.get("apiErrorStatus"),
                "message": assistant_text(rec),
            });
            self.emit(st, ctx, "session.error", data);
            return Ok(());
        }
        self.observe_call(st, rec, line, false);
        let Some(id) = rec.message_id() else {
            self.native_only(st, ctx);
            return Ok(());
        };
        let model = rec.model();
        if st.open_call.as_ref().map(|call| call.id.as_str()) != Some(id) {
            self.close_call(st, ctx);
            if let (Some(previous), Some(model)) = (st.last_model.clone(), model)
                && previous != model
            {
                let data = json!({"previousModel": previous, "newModel": model});
                self.synth(st, ctx, "model_change", "session.model_change", data);
            }
            if model.is_some() {
                st.last_model = model.map(str::to_string);
            }
            st.last_command = None;
            let data = json!({
                "turnId": id,
                "model": model,
                "interactionId": st.interaction,
                "parentToolCallId": st.owner_tool,
            });
            self.emit(st, ctx, "assistant.turn_start", data);
            self.model_call(st, ctx, rec, id);
            st.open_call = Some(OpenCall {
                id: id.to_string(),
                pending: Vec::new(),
                interrupted: false,
                stop_reason: None,
            });
        }
        if let (Some(call), Some(reason)) =
            (st.open_call.as_mut(), rec.ptr_str("/message/stop_reason"))
        {
            call.stop_reason = Some(reason.to_string());
        }
        let blocks = rec
            .0
            .pointer("/message/content")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or_default();
        for block in blocks {
            let text = |key: &str| block.get(key).and_then(Value::as_str).unwrap_or("");
            match block_type(block) {
                "text" if !text("text").trim().is_empty() => {
                    let data = json!({
                        "messageId": id,
                        "content": text("text"),
                        "model": if st.agent_id.is_none() { model } else { None },
                        "interactionId": st.interaction,
                        "parentToolCallId": st.owner_tool,
                    });
                    self.emit(st, ctx, "assistant.message", data);
                }
                "thinking" if !text("thinking").trim().is_empty() => {
                    let data = json!({"reasoningId": id, "content": text("thinking")});
                    self.emit(st, ctx, "assistant.reasoning", data);
                }
                "thinking" | "redacted_thinking" => self.diagnostics.redacted_thinking += 1,
                "tool_use" => self.tool_use(st, ctx, block, line)?,
                _ => {}
            }
        }
        if ctx.emitted() == 0 {
            self.native_only(st, ctx);
        }
        Ok(())
    }

    /// A `tracepilot.model_call` for the call `id`, once per call. Its usage
    /// is filled in when the file is done, because the last record of a call
    /// carries the final counts. It leaves the parent chain of the stream's
    /// other events unchanged.
    fn model_call(&mut self, st: &mut Stream<'_>, ctx: &RecCtx, rec: Rec<'_>, id: &str) {
        if self.model_calls.contains_key(id) {
            return;
        }
        self.model_calls.insert(id.to_string(), self.events.len());
        let last_event = st.last_event.clone();
        let data = json!({"requestId": rec.str("requestId").unwrap_or(id)});
        self.synth(st, ctx, "model_call", "tracepilot.model_call", data);
        st.last_event = last_event;
    }

    fn tool_use(
        &mut self,
        st: &mut Stream<'_>,
        ctx: &mut RecCtx,
        block: &Value,
        line: &Line,
    ) -> Result<()> {
        let id = block.get("id").and_then(Value::as_str).unwrap_or_default();
        let native = block
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        let input = block.get("input").cloned().unwrap_or(Value::Null);
        let tool = tools::normalize(native, &input);
        if let Some(call) = st.open_call.as_mut() {
            call.pending.push(id.to_string());
        }
        let data = json!({
            "toolCallId": id,
            "toolName": tool.name,
            "arguments": tool.arguments,
            "nativeToolName": native,
            "mcpServerName": tool.mcp_server_name,
            "mcpToolName": tool.mcp_tool_name,
            "parentToolCallId": st.owner_tool,
        });
        let start = self.emit(st, ctx, "tool.execution_start", data);
        self.tool_starts
            .insert(id.to_string(), self.events.len() - 1);
        if tool.name == "skill" {
            let name = input.get("skill").and_then(Value::as_str);
            let skill = self.emit(st, ctx, "skill.invoked", json!({"name": name}));
            st.pending_skill = Some(skill);
        }
        let anchor = self.snapshot_anchor(st, line.line, ctx.ts);
        for index in self.launches.get(id).cloned().unwrap_or_default() {
            self.run_child(index, Some(id.to_string()), anchor, Some(start.clone()))?;
        }
        Ok(())
    }

    /// End the open call: `turn_end` unless it was interrupted.
    pub(super) fn close_call(&mut self, st: &mut Stream<'_>, ctx: &RecCtx) {
        let Some(call) = st.open_call.take() else {
            return;
        };
        st.last_closed_end_turn =
            call.pending.is_empty() && call.stop_reason.as_deref() == Some("end_turn");
        if call.interrupted {
            return;
        }
        self.diagnostics.missing_tool_results += call.pending.len();
        let data = json!({"turnId": call.id, "parentToolCallId": st.owner_tool});
        self.synth(st, ctx, "turn_end", "assistant.turn_end", data);
    }

    pub(super) fn system(
        &mut self,
        st: &mut Stream<'_>,
        ctx: &mut RecCtx,
        rec: Rec<'_>,
        line: &Line,
    ) {
        match rec.str("subtype").unwrap_or("") {
            "compact_boundary" => {
                let meta: CompactMetadata = rec
                    .0
                    .get("compactMetadata")
                    .and_then(|m| serde::Deserialize::deserialize(m).ok())
                    .unwrap_or_default();
                let data = json!({"trigger": meta.trigger, "currentTokens": meta.pre_tokens});
                self.emit(st, ctx, "session.compaction_start", data);
                let data = json!({
                    "success": true,
                    "trigger": meta.trigger,
                    "preCompactionTokens": meta.pre_tokens,
                    "postCompactionTokens": meta.post_tokens,
                    "durationMs": meta.duration_ms,
                    "summaryContent": st.summaries.get(&line.line),
                });
                self.emit(st, ctx, "session.compaction_complete", data);
            }
            "turn_duration" => {
                self.close_call(st, ctx);
                self.native_only(st, ctx);
            }
            subtype @ ("informational" | "away_summary" | "local_command") => {
                let data = json!({"infoType": subtype, "message": rec.str("content")});
                self.emit(st, ctx, "session.info", data);
            }
            _ => self.native_only(st, ctx),
        }
    }

    pub(super) fn cost_state(&mut self, rec: Rec<'_>, line: &Line) {
        self.diagnostics.cost_state_records += 1;
        let Some(snapshot) = CostSnapshot::from_record(rec.0, line.line) else {
            return;
        };
        if let Some(last) = self
            .snapshots
            .last_mut()
            .filter(|last| last.same_totals(&snapshot))
        {
            // Keep the first coverage boundary, but the latest recorded durations.
            let line = last.line;
            *last = snapshot;
            last.line = line;
        } else {
            self.snapshots.push(snapshot);
        }
    }

    /// Synthesized `session.start` before the first record (context only;
    /// `session.shutdown` is never synthesized).
    pub(super) fn session_start(&mut self, st: &mut Stream<'_>, main: &[Line]) {
        let Some(first) = main.first() else { return };
        let records = || main.iter().map(|line| Rec(&line.value));
        let find = |pointer: &str| records().find_map(|rec| rec.ptr_str(pointer));
        let git = "/serverClassifierContext/context/git_state";
        let model = records()
            .find(|rec| rec.kind() == "assistant" && !rec.is_synthetic_error())
            .and_then(|rec| rec.model());
        let ts = records().find_map(|rec| rec.timestamp());
        let data = json!({
            "sessionId": find("/sessionId"),
            "producer": "claude-code",
            "version": find("/version"),
            "startTime": ts.map(|ts| ts.to_rfc3339()),
            "selectedModel": model,
            "context": {
                "cwd": find("/cwd"),
                "gitRoot": find(&format!("{git}/root")),
                "branch": find("/gitBranch"),
                "repository": find(&format!("{git}/visibility/origin/remote"))
                    .or_else(|| find("/prRepository")),
            },
        });
        let id = format!("{}:session.start", base_id(st, first));
        self.push(st, id, "session.start", strip_nulls(data), ts, None, None);
    }
}

fn assistant_text(rec: Rec<'_>) -> Option<String> {
    let blocks = rec.0.pointer("/message/content")?.as_array()?;
    let text: Vec<&str> = blocks
        .iter()
        .filter(|b| block_type(b) == "text")
        .filter_map(|b| b.get("text").and_then(Value::as_str))
        .collect();
    (!text.is_empty()).then(|| text.join("\n"))
}

/// Compaction boundary line → the summary text of the next
/// `isCompactSummary` record before another boundary or prompt.
pub(super) fn compact_summaries(lines: &[Line]) -> HashMap<usize, String> {
    let mut summaries = HashMap::new();
    let mut boundary = None;
    for line in lines {
        let rec = Rec(&line.value);
        if rec.kind() == "system" && rec.str("subtype") == Some("compact_boundary") {
            boundary = Some(line.line);
        } else if rec.kind() == "user" && rec.flag("isCompactSummary") {
            if let (Some(at), Some(text)) = (boundary.take(), rec.text()) {
                summaries.insert(at, text);
            }
        } else if rec.kind() == "assistant" {
            boundary = None;
        }
    }
    summaries
}
