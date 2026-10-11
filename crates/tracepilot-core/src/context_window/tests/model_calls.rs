use super::*;
use crate::models::event_types::ModelCallData;

#[test]
fn main_model_calls_anchor_observed_inclusive_input() {
    let mut child = event(
        SessionEventType::ModelCall,
        TypedEventData::ModelCall(ModelCallData {
            input_tokens: Some(99000),
            context_window_tokens: Some(1000000),
            ..Default::default()
        }),
    );
    child.raw.agent_id = Some("child".into());
    let timeline = build_context_timeline(&[
        user_message("hello", "i1"),
        event(
            SessionEventType::ModelCall,
            TypedEventData::ModelCall(ModelCallData {
                input_tokens: Some(1200),
                cache_read_tokens: Some(1000),
                output_tokens: Some(40),
                context_window_tokens: Some(200000),
                ..Default::default()
            }),
        ),
        child,
    ]);
    assert_eq!(timeline.points.len(), 1);
    assert_eq!(timeline.points[0].total_tokens, 1200);
    assert_eq!(timeline.points[0].source, ContextPointSource::Observed);
    assert_eq!(timeline.reported_token_limit, Some(200000));
    let point = serde_json::to_value(&timeline.points[0]).unwrap();
    assert_eq!(point["totalOnly"], true);
}

fn main_call(input_tokens: u64) -> TypedEvent {
    event(
        SessionEventType::ModelCall,
        TypedEventData::ModelCall(ModelCallData {
            input_tokens: Some(input_tokens),
            ..Default::default()
        }),
    )
}

#[test]
fn each_turn_keeps_the_total_of_its_last_main_call() {
    let timeline = build_context_timeline(&[
        user_message("first", "i1"),
        main_call(1200),
        main_call(1500),
        user_message("second", "i2"),
        main_call(2000),
    ]);
    let points: Vec<_> = timeline
        .points
        .iter()
        .map(|point| (point.turn, point.total_tokens, point.context_change_tokens))
        .collect();
    assert_eq!(points, [(0, 1500, None), (1, 2000, Some(500))]);
    assert_eq!(timeline.observed_point_count, 2);
}

fn cached_call(input_tokens: u64, cache_read: u64, cache_write: u64) -> TypedEvent {
    event(
        SessionEventType::ModelCall,
        TypedEventData::ModelCall(ModelCallData {
            input_tokens: Some(input_tokens),
            cache_read_tokens: Some(cache_read),
            cache_write_tokens: Some(cache_write),
            ..Default::default()
        }),
    )
}

fn tool_round_trip(id: &str, arguments: serde_json::Value, result: &str) -> [TypedEvent; 2] {
    [
        event(
            SessionEventType::ToolExecutionStart,
            TypedEventData::ToolExecutionStart(ToolExecStartData {
                tool_call_id: Some(id.into()),
                tool_name: Some("view".into()),
                arguments: Some(arguments),
                ..Default::default()
            }),
        ),
        event(
            SessionEventType::ToolExecutionComplete,
            TypedEventData::ToolExecutionComplete(ToolExecCompleteData {
                tool_call_id: Some(id.into()),
                success: Some(true),
                result: Some(json!({"content": result})),
                ..Default::default()
            }),
        ),
    ]
}

fn layers(point: &ContextWindowPoint) -> (u64, Option<u64>, Option<u64>, u64) {
    (
        point.system_tokens,
        point.message_tokens,
        point.tool_io_tokens,
        point.total_tokens,
    )
}

#[test]
fn recorded_totals_infer_overhead_and_conversation_shares() {
    // 8 bytes = 2 estimated tokens of prompt; 38 bytes = 10 of tool round trip.
    let mut events = vec![user_message("question", "i1"), cached_call(1002, 0, 1002)];
    events.extend(tool_round_trip("t1", json!({"path": "a"}), &"r".repeat(26)));
    events.push(cached_call(1100, 1002, 98));
    events.push(user_message("followup", "i2"));
    events.push(cached_call(1300, 1100, 200));

    let timeline = build_context_timeline(&events);
    let points: Vec<_> = timeline.points.iter().map(layers).collect();
    // Overhead 1000 = first call's 1002 minus the 2-token prompt it sent. The
    // remaining 100 splits 2:10 (messages:tool), then 300 splits 4:10.
    assert_eq!(
        points,
        [
            (1000, Some(17), Some(83), 1100),
            (1000, Some(86), Some(214), 1300),
        ]
    );
    let point = &timeline.points[1];
    assert_eq!(point.tool_definition_tokens, 0);
    assert_eq!(point.conversation_tokens, 300);
    assert_eq!(point.total_only, Some(true));
    assert_eq!(point.source, ContextPointSource::Observed);
    assert_eq!(
        (point.cache_read_tokens, point.cache_write_tokens),
        (Some(1100), Some(200))
    );
}

#[test]
fn overhead_comes_from_the_first_call_not_the_first_turns_last() {
    // Unrecorded text grows the residual as tool results accumulate; the
    // first turn's later calls must not inflate the persistent overhead.
    let mut events = vec![user_message("question", "i1"), main_call(1002)];
    events.extend(tool_round_trip("t1", json!({"path": "a"}), &"r".repeat(26)));
    events.push(main_call(5000));

    let timeline = build_context_timeline(&events);
    assert_eq!(layers(&timeline.points[0]).0, 1000);
    assert_eq!(timeline.points[0].conversation_tokens, 4000);
}

#[test]
fn compaction_resets_shares_to_the_summary_and_caps_overhead() {
    let mut events = vec![user_message("question", "i1"), main_call(1002)];
    events.extend(tool_round_trip("t1", json!({"path": "a"}), &"r".repeat(26)));
    events.push(main_call(1100));
    events.push(event(
        SessionEventType::SessionCompactionComplete,
        TypedEventData::CompactionComplete(CompactionCompleteData {
            success: Some(true),
            summary_content: Some("summary!".into()),
            ..Default::default()
        }),
    ));
    events.push(user_message("followup", "i2"));
    events.push(main_call(1040));
    events.push(user_message("third", "i3"));
    events.push(main_call(600));

    let timeline = build_context_timeline(&events);
    let after: Vec<_> = timeline.points[1..].iter().map(layers).collect();
    // After the summary only messages were sent; a total below the overhead
    // is all overhead rather than a negative conversation.
    assert_eq!(
        after,
        [
            (1000, Some(40), Some(0), 1040),
            (600, Some(0), Some(0), 600)
        ]
    );
}
