//! `user`, `attachment` and `queue-operation` records (mapping.md §1, §1.1).
//!
//! Only human prompts, slash commands and notifications that wake an idle
//! session become `user.message`, because every root `user.message` opens a
//! new Conversation turn. Meta records map to events that keep the active one.

use serde_json::{Value, json};

use super::notify::{TaskNotification, contains_notification, parse_notifications};
use super::prompts::{
    command_name, command_output, command_prompt, echoed_command, is_command_caveat,
};
use super::records::{Blocks, Rec, block_type};
use super::translate::{Custom, RecCtx, Stream, Translator};

/// Attachment types seen so far (record-shapes.md and the S3 probe on
/// 2.1.274–2.1.289); others are counted as new.
const KNOWN_ATTACHMENTS: &[&str] = &[
    "agent_listing_delta",
    "auto_mode",
    "command_permissions",
    "compact_file_reference",
    "credential_org",
    "date",
    "deferred_tools_delta",
    "deferred_tools_record",
    "edited_text_file",
    "environment",
    "file",
    "hook_system_message",
    "instructions",
    "mcp_instructions_delta",
    "model",
    "nested_memory",
    "plan_file_reference",
    "plan_mode",
    "plan_mode_exit",
    "prompt_snapshot",
    "queued_command",
    "read_truncation_notice",
    "remote_session_change",
    "session_context",
    "silent_turn_reminder",
    "skill_listing",
    "task_status",
    "thinking_drop",
    "total_tokens_reminder",
];

#[derive(Clone, Copy, PartialEq, Eq)]
enum Carrier {
    User,
    Other,
}

