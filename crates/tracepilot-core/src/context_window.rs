//! Context-window pressure reconstruction from Copilot CLI event telemetry.
//!
//! Copilot records exact layer totals at compaction boundaries and shutdown,
//! but it does not record a prompt snapshot for every turn. This module keeps
//! that distinction explicit: anchor points are observed, while points between
//! anchors are calibrated estimates derived from context-bearing event text.

use crate::models::event_types::{CompactionCompleteData, CompactionStartData, ShutdownData};
use crate::parsing::events::{TypedEvent, TypedEventData};
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
    pub compactions: Vec<ContextCompaction>,
    pub top_tool_calls: Vec<ContextToolCallContribution>,
    pub tool_types: Vec<ContextToolTypeContribution>,
    pub turn_count: usize,
    pub observed_point_count: usize,
    pub estimated_point_count: usize,
    pub compaction_start_count: usize,
    pub compaction_complete_count: usize,
    pub paired_compaction_count: usize,
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

const METHODOLOGY: &str = "System, tool-definition, and conversation totals are observed at Copilot compaction-start/shutdown anchors. Compaction starts and completes are paired in event order, even when they span turns; the post-compaction summary is estimated unless Copilot reports explicit layers. Between-anchor conversation totals are calibrated estimates derived from context-bearing event text (ceil UTF-8 bytes / 4). Tool arguments and returned results are estimated conversation-input contribution, not cache attribution.";

/// Build a context-pressure timeline without consulting TracePilot's index DB.
pub fn build_context_timeline(events: &[TypedEvent]) -> ContextTimeline {
    let mut current_turn = 0usize;
    let mut deltas = vec![TurnDelta::default()];
    let mut anchors = Vec::<Anchor>::new();
    let mut compaction_drafts = Vec::<CompactionDraft>::new();
    let mut pending_compactions = VecDeque::<PendingCompaction>::new();
    let mut compaction_start_count = 0usize;
    let mut compaction_complete_count = 0usize;
    let mut paired_compaction_count = 0usize;
    let mut tool_calls = Vec::<ToolCallDraft>::new();
    let mut tool_call_indexes = HashMap::<String, usize>::new();

    for event in events {
        if matches!(event.typed_data, TypedEventData::TurnStart(_)) {
            current_turn += 1;
            if deltas.len() <= current_turn {
                deltas.push(TurnDelta::default());
            }
        }
        let turn = current_turn.max(1);
        if deltas.len() <= turn {
            deltas.resize_with(turn + 1, TurnDelta::default);
        }
        let timestamp = event.raw.timestamp.map(|value| value.to_rfc3339());
        deltas[turn].timestamp = timestamp.clone().or_else(|| deltas[turn].timestamp.clone());

        match &event.typed_data {
            TypedEventData::UserMessage(data) => {
                let content = data
                    .transformed_content
                    .as_deref()
                    .or(data.content.as_deref())
                    .unwrap_or("");
                add_message_delta(&mut deltas[turn], content);
            }
            TypedEventData::AssistantMessage(data) => {
                let content = data.content.as_deref().unwrap_or("");
                add_message_delta(&mut deltas[turn], content);
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
                let content = data
                    .result
                    .as_ref()
                    .or(data.error.as_ref())
                    .and_then(|value| serde_json::to_string(value).ok())
                    .unwrap_or_default();
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
                    tool_calls[index].result_preview = preview(&content);
                } else {
                    tool_calls.push(ToolCallDraft {
                        turn,
                        tool_call_id: data.tool_call_id.clone(),
                        tool_name: "unknown".to_owned(),
                        argument_tokens: 0,
                        result_tokens,
                        success: data.success,
                        arguments_preview: None,
                        result_preview: preview(&content),
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
            _ => {}
        }
    }

    let turn_count = current_turn.max(deltas.len().saturating_sub(1));
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

    let compactions = compaction_drafts
        .into_iter()
        .map(|draft| finish_compaction(draft, &points))
        .collect::<Vec<_>>();

    let (top_tool_calls, tool_types) = finish_tool_contributions(tool_calls);

    let observed_point_count = points
        .iter()
        .filter(|point| point.source == ContextPointSource::Observed)
        .count();
    let estimated_point_count = points.len().saturating_sub(observed_point_count);

    ContextTimeline {
        points,
        compactions,
        top_tool_calls,
        tool_types,
        turn_count,
        observed_point_count,
        estimated_point_count,
        compaction_start_count,
        compaction_complete_count,
        paired_compaction_count,
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
    CompactionDraft {
        start_turn,
        complete_turn,
        timestamp,
        success: data.success.unwrap_or(false),
        checkpoint_number: data.checkpoint_number,
        before_tokens: data.pre_compaction_tokens,
        summary_tokens,
        explicit_after,
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
        total_tokens: system_tokens + tool_definition_tokens + conversation_tokens,
        source,
    }
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
    if content.is_empty() {
        return None;
    }
    const LIMIT: usize = 2_000;
    let mut value = content.chars().take(LIMIT).collect::<String>();
    if content.chars().count() > LIMIT {
        value.push_str("\n…");
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
        AssistantMessageData, CompactionTokenUsage, SessionEventType, TurnStartData,
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
            event(
                SessionEventType::AssistantMessage,
                TypedEventData::AssistantMessage(AssistantMessageData {
                    message_id: None,
                    turn_id: Some("1".into()),
                    content: Some("abcdefgh".into()),
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
            ),
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
        assert_eq!(timeline.points[0].source, ContextPointSource::Observed);
        assert_eq!(timeline.points[0].total_tokens, 60);
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
        ];
        for turn_id in ["2", "3"] {
            events.push(event(
                SessionEventType::AssistantTurnStart,
                TypedEventData::TurnStart(TurnStartData {
                    turn_id: Some(turn_id.into()),
                    interaction_id: None,
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
        assert_eq!(timeline.compactions[0].start_turn, 1);
        assert_eq!(timeline.compactions[0].complete_turn, 3);
        let post = timeline
            .points
            .iter()
            .find(|point| point.turn == 3 && point.phase == ContextPointPhase::PostCompaction)
            .unwrap();
        assert_eq!(post.total_tokens, 35);
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
}
