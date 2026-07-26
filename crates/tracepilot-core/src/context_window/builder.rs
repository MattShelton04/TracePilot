use super::contributions::{
    add_message_delta, add_tool_delta, context_result_content, estimate_tokens,
    finish_tool_contributions, preview,
};
use super::model::*;
use super::points::{
    anchor_from_compaction_start, anchor_from_shutdown, build_points, compaction_from_complete,
    finish_compaction, phase_order, signed_token_change,
};
use crate::parsing::events::{TypedEvent, TypedEventData};
use crate::turns::reconstruct_turns;
use std::collections::{HashMap, HashSet, VecDeque};

const METHODOLOGY: &str = "System, tool-definition, and conversation totals are observed at Copilot compaction-start/shutdown anchors. Main-agent system.message events represent prompt snapshots for the next request, so estimated points replace the System layer with each snapshot (ceil UTF-8 bytes / 4) rather than adding it to Conversation. Full tool definitions are not serialized in events.jsonl, so that layer remains zero until Copilot reports it. Compaction starts and completes are paired in event order, even when they span turns; the post-compaction summary is estimated unless Copilot reports explicit layers. Between-anchor conversation totals are calibrated estimates derived from main-agent context-bearing event text, including visible reasoning. Nested subagent messages and child tools are excluded because they run in separate context windows; the main agent's subagent invocation and returned result remain included. Folded skill context is counted once. Opaque or encrypted reasoning cannot be independently estimated; its effect is captured only by observed Copilot totals. Point-to-point context change is the signed difference between consecutive displayed totals. Tool arguments and primary returned content are estimated conversation-input contribution, not cache attribution.";

#[derive(Debug, Default)]
struct FoldedSkillContexts {
    invocation_indexes: HashSet<usize>,
    message_indexes: HashSet<usize>,
}

fn subagent_tool_call_ids(events: &[TypedEvent]) -> HashSet<String> {
    let mut ids = HashSet::new();
    for event in events {
        let id = match &event.typed_data {
            TypedEventData::SubagentStarted(data) => data.tool_call_id.as_ref(),
            TypedEventData::SubagentCompleted(data) => data.tool_call_id.as_ref(),
            TypedEventData::SubagentFailed(data) => data.tool_call_id.as_ref(),
            TypedEventData::AssistantMessage(data) => data.parent_tool_call_id.as_ref(),
            TypedEventData::ToolExecutionStart(data) => data.parent_tool_call_id.as_ref(),
            TypedEventData::ToolExecutionComplete(data) => data.parent_tool_call_id.as_ref(),
            _ => None,
        };
        if let Some(id) = id {
            ids.insert(id.clone());
        }
    }
    ids
}

fn is_nested_subagent_event(event: &TypedEvent, subagent_ids: &HashSet<String>) -> bool {
    let explicitly_nested = match &event.typed_data {
        TypedEventData::AssistantMessage(data) => data.parent_tool_call_id.is_some(),
        TypedEventData::ToolExecutionStart(data) => data.parent_tool_call_id.is_some(),
        TypedEventData::ToolExecutionComplete(data) => data.parent_tool_call_id.is_some(),
        TypedEventData::UserMessage(data) => data
            .parent_agent_task_id
            .as_ref()
            .is_some_and(|id| subagent_ids.contains(id)),
        _ => false,
    };
    explicitly_nested
        || event
            .raw
            .agent_id
            .as_ref()
            .is_some_and(|id| subagent_ids.contains(id))
}

fn folded_skill_contexts(events: &[TypedEvent]) -> FoldedSkillContexts {
    let invocations = events
        .iter()
        .enumerate()
        .filter_map(|(index, event)| {
            let TypedEventData::SkillInvoked(data) = &event.typed_data else {
                return None;
            };
            Some((
                event.raw.id.as_deref()?,
                (index, data.name.as_deref(), data.content.as_deref()),
            ))
        })
        .collect::<HashMap<_, _>>();
    let mut folded = FoldedSkillContexts::default();

    for (message_index, event) in events.iter().enumerate() {
        let TypedEventData::UserMessage(data) = &event.typed_data else {
            continue;
        };
        let Some((invocation_index, name, skill_content)) = event
            .raw
            .parent_id
            .as_deref()
            .and_then(|parent_id| invocations.get(parent_id))
        else {
            continue;
        };
        let Some(content) = data.content.as_deref().map(str::trim_start) else {
            continue;
        };
        if !content.starts_with("<skill-context") {
            continue;
        }
        if name.is_some_and(|name| {
            !content.contains(&format!("name=\"{name}\""))
                && !content.contains(&format!("name='{name}'"))
        }) {
            continue;
        }
        if skill_content.is_some_and(|skill_content| {
            !skill_content.trim().is_empty() && !content.contains(skill_content)
        }) {
            continue;
        }
        folded.invocation_indexes.insert(*invocation_index);
        folded.message_indexes.insert(message_index);
    }

    folded
}

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

    // Root system.message events represent prompt snapshots emitted before the
    // request they configure. Associate them with that next reconstructed
    // main-agent turn instead of the previous completed turn.
    for (event_index, event) in events.iter().enumerate() {
        if matches!(event.typed_data, TypedEventData::SystemMessage(_)) {
            exact_slots[event_index] = turns.iter().find_map(|turn| {
                turn.event_index
                    .filter(|turn_event_index| *turn_event_index > event_index)
                    .map(|_| turn.turn_index.saturating_add(1))
            });
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
    let subagent_ids = subagent_tool_call_ids(events);
    let folded_skills = folded_skill_contexts(events);
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
        if is_nested_subagent_event(event, &subagent_ids) {
            continue;
        }
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
                let is_folded_skill_context = folded_skills.message_indexes.contains(&event_index);
                if !is_system_injection
                    && !is_folded_skill_context
                    && !display_content.trim().is_empty()
                {
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
                add_message_delta(&mut deltas[turn], data.content.as_deref().unwrap_or(""));
            }
            TypedEventData::SystemMessage(data) => {
                if let Some(content) = data
                    .content
                    .as_deref()
                    .filter(|content| !content.trim().is_empty())
                {
                    deltas[turn].system_tokens = Some(estimate_tokens(content));
                }
            }
            TypedEventData::SkillInvoked(data) => {
                if !folded_skills.invocation_indexes.contains(&event_index) {
                    add_message_delta(&mut deltas[turn], data.content.as_deref().unwrap_or(""));
                }
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
