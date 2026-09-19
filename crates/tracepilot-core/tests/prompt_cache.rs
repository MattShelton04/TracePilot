//! Prompt-cache reconstruction against a sanitized Copilot CLI 1.0.83 log.

use std::path::Path;

use tracepilot_core::parsing::events::parse_typed_events;
use tracepilot_core::prompt_cache::{
    CacheConfidence, CacheWindowOutcome, PrefixChangeKind, PromptCacheSource,
    build_prompt_cache_timeline,
};
use tracepilot_core::turns::reconstruct_turns;

fn fixture_events() -> Vec<tracepilot_core::parsing::events::TypedEvent> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/versions/v1_0_83_prompt_cache.jsonl");
    parse_typed_events(&path)
        .expect("fixture should parse")
        .events
}

#[test]
fn reconstructs_warm_expired_and_model_changed_windows() {
    let events = fixture_events();
    let timeline = build_prompt_cache_timeline(&events, |_| None);

    assert_eq!(timeline.source, PromptCacheSource::Checkpoints);
    assert_eq!(timeline.checkpoint_count, 3);
    assert_eq!(timeline.baseline_count, 3);
    assert_eq!(timeline.malformed_entry_count, 0);

    let outcomes: Vec<_> = timeline.windows.iter().map(|w| w.outcome).collect();
    assert_eq!(
        outcomes,
        vec![
            CacheWindowOutcome::Warm,
            CacheWindowOutcome::Expired,
            CacheWindowOutcome::ModelChanged,
        ]
    );
    assert!(
        timeline
            .windows
            .iter()
            .all(|w| w.confidence == CacheConfidence::Predicted)
    );

    let [warm, expired, switched] = timeline.windows.as_slice() else {
        panic!("expected three windows");
    };
    assert_eq!(warm.prefix_changes[0].kind, PrefixChangeKind::Tools);
    assert_eq!(warm.prefix_changes[0].details, vec!["+ web_fetch"]);
    assert_eq!(warm.interaction_nano_aiu, Some(800));

    assert_eq!(expired.resume_offset_seconds, Some(874));
    assert_eq!(expired.prefix_tokens, Some(21_000));
    let kinds: Vec<_> = expired.prefix_changes.iter().map(|c| c.kind).collect();
    // The `incremental_input` flip is per request, not a cache change.
    assert_eq!(kinds, vec![PrefixChangeKind::History]);
    assert_eq!(
        expired.prefix_changes[0].summary,
        "History rewritten at message 1 (compaction)"
    );

    assert_eq!(switched.model.as_deref(), Some("claude-sonnet-5"));
    assert_eq!(switched.prefix_changes[0].kind, PrefixChangeKind::Model);
    assert_eq!(switched.interaction_nano_aiu, None);

    let summary = &timeline.summary;
    assert_eq!(summary.resumed_windows, 3);
    assert_eq!(summary.likely_breaks, 3);
    assert_eq!(summary.resent_prefix_tokens, 30_000);
    assert_eq!(summary.median_idle_seconds, Some(579));
}

#[test]
fn resume_event_indexes_match_conversation_turns() {
    let events = fixture_events();
    let timeline = build_prompt_cache_timeline(&events, |_| None);
    let turns = reconstruct_turns(&events);

    for window in &timeline.windows {
        let index = window.resume_event_index.expect("every window resumed");
        let turn = turns
            .iter()
            .find(|turn| turn.event_index == Some(index))
            .unwrap_or_else(|| panic!("no conversation turn starts at event {index}"));
        assert_eq!(
            turn.interaction_id.as_deref(),
            window.resume_interaction_id.as_deref()
        );
    }
}