impl<F: Fn() -> bool> Translator<'_, F> {
    pub(super) fn user(&mut self, st: &mut Stream<'_>, ctx: &mut RecCtx, rec: Rec<'_>) {
        if rec.has_tool_results() {
            self.tool_results(st, ctx, rec);
            return;
        }
        if rec.flag("isCompactSummary") {
            // Folded into the boundary's `summaryContent`.
            self.native_only(st, ctx);
            return;
        }
        if rec.origin_kind() == Some("peer") {
            self.handback(st, ctx, rec);
            return;
        }
        let text = rec.text().unwrap_or_default();
        if rec.origin_kind() == Some("task-notification") || contains_notification(&text) {
            self.notification_carrier(st, ctx, rec, &text, Carrier::User);
            return;
        }
        if is_interrupt(rec, &text) {
            self.interrupt(st, ctx, true);
            return;
        }
        if rec.flag("isMeta") {
            if is_command_caveat(&text) {
                // An instruction to the model, not something anyone typed or read.
                self.native_only(st, ctx);
                return;
            }
            let data = json!({"content": text});
            match st.pending_skill.take() {
                Some(skill) => {
                    let custom = Custom {
                        parent: Some(skill),
                        agent_id: None,
                    };
                    self.emit_custom(st, ctx, "skill.context_delivered", data, custom);
                }
                None => {
                    self.emit(st, ctx, "system.message", data);
                }
            }
            return;
        }
        if st.agent_id.is_some() && !st.prompt_seen {
            // A subagent's launch prompt: an inbound agent message, not a turn.
            st.prompt_seen = true;
            self.emit(st, ctx, "user.message", json!({"content": text}));
            return;
        }
        let mut echo = None;
        let mut content = text.clone();
        let (source, command) = if let Some(name) = command_name(&text) {
            if st.echoed_command.as_ref() == Some(&name) {
                // The typed echo already opened this command's interaction.
                st.echoed_command = None;
                self.native_only(st, ctx);
                return;
            }
            content = command_prompt(&name, &text);
            (format!("command-{name}"), Some(name))
        } else if let Some(name) = echoed_command(&text, &st.lines[st.cursor + 1..]) {
            echo = Some(name.clone());
            (format!("command-{name}"), Some(name))
        } else if let Some(output) = command_output(&text) {
            let folds = st.last_command.take().is_some();
            if output.is_empty() {
                self.native_only(st, ctx);
                return;
            }
            if folds {
                self.emit(st, ctx, "system.message", json!({"content": output}));
                return;
            }
            content = output;
            ("command-local".to_string(), None)
        } else {
            ("user".to_string(), None)
        };
        self.new_interaction(st, ctx, rec);
        st.last_command = command;
        st.echoed_command = echo;
        let data = json!({
            "content": content,
            "interactionId": st.interaction,
            "source": source,
            "attachments": prompt_attachments(rec),
        });
        self.emit(st, ctx, "user.message", data);
    }

    pub(super) fn attachment(&mut self, st: &mut Stream<'_>, ctx: &mut RecCtx, rec: Rec<'_>) {
        let kind = rec.ptr_str("/attachment/type").unwrap_or("");
        if kind == "queued_command"
            && let Some(prompt) = rec.ptr_str("/attachment/prompt")
            && contains_notification(prompt)
        {
            self.notification_carrier(st, ctx, rec, prompt, Carrier::Other);
            return;
        }
        if !KNOWN_ATTACHMENTS.contains(&kind) {
            *self
                .diagnostics
                .unknown_attachment_types
                .entry(kind.to_string())
                .or_default() += 1;
        }
        self.native_only(st, ctx);
    }

    pub(super) fn queue_operation(&mut self, st: &mut Stream<'_>, ctx: &mut RecCtx, rec: Rec<'_>) {
        match rec.str("content").filter(|c| contains_notification(c)) {
            Some(content) => self.notification_carrier(st, ctx, rec, content, Carrier::Other),
            None => self.native_only(st, ctx),
        }
    }

    fn new_interaction(&mut self, st: &mut Stream<'_>, ctx: &RecCtx, rec: Rec<'_>) {
        self.close_call(st, ctx);
        st.interaction = rec.str("promptId").map(str::to_string);
        st.pending_skill = None;
        st.echoed_command = None;
        st.last_closed_end_turn = false;
    }

    /// End the open call. `warn` adds an incident warning, in the interrupted
    /// turn; a denial that interrupts already has its own.
    pub(super) fn interrupt(&mut self, st: &mut Stream<'_>, ctx: &mut RecCtx, warn: bool) {
        if let Some(call) = st.open_call.as_mut() {
            call.interrupted = true;
        }
        if warn {
            let data =
                json!({"warningType": "user_interrupt", "message": "Interrupted by the user"});
            self.emit(st, ctx, "session.warning", data);
        }
        self.emit(st, ctx, "abort", json!({"reason": "user initiated"}));
    }

    /// A subagent's report (`origin.kind: peer`, `handback: true`).
    fn handback(&mut self, st: &mut Stream<'_>, ctx: &mut RecCtx, rec: Rec<'_>) {
        let Some(agent) = rec.ptr_str("/origin/from").map(str::to_string) else {
            self.emit(st, ctx, "system.message", json!({"content": rec.text()}));
            return;
        };
        let owner = self.owner_of(&agent);
        if !self.terminals.contains_key(&agent) {
            self.terminals.insert(agent.clone(), false);
            let data = json!({"toolCallId": owner});
            let custom = Custom {
                parent: None,
                agent_id: Some(agent.clone()),
            };
            self.emit_custom(st, ctx, "subagent.completed", data, custom);
        }
        let body = rec
            .ptr_str("/origin/body")
            .map(str::to_string)
            .or_else(|| rec.text());
        let data = json!({
            "messageId": rec.uuid(),
            "content": body,
            "parentToolCallId": owner,
        });
        let custom = Custom {
            parent: None,
            agent_id: Some(agent),
        };
        self.emit_custom(st, ctx, "assistant.message", data, custom);
    }

    fn notification_carrier(
        &mut self,
        st: &mut Stream<'_>,
        ctx: &mut RecCtx,
        rec: Rec<'_>,
        text: &str,
        carrier: Carrier,
    ) {
        let first_event = ctx.emitted();
        for note in parse_notifications(text) {
            if !self.notifications.insert(note.key()) {
                self.diagnostics.duplicate_notifications += 1;
                continue;
            }
            let agent = self.notification_agent(&note);
            let kind = match &agent {
                Some(agent) => {
                    json!({"type": "agent_completed", "agentId": agent, "status": note.status})
                }
                None => {
                    json!({"type": "shell_completed", "shellId": note.task_id, "status": note.status})
                }
            };
            let data = json!({"content": note.text, "kind": kind});
            self.emit(st, ctx, "system.notification", data);
            if let Some(agent) = agent {
                self.agent_terminal(st, ctx, &agent, &note);
            }
        }
        if carrier == Carrier::User && st.agent_id.is_none() && is_idle(st) {
            // It wakes an idle session: a system-initiated interaction.
            self.new_interaction(st, ctx, rec);
            let data = json!({
                "content": text,
                "interactionId": st.interaction,
                "source": "system",
            });
            self.emit(st, ctx, "user.message", data);
        }
        if ctx.emitted() == first_event {
            self.native_only(st, ctx);
        }
    }

    fn notification_agent(&self, note: &TaskNotification) -> Option<String> {
        let by_tool = note
            .tool_use_id
            .as_ref()
            .filter(|tool| self.agent_tool_ids.contains(*tool));
        let task = note.task_id.as_ref();
        if task.is_some_and(|id| self.agent_owner.contains_key(id)) || by_tool.is_some() {
            return task.cloned().or_else(|| {
                let tool = by_tool?;
                self.agent_owner
                    .iter()
                    .find(|(_, owner)| *owner == tool)
                    .map(|(agent, _)| agent.clone())
            });
        }
        None
    }

    /// `subagent.completed`/`failed` from a notification. A hand-back may have
    /// completed the agent already; a later notification adds its totals.
    fn agent_terminal(
        &mut self,
        st: &mut Stream<'_>,
        ctx: &mut RecCtx,
        agent: &str,
        note: &TaskNotification,
    ) {
        let has_totals = note.total_tokens.is_some();
        match self.terminals.get(agent) {
            Some(true) => return,
            Some(false) if !has_totals => return,
            _ => {}
        }
        let owner = note.tool_use_id.clone().or_else(|| self.owner_of(agent));
        let (kind, data) = match note.status.as_deref() {
            Some("completed") => ("subagent.completed", json!({})),
            Some("failed") => (
                "subagent.failed",
                json!({"error": note.summary.as_deref().unwrap_or("Subagent failed")}),
            ),
            Some("stopped" | "killed" | "cancelled") => {
                ("subagent.completed", json!({"cancelled": true}))
            }
            _ => return,
        };
        let mut data = data;
        if let Some(map) = data.as_object_mut() {
            map.insert("toolCallId".into(), json!(owner));
            map.insert("totalTokens".into(), json!(note.total_tokens));
            map.insert("totalToolCalls".into(), json!(note.tool_uses));
            map.insert("durationMs".into(), json!(note.duration_ms));
        }
        self.terminals.insert(agent.to_string(), has_totals);
        let custom = Custom {
            parent: None,
            agent_id: Some(agent.to_string()),
        };
        self.emit_custom(st, ctx, kind, data, custom);
    }

    fn owner_of(&self, agent: &str) -> Option<String> {
        Some(
            self.agent_owner
                .get(agent)
                .cloned()
                .unwrap_or_else(|| agent.to_string()),
        )
    }
}

/// The previous call ended the model's work (`end_turn`, no pending tools).
fn is_idle(st: &Stream<'_>) -> bool {
    match &st.open_call {
        None => st.last_closed_end_turn,
        Some(call) => {
            !call.interrupted
                && call.pending.is_empty()
                && call.stop_reason.as_deref() == Some("end_turn")
        }
    }
}

fn is_interrupt(rec: Rec<'_>, text: &str) -> bool {
    rec.str("interruptedMessageId").is_some() || text.starts_with("[Request interrupted by user")
}

/// Pasted images, without their (already sanitized) data.
fn prompt_attachments(rec: Rec<'_>) -> Option<Vec<Value>> {
    let Blocks::Array(blocks) = rec.blocks() else {
        return None;
    };
    let images: Vec<Value> = blocks
        .iter()
        .filter(|b| block_type(b) == "image")
        .map(|b| json!({"type": "image", "mediaType": b.pointer("/source/media_type")}))
        .collect();
    (!images.is_empty()).then_some(images)
}
