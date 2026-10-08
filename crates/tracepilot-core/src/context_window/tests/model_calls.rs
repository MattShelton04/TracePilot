use super::*;
use crate::models::event_types::ModelCallData;

#[test]
fn main_model_calls_anchor_inclusive_input_without_inventing_layers() {
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
