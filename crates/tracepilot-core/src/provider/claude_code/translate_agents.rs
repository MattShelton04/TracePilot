//! A subagent's terminal events: from its hand-back, its
//! `<task-notification>` or its `Agent` result (mapping.md §1.3).
//!
//! A `SendMessage` that resumes a finished agent (`resumedAgentId`) runs it
//! again, and that run ends with a new hand-back and notification. One
//! completion's carriers repeat its block word for word, while a later
//! completion writes a new one, so each new block ends the agent again.

use serde_json::{Value, json};

use super::notify::TaskNotification;
use super::records::Rec;
use super::translate::{Custom, RecCtx, Stream, Translator};

/// An agent's reported tool uses and duration. Claude Code counts both from
/// the agent's latest (re)start, while its token figure keeps growing across
/// them. A resume can restart the counts or continue them, and the records
/// do not say which, but a restarted count is lower than the report before
/// it. So a lower report carries the earlier counts into the run's totals.
#[derive(Clone, Copy, Default)]
pub(super) struct AgentTotals {
    /// Tool uses and duration of the agent's earlier starts.
    carried: [u64; 2],
    /// The latest report since the agent's latest start.
    last: [Option<u64>; 2],
}

impl AgentTotals {
    /// Take a report of `[tool uses, duration ms]` and return the run's
    /// totals so far. A field the report lacks stays unknown.
    fn report(&mut self, now: [Option<u64>; 2]) -> [Option<u64>; 2] {
        let restarted = self
            .last
            .iter()
            .zip(&now)
            .any(|pair| matches!(pair, (Some(last), Some(now)) if now < last));
        let fields = self.carried.iter_mut().zip(&mut self.last).zip(now);
        let mut totals = [None; 2];
        for (total, ((carried, last), now)) in totals.iter_mut().zip(fields) {
            if restarted {
                *carried = carried.saturating_add(last.unwrap_or(0));
                *last = now;
            } else {
                *last = now.or(*last);
            }
            *total = now.map(|now| now.saturating_add(*carried));
        }
        totals
    }
}

/// How an agent's latest completion has been reported so far.
#[derive(Clone, Copy, Default)]
pub(super) struct Terminal {
    /// Its terminal event carried the agent's totals.
    totals: bool,
    /// A notification reported it.
    notified: bool,
}

impl<F: Fn() -> bool> Translator<'_, F> {
    /// A subagent's message to the main agent (`origin.kind: peer`). A
    /// hand-back (`handback: true`) is its report, which ends it unless a
    /// notification already did.
    pub(super) fn peer_message(&mut self, st: &mut Stream<'_>, ctx: &mut RecCtx, rec: Rec<'_>) {
        let Some(agent) = rec.ptr_str("/origin/from").map(str::to_string) else {
            self.emit(st, ctx, "system.message", json!({"content": rec.text()}));
            return;
        };
        let owner = self.owner_of(&agent);
        let handback = rec.0.pointer("/origin/handback").and_then(Value::as_bool) == Some(true);
        if handback && !self.terminals.contains_key(&agent) {
            self.terminals.insert(agent.clone(), Terminal::default());
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

    /// A successful `SendMessage` result that resumed a finished agent: its
    /// next hand-back or notification ends it again. A message to a running
    /// agent (no `resumedAgentId`) changes nothing.
    pub(super) fn send_message_result(&mut self, tur: Option<&Value>) {
        if let Some(agent) = tur
            .and_then(|t| t.get("resumedAgentId"))
            .and_then(Value::as_str)
        {
            self.terminals.remove(agent);
        }
    }

    pub(super) fn notification_agent(&self, note: &TaskNotification) -> Option<String> {
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

    /// `subagent.completed`/`failed` from a new notification block. One that
    /// reports a completion a hand-back or result already ended only adds
    /// its totals; any other is a later completion of a resumed agent.
    pub(super) fn agent_terminal(
        &mut self,
        st: &mut Stream<'_>,
        ctx: &mut RecCtx,
        agent: &str,
        note: &TaskNotification,
    ) {
        let (kind, mut data) = match note.status.as_deref() {
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
        let has_totals = note.total_tokens.is_some();
        if let Some(terminal) = self.terminals.get_mut(agent)
            && !terminal.notified
        {
            terminal.notified = true;
            if terminal.totals || !has_totals {
                return;
            }
        }
        // A resumed agent's notification names the `SendMessage` that resumed
        // it, so the launching call comes first.
        let owner = self
            .agent_owner
            .get(agent)
            .cloned()
            .or_else(|| note.tool_use_id.clone())
            .unwrap_or_else(|| agent.to_string());
        let [tool_uses, duration] = self
            .agent_totals
            .entry(agent.to_string())
            .or_default()
            .report([note.tool_uses, note.duration_ms]);
        if let Some(map) = data.as_object_mut() {
            map.insert("toolCallId".into(), json!(owner));
            map.insert("totalTokens".into(), json!(note.total_tokens));
            map.insert("totalToolCalls".into(), json!(tool_uses));
            map.insert("durationMs".into(), json!(duration));
        }
        let terminal = Terminal {
            totals: has_totals,
            notified: true,
        };
        self.terminals.insert(agent.to_string(), terminal);
        let custom = Custom {
            parent: None,
            agent_id: Some(agent.to_string()),
        };
        self.emit_custom(st, ctx, kind, data, custom);
    }

    /// The result of `Agent` call `tool`. A foreground agent's result comes
    /// back when the agent has finished, so it ends the agent unless a
    /// hand-back or notification already did; an asynchronous launch's result
    /// only says it started. `error` is the text of a failed result.
    pub(super) fn agent_result(
        &mut self,
        st: &mut Stream<'_>,
        ctx: &mut RecCtx,
        tool: &str,
        tur: Option<&Value>,
        error: Option<String>,
    ) {
        let field = |key: &str| tur.filter(|t| t.is_object()).and_then(|t| t.get(key));
        let launched = field("isAsync").and_then(Value::as_bool) == Some(true)
            || field("status").and_then(Value::as_str) == Some("async_launched");
        if launched && error.is_none() {
            return;
        }
        let children = self.children;
        let agent = field("agentId")
            .and_then(Value::as_str)
            .map(str::to_string)
            .or_else(|| {
                let first = self.launches.get(tool)?.first()?;
                Some(children[*first].agent_id.clone())
            });
        let key = agent.clone().unwrap_or_else(|| tool.to_string());
        if self.terminals.contains_key(&key) {
            return;
        }
        let total_tokens = field("totalTokens").and_then(Value::as_u64);
        let terminal = Terminal {
            totals: total_tokens.is_some(),
            notified: false,
        };
        self.terminals.insert(key, terminal);
        let (kind, mut data) = match error {
            None => ("subagent.completed", json!({})),
            Some(text) if text.starts_with("[Request interrupted by user") => {
                ("subagent.completed", json!({"cancelled": true}))
            }
            Some(text) => ("subagent.failed", json!({"error": text})),
        };
        let reported = ["totalToolUseCount", "totalDurationMs"].map(|key| field(key)?.as_u64());
        let [tool_uses, duration] = match &agent {
            Some(agent) => self
                .agent_totals
                .entry(agent.clone())
                .or_default()
                .report(reported),
            None => reported,
        };
        if let Some(map) = data.as_object_mut() {
            map.insert("toolCallId".into(), json!(tool));
            map.insert("totalTokens".into(), json!(total_tokens));
            map.insert("totalToolCalls".into(), json!(tool_uses));
            map.insert("durationMs".into(), json!(duration));
        }
        let custom = Custom {
            parent: None,
            agent_id: agent,
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
