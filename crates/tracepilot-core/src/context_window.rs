//! Context-window pressure reconstruction from Copilot CLI event telemetry.
//!
//! Copilot records exact layer totals at compaction boundaries and shutdown,
//! but it does not record a prompt snapshot for every turn. This module keeps
//! that distinction explicit: anchor points are observed, while points between
//! anchors are calibrated estimates derived from context-bearing event text.

use crate::models::event_types::{CompactionCompleteData, CompactionStartData, ShutdownData};
use crate::parsing::events::{TypedEvent, TypedEventData};
use crate::turns::reconstruct_turns;
use serde::Serialize;
use std::collections::{HashMap, VecDeque};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContextWindowPoint {
    pub turn: usize,
    pub phase: ContextPointPhase,
    pub timestamp: Option<String>,
    pub system_tokens: u64,
    pub tool_definition_tokens: u64,
    pub conversation_tokens: u64,
    pub context_change_tokens: Option<i64>,
    pub total_tokens: u64,
    pub source: ContextPointSource,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ContextPointPhase {
    Turn,
    PreCompaction,
    PostCompaction,
    Shutdown,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ContextPointSource {
    Observed,
    Estimated,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContextCompaction {
    pub start_turn: usize,
    pub complete_turn: usize,
    pub timestamp: Option<String>,
    pub success: bool,
    pub checkpoint_number: Option<u64>,
    pub before_tokens: Option<u64>,
    pub after_tokens: Option<u64>,
    pub tokens_removed: Option<u64>,
    pub after_source: ContextPointSource,
    pub summary_tokens: Option<u64>,
    pub compaction_model: Option<String>,
    pub duration_ms: Option<u64>,
    pub request_input_tokens: Option<u64>,
    pub request_output_tokens: Option<u64>,
    pub cache_read_tokens: Option<u64>,
    pub cache_write_tokens: Option<u64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContextTimelineEvent {
    pub turn: usize,
    pub event_index: usize,
    pub timestamp: Option<String>,
    pub kind: ContextTimelineEventKind,
    pub label: String,
    pub preview: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ContextTimelineEventKind {
    UserMessage,
    ModelChange,
    SessionResume,
    Truncation,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContextToolCallContribution {
    pub turn: usize,
    pub tool_call_id: Option<String>,
    pub tool_name: String,
    pub argument_tokens: u64,
    pub result_tokens: u64,
    pub total_tokens: u64,
    pub success: Option<bool>,
    pub arguments_preview: Option<String>,
    pub result_preview: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ContextToolTypeContribution {
    pub tool_name: String,
    pub call_count: usize,
    pub error_count: usize,
    pub argument_tokens: u64,
    pub result_tokens: u64,
    pub total_tokens: u64,
    pub percentage: f64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ContextTimeline {
    pub points: Vec<ContextWindowPoint>,
    pub events: Vec<ContextTimelineEvent>,
    pub compactions: Vec<ContextCompaction>,
    pub top_tool_calls: Vec<ContextToolCallContribution>,
    pub tool_types: Vec<ContextToolTypeContribution>,
    pub turn_count: usize,
    pub observed_point_count: usize,
    pub estimated_point_count: usize,
    pub compaction_start_count: usize,
    pub compaction_complete_count: usize,
    pub paired_compaction_count: usize,
    pub reported_token_limit: Option<u64>,
    pub methodology: &'static str,
}

#[derive(Debug, Clone, Default)]
struct TurnDelta {
    message_tokens: u64,
    tool_tokens: u64,
    timestamp: Option<String>,
}

#[derive(Debug, Clone)]
struct Anchor {
    turn: usize,
    timestamp: Option<String>,
    system: u64,
    tools: u64,
    conversation: u64,
    phase: ContextPointPhase,
    source: ContextPointSource,
}

#[derive(Debug, Clone)]
struct CompactionDraft {
    start_turn: usize,
    complete_turn: usize,
    timestamp: Option<String>,
    success: bool,
    checkpoint_number: Option<u64>,
    before_tokens: Option<u64>,
    summary_tokens: Option<u64>,
    explicit_after: Option<(u64, u64, u64)>,
    compaction_model: Option<String>,
    duration_ms: Option<u64>,
    request_input_tokens: Option<u64>,
    request_output_tokens: Option<u64>,
    cache_read_tokens: Option<u64>,
    cache_write_tokens: Option<u64>,
}

#[derive(Debug, Clone)]
struct ToolCallDraft {
    turn: usize,
    tool_call_id: Option<String>,
    tool_name: String,
    argument_tokens: u64,
    result_tokens: u64,
    success: Option<bool>,
    arguments_preview: Option<String>,
    result_preview: Option<String>,
}

#[derive(Debug, Clone)]
struct PendingCompaction {
    turn: usize,
    anchor: Option<Anchor>,
}

const METHODOLOGY: &str = "System, tool-definition, and conversation totals are observed at Copilot compaction-start/shutdown anchors. Compaction starts and completes are paired in event order, even when they span turns; the post-compaction summary is estimated unless Copilot reports explicit layers. Between-anchor conversation totals are calibrated estimates derived from context-bearing event text, including visible reasoning (ceil UTF-8 bytes / 4). Opaque or encrypted reasoning cannot be independently estimated; its effect is captured only by observed Copilot totals. Point-to-point context change is the signed difference between consecutive displayed totals. Tool arguments and primary returned content are estimated conversation-input contribution, not cache attribution.";

fn reconstruct_event_turn_slots(events: &[TypedEvent]) -> (Vec<usize>, usize) {
    let turns = reconstruct_turns(events);
    if turns.is_empty() {
        return (vec![1; events.len()], 0);
    }

    let mut exact_slots = vec![None; events.len()];
    let mut tool_call_ids = HashMap::<String, usize>::new();

    for turn in &turns {
        let slot = turn.turn_index.saturating_add(1);
        let event_indexes = std::iter::once(turn.event_index)
            .chain(
                turn.assistant_messages
                    .iter()
                    .chain(turn.reasoning_texts.iter())
                    .map(|message| message.event_index),
            )
            .chain(
                turn.tool_calls
                    .iter()
                    .map(|tool_call| tool_call.event_index),
            );
        for event_index in event_indexes.flatten() {
            if event_index < exact_slots.len() {
                exact_slots[event_index] = Some(slot);
            }
        }
        for tool_call in &turn.tool_calls {
            if let Some(tool_call_id) = &tool_call.tool_call_id {
                tool_call_ids.entry(tool_call_id.clone()).or_insert(slot);
            }
        }
    }

    for (event_index, event) in events.iter().enumerate() {
        if exact_slots[event_index].is_none()
            && let TypedEventData::ToolExecutionComplete(data) = &event.typed_data
        {
            exact_slots[event_index] = data
                .tool_call_id
                .as_ref()
                .and_then(|tool_call_id| tool_call_ids.get(tool_call_id))
                .copied();
        }
    }

    let mut current_slot = 1usize;
    let slots = exact_slots
        .into_iter()
        .map(|exact| {
            if let Some(slot) = exact {
                current_slot = current_slot.max(slot);
                slot
            } else {
                current_slot
            }
        })
        .collect();
    (slots, turns.len())
}

/// Build a context-pressure timeline without consulting TracePilot's index DB.
pub fn build_context_timeline(events: &[TypedEvent]) -> ContextTimeline {
    let (event_turn_slots, turn_count) = reconstruct_event_turn_slots(events);
    let mut deltas = vec![TurnDelta::default(); turn_count.saturating_add(1).max(2)];
    let mut anchors = Vec::<Anchor>::new();
    let mut compaction_drafts = Vec::<CompactionDraft>::new();
    let mut pending_compactions = VecDeque::<PendingCompaction>::new();
    let mut compaction_start_count = 0usize;
    let mut compaction_complete_count = 0usize;
    let mut paired_compaction_count = 0usize;
    let mut tool_calls = Vec::<ToolCallDraft>::new();
    let mut timeline_events = Vec::<ContextTimelineEvent>::new();
    let mut reported_token_limit = None;
    let mut tool_call_indexes = HashMap::<String, usize>::new();

    for (event_index, event) in events.iter().enumerate() {
        let turn = event_turn_slots.get(event_index).copied().unwrap_or(1);
        if deltas.len() <= turn {
            deltas.resize_with(turn + 1, TurnDelta::default);
        }
        let timestamp = event.raw.timestamp.map(|value| value.to_rfc3339());
        deltas[turn].timestamp = timestamp.clone().or_else(|| deltas[turn].timestamp.clone());

        match &event.typed_data {
            TypedEventData::UserMessage(data) => {
                let context_content = data
                    .transformed_content
                    .as_deref()
                    .or(data.content.as_deref())
                    .unwrap_or("");
                let display_content = data
                    .content
                    .as_deref()
                    .filter(|content| !content.trim().is_empty())
                    .or(data.transformed_content.as_deref())
                    .unwrap_or("");
                add_message_delta(&mut deltas[turn], context_content);
                let is_system_injection = data
                    .source
                    .as_deref()
                    .is_some_and(|source| source.eq_ignore_ascii_case("system"));
                if !is_system_injection && !display_content.trim().is_empty() {
                    timeline_events.push(ContextTimelineEvent {
                        turn,
                        event_index,
                        timestamp: timestamp.clone(),
                        kind: ContextTimelineEventKind::UserMessage,
                        label: "User message".to_owned(),
                        preview: Some(display_content.to_owned()),
                    });
                }
            }
            TypedEventData::AssistantMessage(data) => {
                add_message_delta(&mut deltas[turn], data.content.as_deref().unwrap_or(""));
                add_message_delta(
                    &mut deltas[turn],
                    data.reasoning_text.as_deref().unwrap_or(""),
                );
            }
            TypedEventData::AssistantReasoning(data) => {
                let content = data.content.as_deref().unwrap_or("");
                add_message_delta(&mut deltas[turn], content);
            }
            TypedEventData::SystemMessage(data) => {
                add_message_delta(&mut deltas[turn], data.content.as_deref().unwrap_or(""));
            }
            TypedEventData::SkillInvoked(data) => {
                let content = data.content.as_deref().unwrap_or("");
                add_message_delta(&mut deltas[turn], content);
            }
            TypedEventData::ToolExecutionStart(data) => {
                let content = data
                    .arguments
                    .as_ref()
                    .and_then(|value| serde_json::to_string(value).ok())
                    .unwrap_or_default();
                add_tool_delta(&mut deltas[turn], &content);
                let index = tool_calls.len();
                tool_calls.push(ToolCallDraft {
                    turn,
                    tool_call_id: data.tool_call_id.clone(),
                    tool_name: data.tool_name.as_deref().unwrap_or("unknown").to_owned(),
                    argument_tokens: estimate_tokens(&content),
                    result_tokens: 0,
                    success: None,
                    arguments_preview: preview(&content),
                    result_preview: None,
                });
                if let Some(tool_call_id) = &data.tool_call_id {
                    tool_call_indexes.insert(tool_call_id.clone(), index);
                }
            }
            TypedEventData::ToolExecutionComplete(data) => {
                let result = data.result.as_ref().or(data.error.as_ref());
                let content = result.map(context_result_content).unwrap_or_default();
                let result_preview = preview(&content);
                add_tool_delta(&mut deltas[turn], &content);
                let result_tokens = estimate_tokens(&content);
                if let Some(index) = data
                    .tool_call_id
                    .as_ref()
                    .and_then(|tool_call_id| tool_call_indexes.get(tool_call_id))
                    .copied()
                {
                    tool_calls[index].result_tokens += result_tokens;
                    tool_calls[index].success = data.success;
                    tool_calls[index].result_preview = result_preview;
                } else {
                    tool_calls.push(ToolCallDraft {
                        turn,
                        tool_call_id: data.tool_call_id.clone(),
                        tool_name: "unknown".to_owned(),
                        argument_tokens: 0,
                        result_tokens,
                        success: data.success,
                        arguments_preview: None,
                        result_preview,
                    });
                }
            }
            TypedEventData::CompactionStart(data) => {
                compaction_start_count += 1;
                let anchor = anchor_from_compaction_start(turn, timestamp.clone(), data);
                if let Some(anchor) = anchor.clone() {
                    anchors.push(anchor);
                }
                pending_compactions.push_back(PendingCompaction { turn, anchor });
            }
            TypedEventData::CompactionComplete(data) => {
                compaction_complete_count += 1;
                let pending = pending_compactions.pop_front();
                paired_compaction_count += usize::from(pending.is_some());
                let draft = compaction_from_complete(
                    pending.as_ref().map_or(turn, |item| item.turn),
                    turn,
                    timestamp.clone(),
                    data,
                );
                if draft.success {
                    let explicit = draft.explicit_after;
                    let start_anchor = pending.and_then(|item| item.anchor);
                    if let Some((system, conversation, tools)) = explicit {
                        anchors.push(Anchor {
                            turn,
                            timestamp: timestamp.clone(),
                            system,
                            tools,
                            conversation,
                            phase: ContextPointPhase::PostCompaction,
                            source: ContextPointSource::Observed,
                        });
                    } else if let Some(start) = start_anchor {
                        anchors.push(Anchor {
                            turn,
                            timestamp: timestamp.clone(),
                            system: start.system,
                            tools: start.tools,
                            conversation: draft.summary_tokens.unwrap_or(0),
                            phase: ContextPointPhase::PostCompaction,
                            source: ContextPointSource::Estimated,
                        });
                    }
                }
                compaction_drafts.push(draft);
            }
            TypedEventData::SessionShutdown(data) => {
                if let Some(anchor) = anchor_from_shutdown(turn, timestamp.clone(), data) {
                    anchors.push(anchor);
                }
            }
            TypedEventData::ModelChange(data) => {
                timeline_events.push(ContextTimelineEvent {
                    turn,
                    event_index,
                    timestamp: timestamp.clone(),
                    kind: ContextTimelineEventKind::ModelChange,
                    label: data.new_model.as_deref().map_or_else(
                        || "Model changed".to_owned(),
                        |model| format!("Model: {model}"),
                    ),
                    preview: data.context_tier.clone(),
                });
            }
            TypedEventData::SessionResume(data) => {
                timeline_events.push(ContextTimelineEvent {
                    turn,
                    event_index,
                    timestamp: timestamp.clone(),
                    kind: ContextTimelineEventKind::SessionResume,
                    label: "Session resumed".to_owned(),
                    preview: data.selected_model.clone(),
                });
            }
            TypedEventData::SessionTruncation(data) => {
                reported_token_limit = data.token_limit.or(reported_token_limit);
                timeline_events.push(ContextTimelineEvent {
                    turn,
                    event_index,
                    timestamp: timestamp.clone(),
                    kind: ContextTimelineEventKind::Truncation,
                    label: "Conversation truncated".to_owned(),
                    preview: data
                        .tokens_removed_during_truncation
                        .map(|tokens| format!("{tokens} tokens removed")),
                });
            }
            _ => {}
        }
    }

    anchors.sort_by_key(|anchor| (anchor.turn, phase_order(anchor.phase)));
    anchors.dedup_by(|right, left| {
        right.turn == left.turn
            && right.phase == left.phase
            && right.system == left.system
            && right.tools == left.tools
            && right.conversation == left.conversation
    });

    let mut points = build_points(turn_count, &deltas, &anchors);
    points.sort_by_key(|point| (point.turn, phase_order(point.phase)));
    let mut previous_total = None;
    for point in &mut points {
        point.context_change_tokens =
            previous_total.map(|total| signed_token_change(point.total_tokens, total));
        previous_total = Some(point.total_tokens);
    }

    let mut compactions = compaction_drafts
        .into_iter()
        .map(|draft| finish_compaction(draft, &points))
        .collect::<Vec<_>>();

    let (mut top_tool_calls, tool_types) = finish_tool_contributions(tool_calls);

    let observed_point_count = points
        .iter()
        .filter(|point| point.source == ContextPointSource::Observed)
        .count();
    let estimated_point_count = points.len().saturating_sub(observed_point_count);

    // Reconstruction uses a one-based internal slot so events that precede the
    // first turn-start can contribute to turn zero. The public DTO follows the
    // zero-based ConversationTurn/Search coordinate contract.
    for point in &mut points {
        point.turn = point.turn.saturating_sub(1);
    }
    for event in &mut timeline_events {
        event.turn = event.turn.saturating_sub(1);
    }
    for compaction in &mut compactions {
        compaction.start_turn = compaction.start_turn.saturating_sub(1);
        compaction.complete_turn = compaction.complete_turn.saturating_sub(1);
    }
    for tool_call in &mut top_tool_calls {
        tool_call.turn = tool_call.turn.saturating_sub(1);
    }

    ContextTimeline {
        points,
        events: timeline_events,
        compactions,
        top_tool_calls,
        tool_types,
        turn_count,
        observed_point_count,
        estimated_point_count,
        compaction_start_count,
        compaction_complete_count,
        paired_compaction_count,
        reported_token_limit,
        methodology: METHODOLOGY,
    }
}

fn build_points(
    turn_count: usize,
    deltas: &[TurnDelta],
    anchors: &[Anchor],
) -> Vec<ContextWindowPoint> {
    if turn_count == 0 {
        return Vec::new();
    }

    let mut points = Vec::new();
    let mut interval_start = 1usize;
    let mut base_conversation = 0u64;
    let mut last_system = anchors.first().map_or(0, |anchor| anchor.system);
    let mut last_tools = anchors.first().map_or(0, |anchor| anchor.tools);

    for anchor in anchors {
        if anchor.turn < interval_start {
            push_observed_anchor(&mut points, anchor);
            last_system = anchor.system;
            last_tools = anchor.tools;
            base_conversation = anchor.conversation;
            continue;
        }
        append_estimated_interval(
            &mut points,
            deltas,
            interval_start,
            anchor.turn,
            base_conversation,
            anchor,
        );
        push_observed_anchor(&mut points, anchor);

        last_system = anchor.system;
        last_tools = anchor.tools;
        base_conversation = anchor.conversation;
        interval_start = anchor.turn.saturating_add(1);
    }

    if interval_start <= turn_count {
        let fallback = Anchor {
            turn: turn_count,
            timestamp: deltas
                .get(turn_count)
                .and_then(|delta| delta.timestamp.clone()),
            system: last_system,
            tools: last_tools,
            conversation: base_conversation
                + deltas[interval_start..=turn_count]
                    .iter()
                    .map(|delta| delta.message_tokens + delta.tool_tokens)
                    .sum::<u64>(),
            phase: ContextPointPhase::Turn,
            source: ContextPointSource::Estimated,
        };
        append_estimated_interval(
            &mut points,
            deltas,
            interval_start,
            turn_count,
            base_conversation,
            &fallback,
        );
    }

    points
}

fn append_estimated_interval(
    points: &mut Vec<ContextWindowPoint>,
    deltas: &[TurnDelta],
    start: usize,
    end: usize,
    base_conversation: u64,
    target: &Anchor,
) {
    if start > end || end >= deltas.len() {
        return;
    }
    let raw_total = deltas[start..=end]
        .iter()
        .map(|delta| delta.message_tokens + delta.tool_tokens)
        .sum::<u64>();
    let target_growth = target.conversation.saturating_sub(base_conversation);
    let mut raw_conversation = 0u64;

    for turn in start..=end {
        raw_conversation += deltas[turn].message_tokens + deltas[turn].tool_tokens;
        let scaled_conversation = scale(raw_conversation, target_growth, raw_total);
        points.push(make_point(
            turn,
            ContextPointPhase::Turn,
            deltas[turn].timestamp.clone(),
            target.system,
            target.tools,
            base_conversation + scaled_conversation,
            ContextPointSource::Estimated,
        ));
    }
}

fn push_observed_anchor(points: &mut Vec<ContextWindowPoint>, anchor: &Anchor) {
    points.retain(|point| !(point.turn == anchor.turn && point.phase == ContextPointPhase::Turn));
    points.push(make_point(
        anchor.turn,
        anchor.phase,
        anchor.timestamp.clone(),
        anchor.system,
        anchor.tools,
        anchor.conversation,
        anchor.source,
    ));
}

fn finish_compaction(draft: CompactionDraft, points: &[ContextWindowPoint]) -> ContextCompaction {
    let after_point = points.iter().find(|point| {
        point.turn == draft.complete_turn && point.phase == ContextPointPhase::PostCompaction
    });
    let after_tokens = after_point.map(|point| point.total_tokens);
    let after_source = after_point.map_or(ContextPointSource::Estimated, |point| point.source);
    ContextCompaction {
        start_turn: draft.start_turn,
        complete_turn: draft.complete_turn,
        timestamp: draft.timestamp,
        success: draft.success,
        checkpoint_number: draft.checkpoint_number,
        before_tokens: draft.before_tokens,
        after_tokens,
        tokens_removed: draft
            .before_tokens
            .zip(after_tokens)
            .map(|(before, after)| before.saturating_sub(after)),
        after_source,
        summary_tokens: draft.summary_tokens,
        compaction_model: draft.compaction_model,
        duration_ms: draft.duration_ms,
        request_input_tokens: draft.request_input_tokens,
        request_output_tokens: draft.request_output_tokens,
        cache_read_tokens: draft.cache_read_tokens,
        cache_write_tokens: draft.cache_write_tokens,
    }
}

fn anchor_from_compaction_start(
    turn: usize,
    timestamp: Option<String>,
    data: &CompactionStartData,
) -> Option<Anchor> {
    Some(Anchor {
        turn,
        timestamp,
        system: data.system_tokens?,
        tools: data.tool_definitions_tokens?,
        conversation: data.conversation_tokens?,
        phase: ContextPointPhase::PreCompaction,
        source: ContextPointSource::Observed,
    })
}

fn anchor_from_shutdown(
    turn: usize,
    timestamp: Option<String>,
    data: &ShutdownData,
) -> Option<Anchor> {
    Some(Anchor {
        turn,
        timestamp,
        system: data.system_tokens?,
        tools: data.tool_definitions_tokens?,
        conversation: data.conversation_tokens?,
        phase: ContextPointPhase::Shutdown,
        source: ContextPointSource::Observed,
    })
}

fn compaction_from_complete(
    start_turn: usize,
    complete_turn: usize,
    timestamp: Option<String>,
    data: &CompactionCompleteData,
) -> CompactionDraft {
    let summary_tokens = data
        .compaction_tokens_used
        .as_ref()
        .and_then(|usage| usage.output_tokens.or(usage.output))
        .or_else(|| data.summary_content.as_deref().map(estimate_tokens));
    let explicit_after = match (
        data.system_tokens,
        data.conversation_tokens,
        data.tool_definitions_tokens,
    ) {
        (Some(system), Some(conversation), Some(tools)) => Some((system, conversation, tools)),
        _ => None,
    };
    let usage = data.compaction_tokens_used.as_ref();
    CompactionDraft {
        start_turn,
        complete_turn,
        timestamp,
        success: data.success.unwrap_or(false),
        checkpoint_number: data.checkpoint_number,
        before_tokens: data.pre_compaction_tokens,
        summary_tokens,
        explicit_after,
        compaction_model: usage.and_then(|item| item.model.clone()),
        duration_ms: usage.and_then(|item| item.duration),
        request_input_tokens: usage.and_then(|item| item.input_tokens.or(item.input)),
        request_output_tokens: usage.and_then(|item| item.output_tokens.or(item.output)),
        cache_read_tokens: usage.and_then(|item| item.cache_read_tokens.or(item.cached_input)),
        cache_write_tokens: usage.and_then(|item| item.cache_write_tokens),
    }
}

fn make_point(
    turn: usize,
    phase: ContextPointPhase,
    timestamp: Option<String>,
    system_tokens: u64,
    tool_definition_tokens: u64,
    conversation_tokens: u64,
    source: ContextPointSource,
) -> ContextWindowPoint {
    ContextWindowPoint {
        turn,
        phase,
        timestamp,
        system_tokens,
        tool_definition_tokens,
        conversation_tokens,
        context_change_tokens: None,
        total_tokens: system_tokens + tool_definition_tokens + conversation_tokens,
        source,
    }
}

fn signed_token_change(current: u64, previous: u64) -> i64 {
    let change = i128::from(current) - i128::from(previous);
    change.clamp(i128::from(i64::MIN), i128::from(i64::MAX)) as i64
}

fn scale(value: u64, target: u64, source: u64) -> u64 {
    if source == 0 {
        0
    } else {
        ((value as u128 * target as u128) / source as u128) as u64
    }
}

fn add_message_delta(delta: &mut TurnDelta, content: &str) {
    delta.message_tokens += estimate_tokens(content);
}

fn add_tool_delta(delta: &mut TurnDelta, content: &str) {
    delta.tool_tokens += estimate_tokens(content);
}

fn finish_tool_contributions(
    drafts: Vec<ToolCallDraft>,
) -> (
    Vec<ContextToolCallContribution>,
    Vec<ContextToolTypeContribution>,
) {
    let mut calls = drafts
        .into_iter()
        .map(|draft| ContextToolCallContribution {
            turn: draft.turn,
            tool_call_id: draft.tool_call_id,
            tool_name: draft.tool_name,
            argument_tokens: draft.argument_tokens,
            result_tokens: draft.result_tokens,
            total_tokens: draft.argument_tokens + draft.result_tokens,
            success: draft.success,
            arguments_preview: draft.arguments_preview,
            result_preview: draft.result_preview,
        })
        .collect::<Vec<_>>();
    calls.sort_by_key(|call| std::cmp::Reverse(call.total_tokens));

    let session_total = calls.iter().map(|call| call.total_tokens).sum::<u64>();
    let mut by_type = HashMap::<String, ContextToolTypeContribution>::new();
    for call in &calls {
        let entry =
            by_type
                .entry(call.tool_name.clone())
                .or_insert_with(|| ContextToolTypeContribution {
                    tool_name: call.tool_name.clone(),
                    call_count: 0,
                    error_count: 0,
                    argument_tokens: 0,
                    result_tokens: 0,
                    total_tokens: 0,
                    percentage: 0.0,
                });
        entry.call_count += 1;
        entry.error_count += usize::from(call.success == Some(false));
        entry.argument_tokens += call.argument_tokens;
        entry.result_tokens += call.result_tokens;
        entry.total_tokens += call.total_tokens;
    }
    let mut tool_types = by_type.into_values().collect::<Vec<_>>();
    for item in &mut tool_types {
        item.percentage = if session_total == 0 {
            0.0
        } else {
            item.total_tokens as f64 / session_total as f64 * 100.0
        };
    }
    tool_types.sort_by_key(|item| std::cmp::Reverse(item.total_tokens));
    calls.truncate(50);
    (calls, tool_types)
}

fn estimate_tokens(content: &str) -> u64 {
    (content.len() as u64).div_ceil(4)
}

fn preview(content: &str) -> Option<String> {
    preview_with_limit(content, 2_000)
}

fn context_result_content(result: &serde_json::Value) -> String {
    match result {
        serde_json::Value::String(content) => content.to_owned(),
        serde_json::Value::Object(object) => object
            .get("content")
            .and_then(serde_json::Value::as_str)
            .filter(|content| !content.trim().is_empty())
            .or_else(|| {
                object
                    .get("detailedContent")
                    .and_then(serde_json::Value::as_str)
                    .filter(|content| !content.trim().is_empty())
            })
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| serde_json::to_string(result).unwrap_or_default()),
        _ => serde_json::to_string(result).unwrap_or_default(),
    }
}

fn preview_with_limit(content: &str, limit: usize) -> Option<String> {
    if content.is_empty() {
        return None;
    }
    let mut value = content.chars().take(limit).collect::<String>();
    if content.chars().count() > limit {
        value.push_str("\n…[truncated]");
    }
    Some(value)
}

fn phase_order(phase: ContextPointPhase) -> u8 {
    match phase {
        ContextPointPhase::Turn => 0,
        ContextPointPhase::PreCompaction => 1,
        ContextPointPhase::PostCompaction => 2,
        ContextPointPhase::Shutdown => 3,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::event_types::{
        AssistantMessageData, CompactionTokenUsage, SessionEventType, SessionTruncationData,
        ToolExecCompleteData, ToolExecStartData, TurnStartData, UserMessageData,
    };
    use crate::parsing::events::RawEvent;
    use chrono::Utc;
    use serde_json::json;

    fn event(event_type: SessionEventType, typed_data: TypedEventData) -> TypedEvent {
        TypedEvent {
            raw: RawEvent {
                event_type: event_type.to_string(),
                data: json!({}),
                id: None,
                timestamp: Some(Utc::now()),
                parent_id: None,
            },
            event_type,
            typed_data,
        }
    }

    fn assistant_message(content: &str) -> TypedEvent {
        event(
            SessionEventType::AssistantMessage,
            TypedEventData::AssistantMessage(AssistantMessageData {
                message_id: None,
                turn_id: None,
                content: Some(content.into()),
                interaction_id: None,
                tool_requests: None,
                output_tokens: None,
                parent_tool_call_id: None,
                reasoning_text: None,
                reasoning_opaque: None,
                encrypted_content: None,
                phase: None,
                request_id: None,
            }),
        )
    }

    fn assistant_message_with_reasoning(content: &str, reasoning: &str) -> TypedEvent {
        let mut message = assistant_message(content);
        if let TypedEventData::AssistantMessage(data) = &mut message.typed_data {
            data.reasoning_text = Some(reasoning.into());
        }
        message
    }

    fn user_message(content: &str, interaction_id: &str) -> TypedEvent {
        event(
            SessionEventType::UserMessage,
            TypedEventData::UserMessage(UserMessageData {
                content: Some(content.into()),
                transformed_content: None,
                attachments: None,
                supported_native_document_mime_types: None,
                native_document_path_fallback_paths: None,
                interaction_id: Some(interaction_id.into()),
                source: None,
                agent_mode: None,
                parent_agent_task_id: None,
            }),
        )
    }

    #[test]
    fn preserves_observed_anchor_and_marks_intermediate_points_estimated() {
        let events = vec![
            event(
                SessionEventType::AssistantTurnStart,
                TypedEventData::TurnStart(TurnStartData {
                    turn_id: Some("1".into()),
                    interaction_id: None,
                }),
            ),
            assistant_message("abcdefgh"),
            event(
                SessionEventType::SessionShutdown,
                TypedEventData::SessionShutdown(ShutdownData {
                    shutdown_type: None,
                    error_reason: None,
                    total_premium_requests: None,
                    total_api_duration_ms: None,
                    session_start_time: None,
                    events_file_size_bytes: None,
                    current_model: None,
                    current_tokens: Some(60),
                    system_tokens: Some(10),
                    conversation_tokens: Some(30),
                    tool_definitions_tokens: Some(20),
                    total_nano_aiu: None,
                    source_metrics_scope: None,
                    token_details: None,
                    code_changes: None,
                    model_metrics: None,
                    session_segments: None,
                }),
            ),
        ];

        let timeline = build_context_timeline(&events);
        assert_eq!(timeline.turn_count, 1);
        assert_eq!(timeline.points.len(), 1);
        assert_eq!(timeline.points[0].turn, 0);
        assert_eq!(timeline.points[0].source, ContextPointSource::Observed);
        assert_eq!(timeline.points[0].total_tokens, 60);
        assert_eq!(timeline.points[0].context_change_tokens, None);
    }

    #[test]
    fn exposes_point_to_point_context_change_for_zero_based_turns() {
        let events = vec![
            user_message("", "interaction-1"),
            event(
                SessionEventType::AssistantTurnStart,
                TypedEventData::TurnStart(TurnStartData {
                    turn_id: Some("1".into()),
                    interaction_id: Some("interaction-1".into()),
                }),
            ),
            assistant_message_with_reasoning("aaaa", "rrrrrrrrrrrr"),
            user_message("", "interaction-2"),
            event(
                SessionEventType::AssistantTurnStart,
                TypedEventData::TurnStart(TurnStartData {
                    turn_id: Some("2".into()),
                    interaction_id: Some("interaction-2".into()),
                }),
            ),
            assistant_message("aaaaaaaaaaaa"),
            event(
                SessionEventType::SessionShutdown,
                TypedEventData::SessionShutdown(ShutdownData {
                    shutdown_type: None,
                    error_reason: None,
                    total_premium_requests: None,
                    total_api_duration_ms: None,
                    session_start_time: None,
                    events_file_size_bytes: None,
                    current_model: None,
                    current_tokens: Some(40),
                    system_tokens: Some(0),
                    conversation_tokens: Some(40),
                    tool_definitions_tokens: Some(0),
                    total_nano_aiu: None,
                    source_metrics_scope: None,
                    token_details: None,
                    code_changes: None,
                    model_metrics: None,
                    session_segments: None,
                }),
            ),
        ];

        let timeline = build_context_timeline(&events);
        assert_eq!(
            timeline
                .points
                .iter()
                .map(|point| (point.turn, point.context_change_tokens))
                .collect::<Vec<_>>(),
            vec![(0, None), (1, Some(18))]
        );
    }

    #[test]
    fn aligns_tool_contributions_with_reconstructed_conversation_turns() {
        let events = vec![
            user_message("first", "interaction-1"),
            user_message("second", "interaction-2"),
            user_message("third", "interaction-3"),
            event(
                SessionEventType::AssistantTurnStart,
                TypedEventData::TurnStart(TurnStartData {
                    turn_id: Some("turn-3".into()),
                    interaction_id: Some("interaction-3".into()),
                }),
            ),
            event(
                SessionEventType::ToolExecutionStart,
                TypedEventData::ToolExecutionStart(ToolExecStartData {
                    tool_call_id: Some("tool-3".into()),
                    turn_id: Some("turn-3".into()),
                    tool_name: Some("view".into()),
                    arguments: Some(json!({"path": "src/main.rs"})),
                    parent_tool_call_id: None,
                    mcp_server_name: None,
                    mcp_tool_name: None,
                }),
            ),
            event(
                SessionEventType::ToolExecutionComplete,
                TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                    tool_call_id: Some("tool-3".into()),
                    turn_id: Some("turn-3".into()),
                    parent_tool_call_id: None,
                    model: None,
                    interaction_id: Some("interaction-3".into()),
                    success: Some(true),
                    result: Some(json!({
                        "content": "abcd",
                        "detailedContent": "this duplicate display detail must not be counted"
                    })),
                    error: None,
                    tool_telemetry: None,
                    is_user_requested: None,
                }),
            ),
        ];

        let timeline = build_context_timeline(&events);
        assert_eq!(timeline.turn_count, 3);
        assert_eq!(
            timeline
                .events
                .iter()
                .map(|event| event.turn)
                .collect::<Vec<_>>(),
            vec![0, 1, 2]
        );
        assert_eq!(timeline.top_tool_calls[0].turn, 2);
        assert_eq!(timeline.top_tool_calls[0].result_tokens, 1);
    }

    #[test]
    fn emits_estimated_post_compaction_drop_when_post_layers_are_absent() {
        let events = vec![
            event(
                SessionEventType::AssistantTurnStart,
                TypedEventData::TurnStart(TurnStartData {
                    turn_id: Some("1".into()),
                    interaction_id: None,
                }),
            ),
            event(
                SessionEventType::SessionCompactionStart,
                TypedEventData::CompactionStart(CompactionStartData {
                    system_tokens: Some(10),
                    conversation_tokens: Some(80),
                    tool_definitions_tokens: Some(20),
                }),
            ),
            event(
                SessionEventType::SessionCompactionComplete,
                TypedEventData::CompactionComplete(CompactionCompleteData {
                    success: Some(true),
                    error: None,
                    pre_compaction_tokens: Some(110),
                    pre_compaction_messages_length: None,
                    summary_content: Some("summary".into()),
                    checkpoint_number: Some(1),
                    checkpoint_path: None,
                    compaction_tokens_used: Some(CompactionTokenUsage {
                        input: None,
                        output: None,
                        cached_input: None,
                        input_tokens: None,
                        output_tokens: Some(5),
                        cache_read_tokens: None,
                        cache_write_tokens: None,
                        duration: None,
                        model: None,
                        copilot_usage: None,
                    }),
                    request_id: None,
                    system_tokens: None,
                    conversation_tokens: None,
                    tool_definitions_tokens: None,
                }),
            ),
        ];

        let timeline = build_context_timeline(&events);
        let post = timeline
            .points
            .iter()
            .find(|point| point.phase == ContextPointPhase::PostCompaction)
            .unwrap();
        assert_eq!(post.total_tokens, 35);
        assert_eq!(post.source, ContextPointSource::Estimated);
        assert_eq!(timeline.compactions[0].tokens_removed, Some(75));
    }

    #[test]
    fn pairs_compaction_across_turns_and_applies_reset_at_completion() {
        let mut events = vec![
            user_message("", "interaction-1"),
            event(
                SessionEventType::AssistantTurnStart,
                TypedEventData::TurnStart(TurnStartData {
                    turn_id: Some("1".into()),
                    interaction_id: Some("interaction-1".into()),
                }),
            ),
            event(
                SessionEventType::SessionCompactionStart,
                TypedEventData::CompactionStart(CompactionStartData {
                    system_tokens: Some(10),
                    conversation_tokens: Some(80),
                    tool_definitions_tokens: Some(20),
                }),
            ),
        ];
        for turn_id in ["2", "3"] {
            events.push(user_message("", &format!("interaction-{turn_id}")));
            events.push(event(
                SessionEventType::AssistantTurnStart,
                TypedEventData::TurnStart(TurnStartData {
                    turn_id: Some(turn_id.into()),
                    interaction_id: Some(format!("interaction-{turn_id}")),
                }),
            ));
        }
        events.push(event(
            SessionEventType::SessionCompactionComplete,
            TypedEventData::CompactionComplete(CompactionCompleteData {
                success: Some(true),
                error: None,
                pre_compaction_tokens: Some(110),
                pre_compaction_messages_length: None,
                summary_content: Some("summary".into()),
                checkpoint_number: Some(1),
                checkpoint_path: None,
                compaction_tokens_used: Some(CompactionTokenUsage {
                    input: None,
                    output: None,
                    cached_input: None,
                    input_tokens: None,
                    output_tokens: Some(5),
                    cache_read_tokens: None,
                    cache_write_tokens: None,
                    duration: None,
                    model: None,
                    copilot_usage: None,
                }),
                request_id: None,
                system_tokens: None,
                conversation_tokens: None,
                tool_definitions_tokens: None,
            }),
        ));

        let timeline = build_context_timeline(&events);
        assert_eq!(timeline.compaction_start_count, 1);
        assert_eq!(timeline.compaction_complete_count, 1);
        assert_eq!(timeline.paired_compaction_count, 1);
        assert_eq!(timeline.compactions[0].start_turn, 0);
        assert_eq!(timeline.compactions[0].complete_turn, 2);
        let post = timeline
            .points
            .iter()
            .find(|point| point.turn == 2 && point.phase == ContextPointPhase::PostCompaction)
            .unwrap();
        assert_eq!(post.total_tokens, 35);
    }

    #[test]
    fn exposes_user_message_overlays_and_reported_truncation_limit() {
        let full_user_message = "show me the context pressure ".repeat(30);
        let events = vec![
            event(
                SessionEventType::AssistantTurnStart,
                TypedEventData::TurnStart(TurnStartData {
                    turn_id: Some("1".into()),
                    interaction_id: None,
                }),
            ),
            event(
                SessionEventType::UserMessage,
                TypedEventData::UserMessage(UserMessageData {
                    content: Some(full_user_message.clone()),
                    transformed_content: Some("enriched context used for estimation".into()),
                    attachments: None,
                    supported_native_document_mime_types: None,
                    native_document_path_fallback_paths: None,
                    interaction_id: None,
                    source: None,
                    agent_mode: None,
                    parent_agent_task_id: None,
                }),
            ),
            event(
                SessionEventType::UserMessage,
                TypedEventData::UserMessage(UserMessageData {
                    content: Some(String::new()),
                    transformed_content: Some(
                        "<system_reminder>Deferred tool definitions</system_reminder>".into(),
                    ),
                    attachments: None,
                    supported_native_document_mime_types: None,
                    native_document_path_fallback_paths: None,
                    interaction_id: None,
                    source: Some("system".into()),
                    agent_mode: None,
                    parent_agent_task_id: None,
                }),
            ),
            event(
                SessionEventType::SessionTruncation,
                TypedEventData::SessionTruncation(SessionTruncationData {
                    token_limit: Some(272_000),
                    pre_truncation_tokens_in_messages: Some(250_000),
                    pre_truncation_messages_length: None,
                    post_truncation_tokens_in_messages: Some(200_000),
                    post_truncation_messages_length: None,
                    tokens_removed_during_truncation: Some(50_000),
                    messages_removed_during_truncation: None,
                    performed_by: Some("copilot".into()),
                }),
            ),
        ];

        let timeline = build_context_timeline(&events);
        assert_eq!(timeline.reported_token_limit, Some(272_000));
        assert_eq!(timeline.events.len(), 2);
        assert_eq!(
            timeline.events[0].kind,
            ContextTimelineEventKind::UserMessage
        );
        assert_eq!(
            timeline.events[0].preview.as_deref(),
            Some(full_user_message.as_str())
        );
        assert_eq!(timeline.events[0].event_index, 1);
        assert_eq!(
            timeline.events[1].kind,
            ContextTimelineEventKind::Truncation
        );
        assert_eq!(timeline.events[1].event_index, 3);
    }

    #[test]
    fn aggregates_and_ranks_tool_contributions() {
        let (calls, types) = finish_tool_contributions(vec![
            ToolCallDraft {
                turn: 1,
                tool_call_id: Some("a".into()),
                tool_name: "shell".into(),
                argument_tokens: 10,
                result_tokens: 90,
                success: Some(true),
                arguments_preview: None,
                result_preview: None,
            },
            ToolCallDraft {
                turn: 2,
                tool_call_id: Some("b".into()),
                tool_name: "shell".into(),
                argument_tokens: 5,
                result_tokens: 20,
                success: Some(false),
                arguments_preview: None,
                result_preview: None,
            },
            ToolCallDraft {
                turn: 3,
                tool_call_id: Some("c".into()),
                tool_name: "view".into(),
                argument_tokens: 5,
                result_tokens: 45,
                success: Some(true),
                arguments_preview: None,
                result_preview: None,
            },
        ]);

        assert_eq!(calls[0].tool_call_id.as_deref(), Some("a"));
        assert_eq!(types[0].tool_name, "shell");
        assert_eq!(types[0].call_count, 2);
        assert_eq!(types[0].error_count, 1);
        assert_eq!(types[0].total_tokens, 125);
        assert!((types[0].percentage - 71.428).abs() < 0.01);
    }

    #[test]
    fn tool_result_estimate_uses_primary_content_instead_of_the_result_wrapper() {
        let result = serde_json::json!({
            "content": "fn main() {}",
            "detailedContent": "diff --git a/main.rs b/main.rs"
        });

        assert_eq!(context_result_content(&result), "fn main() {}");
    }
}
