//! Records → canonical events (mapping.md §1).
//!
//! Each stream (the main file, then each subagent file inserted after its
//! launching call) is translated in file order. Event ids are
//! `"<record uuid>:<n>"` for the n-th event made from a record and
//! `"<anchor uuid>:<kind>"` for synthesized ones (`eof_turn_end` for a call
//! that ends the file), so they are stable across re-parses. Every event's `raw.data` is the Copilot-shaped payload, and its
//! typed data comes from `typed_data_from_raw`, exactly as a reparse would.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use chrono::{DateTime, Utc};
use serde_json::{Value, json};

use super::reader::Line;
use super::records::Rec;
use super::subagents::ChildStream;
use super::usage::{CallTable, CostSnapshot};
use super::{ClaudeDiagnostics, ClaudeParse, NativePosition, branch, subagents};
use crate::error::Result;
use crate::models::event_types::SessionEventType;
use crate::parsing::events::{RawEvent, TypedEvent, TypedEventData, typed_data_from_raw};
use crate::parsing::snapshot::check_cancelled;
use crate::provider::{NativeRecord, SessionSource};

/// Record types without a mapping, shown on the Events tab only. The last
/// four were first seen by the S3 probe (2.1.274–2.1.289).
const BOOKKEEPING: &[&str] = &[
    "custom-title",
    "ai-title",
    "agent-name",
    "pr-link",
    "last-prompt",
    "mode",
    "permission-mode",
    "atis-latch",
    "file-history-snapshot",
    "file-history-delta",
    "bridge-session",
    "frame-link",
    "artifact-autoreact-ledger",
    "artifact-comment-monitor",
];

/// Stop reasons that end a call for good, so a file ending after one is not live.
const FINAL_STOPS: &[&str] = &["end_turn", "stop_sequence", "max_tokens", "refusal"];

pub(super) struct Translator<'a, F> {
    pub(super) is_cancelled: &'a F,
    pub(super) children: &'a [ChildStream],
    /// Launching `tool_use` id → child indices, by first timestamp then agent id.
    pub(super) launches: HashMap<String, Vec<usize>>,
    /// Agent id → launching `tool_use` id.
    pub(super) agent_owner: HashMap<String, String>,
    pub(super) agent_tool_ids: HashSet<String>,
    /// `tool_use` id → index of its `tool.execution_start` in `events`.
    pub(super) tool_starts: HashMap<String, usize>,
    pub(super) inserted: HashSet<String>,
    pub(super) events: Vec<RawEvent>,
    pub(super) positions: Vec<Option<NativePosition>>,
    pub(super) calls: CallTable,
    /// `tracepilot.model_call` events by message id, filled in by `finish`.
    pub(super) model_calls: HashMap<String, usize>,
    pub(super) snapshots: Vec<CostSnapshot>,
    pub(super) diagnostics: ClaudeDiagnostics,
    /// Notification keys already emitted.
    pub(super) notifications: HashSet<(String, String)>,
    /// Agents with an emitted terminal event → whether it carried totals.
    pub(super) terminals: HashMap<String, bool>,
}

/// Translation state of one stream.
pub(super) struct Stream<'s> {
    pub(super) agent_id: Option<String>,
    /// The launching call of a subagent stream (`parentToolCallId`).
    pub(super) owner_tool: Option<String>,
    /// Main-file line of the launching call, for usage anchoring.
    pub(super) anchor: Option<usize>,
    pub(super) lines: &'s [Line],
    /// Index in `lines` of the record being translated.
    pub(super) cursor: usize,
    pub(super) abandoned: HashSet<String>,
    pub(super) inherited_abandoned: bool,
    pub(super) summaries: HashMap<usize, String>,
    pub(super) last_event: Option<String>,
    pub(super) last_record: Option<(String, Option<DateTime<Utc>>)>,
    /// The latest timestamp of a record before the current one.
    pub(super) previous_ts: Option<DateTime<Utc>>,
    pub(super) open_call: Option<OpenCall>,
    pub(super) last_closed_end_turn: bool,
    pub(super) interaction: Option<String>,
    pub(super) last_model: Option<String>,
    pub(super) pending_skill: Option<String>,
    pub(super) last_command: Option<String>,
    /// A typed slash command whose `<command-name>` record is still to come.
    pub(super) echoed_command: Option<String>,
    pub(super) prompt_seen: bool,
}

