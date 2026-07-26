use super::*;
use crate::models::event_types::{
    AssistantMessageData, AssistantReasoningData, CompactionCompleteData, CompactionStartData,
    CompactionTokenUsage, SessionEventType, SessionTruncationData, ShutdownData, SkillInvokedData,
    SubagentStartedData, SystemMessageData, ToolExecCompleteData, ToolExecStartData, TurnStartData,
    UserMessageData,
};
use crate::parsing::events::{RawEvent, TypedEvent, TypedEventData};
use chrono::Utc;
use serde_json::json;

mod ownership;
mod system;

fn event(event_type: SessionEventType, typed_data: TypedEventData) -> TypedEvent {
    TypedEvent {
        raw: RawEvent {
            event_type: event_type.to_string(),
            data: json!({}),
            id: None,
            timestamp: Some(Utc::now()),
            parent_id: None,
            agent_id: None,
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
                // Root user messages can carry a task id too. It is only a
                // subagent owner when it matches a known subagent call.
                parent_agent_task_id: Some("root-agent-task".into()),
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