pub(super) struct OpenCall {
    pub(super) id: String,
    pub(super) pending: Vec<String>,
    pub(super) interrupted: bool,
    pub(super) stop_reason: Option<String>,
}

/// Emission context of one record.
pub(super) struct RecCtx {
    pub(super) base: String,
    pub(super) n: usize,
    pub(super) ts: Option<DateTime<Utc>>,
    pub(super) record: Arc<Value>,
    pub(super) position: NativePosition,
}

impl RecCtx {
    /// Events made from this record so far.
    pub(super) fn emitted(&self) -> usize {
        self.n
    }
}

/// An event whose parent or owning agent differs from the stream default.
pub(super) struct Custom {
    pub(super) parent: Option<String>,
    pub(super) agent_id: Option<String>,
}

pub(super) fn translate(
    main: Vec<Line>,
    children: Vec<ChildStream>,
    is_cancelled: &impl Fn() -> bool,
    diagnostics: ClaudeDiagnostics,
) -> Result<ClaudeParse> {
    let mut t = Translator::new(&children, is_cancelled, diagnostics, &main);
    let mut stream = t.stream(None, None, None, &main);
    t.session_start(&mut stream, &main);
    t.run(&mut stream)?;
    for (index, child) in children.iter().enumerate() {
        if !t.inserted.contains(&child.agent_id) {
            t.diagnostics.orphan_subagents += 1;
            t.run_child(index, None, None, None)?;
        }
    }
    Ok(t.finish())
}

impl<'a, F: Fn() -> bool> Translator<'a, F> {
    fn new(
        children: &'a [ChildStream],
        is_cancelled: &'a F,
        diagnostics: ClaudeDiagnostics,
        main: &[Line],
    ) -> Self {
        let links = subagents::link(main, children);
        Self {
            is_cancelled,
            children,
            launches: links.launches,
            agent_owner: links.agent_owner,
            agent_tool_ids: links.agent_tool_ids,
            tool_starts: HashMap::new(),
            inserted: HashSet::new(),
            events: Vec::new(),
            positions: Vec::new(),
            calls: CallTable::default(),
            model_calls: HashMap::new(),
            snapshots: Vec::new(),
            diagnostics,
            notifications: HashSet::new(),
            terminals: HashMap::new(),
        }
    }

    pub(super) fn stream<'s>(
        &mut self,
        agent_id: Option<String>,
        owner_tool: Option<String>,
        anchor: Option<usize>,
        lines: &'s [Line],
    ) -> Stream<'s> {
        let (abandoned, cycles) = branch::abandoned_uuids(lines);
        self.diagnostics.parent_cycles += cycles;
        Stream {
            agent_id,
            owner_tool,
            anchor,
            lines,
            cursor: 0,
            abandoned,
            inherited_abandoned: false,
            summaries: super::translate_assistant::compact_summaries(lines),
            last_event: None,
            last_record: None,
            previous_ts: None,
            open_call: None,
            last_closed_end_turn: false,
            interaction: None,
            last_model: None,
            pending_skill: None,
            last_command: None,
            echoed_command: None,
            prompt_seen: false,
        }
    }

    pub(super) fn run(&mut self, st: &mut Stream<'_>) -> Result<()> {
        let lines = st.lines;
        for (index, line) in lines.iter().enumerate() {
            check_cancelled(self.is_cancelled)?;
            st.cursor = index;
            self.record(st, line)?;
        }
        if let Some(call) = &st.open_call
            && !call.interrupted
            && call.pending.is_empty()
            && call
                .stop_reason
                .as_deref()
                .is_some_and(|reason| FINAL_STOPS.contains(&reason))
            && let Some((base, ts)) = st.last_record.clone()
        {
            let id = call.id.clone();
            st.open_call = None;
            let data = strip_nulls(json!({"turnId": id, "parentToolCallId": st.owner_tool}));
            // The last record may already anchor the previous call's `turn_end`.
            let id = format!("{base}:eof_turn_end");
            self.push(st, id, "assistant.turn_end", data, ts, None, None);
        }
        Ok(())
    }

    /// Insert subagent `index` as one contiguous block.
    pub(super) fn run_child(
        &mut self,
        index: usize,
        owner_tool: Option<String>,
        anchor: Option<usize>,
        launch_event: Option<String>,
    ) -> Result<()> {
        let children = self.children;
        let child = &children[index];
        if !self.inserted.insert(child.agent_id.clone()) {
            return Ok(());
        }
        let agent_id = child.agent_id.clone();
        let mut st = self.stream(
            Some(agent_id.clone()),
            owner_tool.clone(),
            anchor,
            &child.lines,
        );
        let meta = child.meta.clone().unwrap_or_default();
        let model = child.lines.iter().find_map(|line| {
            let rec = Rec(&line.value);
            (rec.kind() == "assistant" && !rec.is_synthetic_error())
                .then(|| rec.model())
                .flatten()
        });
        let data = json!({
            "toolCallId": owner_tool.unwrap_or_else(|| agent_id.clone()),
            "agentName": meta.agent_type,
            "agentDisplayName": meta.agent_type,
            "agentDescription": meta.description,
            "model": model,
        });
        let first = child.lines.first();
        let base = first.map_or_else(|| format!("{agent_id}:start"), |l| base_id(&st, l));
        let ts = first.and_then(|l| Rec(&l.value).timestamp());
        let started = format!("{base}:subagent.started");
        let data = strip_nulls(data);
        self.push(
            &mut st,
            started,
            "subagent.started",
            data,
            ts,
            None,
            launch_event,
        );
        self.run(&mut st)
    }

    fn record(&mut self, st: &mut Stream<'_>, line: &Line) -> Result<()> {
        let rec = Rec(&line.value);
        let abandoned =
            st.inherited_abandoned || rec.uuid().is_some_and(|uuid| st.abandoned.contains(uuid));
        let mut ctx = RecCtx {
            base: base_id(st, line),
            n: 0,
            ts: rec.timestamp(),
            record: line.value.clone(),
            position: NativePosition {
                line: line.line,
                file_agent_id: st.agent_id.clone(),
                abandoned,
            },
        };
        if let Some((_, Some(ts))) = st.last_record {
            st.previous_ts = Some(ts);
        }
        st.last_record = Some((ctx.base.clone(), ctx.ts));
        if abandoned {
            self.diagnostics.abandoned_records += 1;
            if rec.kind() == "assistant" {
                self.observe_call(st, rec, line, true);
            }
            self.native_only(st, &mut ctx);
            return self.abandoned_children(st, rec, line.line);
        }
        match rec.kind() {
            "assistant" => self.assistant(st, &mut ctx, rec, line)?,
            "user" => self.user(st, &mut ctx, rec),
            "system" => self.system(st, &mut ctx, rec, line),
            "attachment" => self.attachment(st, &mut ctx, rec),
            "queue-operation" => self.queue_operation(st, &mut ctx, rec),
            "cost-state" if st.agent_id.is_none() => self.cost_state(rec, line),
            kind => {
                if !BOOKKEEPING.contains(&kind) && kind != "cost-state" {
                    *self
                        .diagnostics
                        .unknown_record_types
                        .entry(kind.to_string())
                        .or_default() += 1;
                }
                self.native_only(st, &mut ctx);
            }
        }
        Ok(())
    }

    /// The record as an `Unknown(<native type>)` event for the Events tab.
    pub(super) fn native_only(&mut self, st: &mut Stream<'_>, ctx: &mut RecCtx) {
        let name = record_type(Rec(&ctx.record));
        let data = (*ctx.record).clone();
        self.emit_inner(st, ctx, &name, data, None, None);
    }

    pub(super) fn emit(
        &mut self,
        st: &mut Stream<'_>,
        ctx: &mut RecCtx,
        kind: &str,
        data: Value,
    ) -> String {
        self.emit_inner(st, ctx, kind, strip_nulls(data), None, None)
    }

    pub(super) fn emit_custom(
        &mut self,
        st: &mut Stream<'_>,
        ctx: &mut RecCtx,
        kind: &str,
        data: Value,
        custom: Custom,
    ) -> String {
        let data = strip_nulls(data);
        self.emit_inner(st, ctx, kind, data, custom.parent, custom.agent_id)
    }

    fn emit_inner(
        &mut self,
        st: &mut Stream<'_>,
        ctx: &mut RecCtx,
        kind: &str,
        data: Value,
        parent: Option<String>,
        agent_id: Option<String>,
    ) -> String {
        let id = format!("{}:{}", ctx.base, ctx.n);
        ctx.n += 1;
        let native = NativeRecord {
            source: SessionSource::ClaudeCode,
            record_type: record_type(Rec(&ctx.record)),
            data: (*ctx.record).clone(),
        };
        let native = Some((native, ctx.position.clone()));
        let event = self.push(st, id, kind, data, ctx.ts, native, parent);
        if let Some(agent) = agent_id
            && let Some(last) = self.events.last_mut()
        {
            last.agent_id = Some(agent);
        }
        event
    }

    pub(super) fn synth(
        &mut self,
        st: &mut Stream<'_>,
        ctx: &RecCtx,
        label: &str,
        kind: &str,
        data: Value,
    ) {
        let id = format!("{}:{label}", ctx.base);
        self.push(st, id, kind, strip_nulls(data), ctx.ts, None, None);
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn push(
        &mut self,
        st: &mut Stream<'_>,
        id: String,
        kind: &str,
        data: Value,
        ts: Option<DateTime<Utc>>,
        native: Option<(NativeRecord, NativePosition)>,
        parent: Option<String>,
    ) -> String {
        let (native, position) = native.unzip();
        self.events.push(RawEvent {
            event_type: kind.to_string(),
            data,
            id: Some(id.clone()),
            timestamp: ts,
            parent_id: parent.or_else(|| st.last_event.clone()),
            agent_id: st.agent_id.clone(),
            native,
        });
        self.positions.push(position);
        st.last_event = Some(id.clone());
        id
    }

    fn finish(mut self) -> ClaudeParse {
        super::usage::fill_model_calls(&mut self.events, &self.model_calls, &self.calls.calls);
        let mut diagnostics = self.diagnostics;
        let events = self
            .events
            .into_iter()
            .map(|raw| {
                let event_type = SessionEventType::parse_wire(&raw.event_type);
                let (typed_data, warning) = typed_data_from_raw(&event_type, &raw.data);
                let counters = &mut diagnostics.events;
                counters.total_events += 1;
                if matches!(typed_data, TypedEventData::Other(_)) {
                    counters.fallback_events += 1;
                } else {
                    counters.typed_events += 1;
                }
                if let Some(warning) = &warning {
                    counters.record_warning(warning);
                }
                TypedEvent {
                    raw,
                    event_type,
                    typed_data,
                }
            })
            .collect();
        // The shared counter is every skipped line, so `has_warnings` sees them.
        diagnostics.events.malformed_lines =
            diagnostics.malformed_lines + diagnostics.oversized_lines;
        ClaudeParse {
            events,
            positions: self.positions,
            calls: self.calls.calls,
            cost_snapshots: self.snapshots,
            diagnostics,
        }
    }
}

/// The native type: `type`, with the subtype for `system` and `attachment`.
fn record_type(rec: Rec<'_>) -> String {
    match rec.kind() {
        "system" => format!("system:{}", rec.str("subtype").unwrap_or("")),
        "attachment" => format!(
            "attachment:{}",
            rec.ptr_str("/attachment/type").unwrap_or("")
        ),
        "" => "unknown".to_string(),
        kind => kind.to_string(),
    }
}

pub(super) fn base_id(st: &Stream<'_>, line: &Line) -> String {
    match (Rec(&line.value).uuid(), &st.agent_id) {
        (Some(uuid), _) => uuid.to_string(),
        (None, Some(agent)) => format!("{agent}:line-{}", line.line),
        (None, None) => format!("line-{}", line.line),
    }
}

/// Drop `null` members so payloads look like the Copilot events they mirror.
pub(super) fn strip_nulls(value: Value) -> Value {
    match value {
        Value::Object(map) => Value::Object(
            map.into_iter()
                .filter(|(_, v)| !v.is_null())
                .map(|(k, v)| (k, strip_nulls(v)))
                .collect(),
        ),
        other => other,
    }
}
