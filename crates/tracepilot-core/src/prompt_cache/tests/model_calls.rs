use super::*;
use crate::parsing::events::TypedEventData;

fn call(time: &str, read: u64, write: u64, tiers: Value) -> TypedEvent {
    event(
        "tracepilot.model_call",
        time,
        json!({
            "model": MODEL, "inputTokens": 1200, "cacheReadTokens": read,
            "cacheWriteTokens": write, "cacheWriteByTtl": tiers
        }),
    )
}

#[test]
fn recorded_calls_produce_windows_and_refresh_expiry_on_reads() {
    let timeline = build_prompt_cache_timeline(
        &[
            call("00:00:00", 0, 1000, json!({"300": 1000})),
            call("00:04:00", 1000, 0, json!({})),
            user("00:06:00", "i2"),
            call("00:06:01", 0, 1000, json!({"3600": 1000})),
        ],
        |_| panic!("recorded tiers must not consult the Copilot registry"),
    );
    assert_eq!(timeline.windows.len(), 2);
    let window = &timeline.windows[0];
    assert_eq!(window.ttl_seconds, Some(300));
    assert_eq!(
        window.expires_at.as_deref(),
        Some("2026-09-12T00:09:00.000Z")
    );
    assert_eq!(window.outcome, CacheWindowOutcome::Warm);
    // Timing says warm, but the request actually missed and wrote cache.
    assert_eq!(window.confidence, CacheConfidence::Observed);
    assert_eq!(window.observed_resume.unwrap().cache_read, Some(0));
    assert_eq!(window.observed_resume.unwrap().cache_write, Some(1000));
    assert_eq!(window.observed_resume.unwrap().hit, Some(false));
    assert!(timeline.observed_ttls.is_empty());
}

#[test]
fn mixed_tiers_use_the_shorter_tier_and_observed_hit_does_not_change_expired_outcome() {
    let timeline = build_prompt_cache_timeline(
        &[
            call("00:00:00", 0, 1000, json!({"300": 100, "3600": 900})),
            user("00:10:00", "i2"),
            call("00:10:01", 1000, 0, json!({})),
        ],
        |_| Some(9999),
    );
    let window = &timeline.windows[0];
    assert_eq!(window.ttl_seconds, Some(300));
    assert_eq!(window.outcome, CacheWindowOutcome::Expired);
    assert_eq!(window.confidence, CacheConfidence::Observed);
    assert_eq!(window.observed_resume.unwrap().hit, Some(true));
    let pending = &timeline.windows[1];
    assert_eq!(pending.outcome, CacheWindowOutcome::Pending);
    assert_eq!(pending.confidence, CacheConfidence::Estimated);
    assert_eq!(
        pending.expires_at.as_deref(),
        Some("2026-09-12T00:15:01.000Z")
    );
    assert!(pending.observed_resume.is_none());
}

#[test]
fn absent_tiers_are_unknown_even_after_observed_reads_and_new_unclassified_writes() {
    let timeline = build_prompt_cache_timeline(
        &[
            call("00:00:00", 1000, 0, Value::Null),
            user("00:01:00", "i2"),
            call("00:01:01", 1000, 0, Value::Null),
        ],
        |_| panic!("never borrow TTLs"),
    );
    assert_eq!(timeline.windows[0].outcome, CacheWindowOutcome::Unknown);
    assert_eq!(timeline.windows[0].confidence, CacheConfidence::Observed);
    assert_eq!(timeline.windows[0].expires_at, None);
    assert_eq!(timeline.windows[1].confidence, CacheConfidence::Unavailable);

    let timeline = build_prompt_cache_timeline(
        &[
            call("00:00:00", 0, 1000, json!({"300": 1000})),
            call("00:01:00", 0, 1000, Value::Null),
        ],
        |_| None,
    );
    assert_eq!(timeline.windows[0].ttl_seconds, None);
    assert_eq!(timeline.windows[0].expires_at, None);
}

#[test]
fn uncached_calls_do_not_refresh_and_subagent_tiers_do_not_leak() {
    let mut child = call("00:03:00", 0, 1000, json!({"3600": 1000}));
    child.raw.agent_id = Some("child".into());
    let timeline = build_prompt_cache_timeline(
        &[
            call("00:00:00", 0, 1000, json!({"300": 1000})),
            child,
            call("00:04:00", 0, 0, json!({})),
            user("00:06:00", "i2"),
            call("00:06:01", 0, 1000, json!({"300": 1000})),
        ],
        |_| None,
    );
    assert_eq!(
        timeline.windows[0].expires_at.as_deref(),
        Some("2026-09-12T00:05:00.000Z")
    );
    assert_eq!(timeline.windows[0].outcome, CacheWindowOutcome::Expired);
    assert_eq!(timeline.windows[0].resume_event_index, Some(3));
}

#[test]
fn model_changes_do_not_borrow_tiers_and_missing_usage_is_not_observed() {
    let mut changed = call("00:01:01", 1000, 0, json!({}));
    if let TypedEventData::ModelCall(data) = &mut changed.typed_data {
        data.model = Some("another-model".into());
        data.cache_read_tokens = None;
        data.cache_write_tokens = None;
        data.cache_write_by_ttl = None;
    }
    let timeline = build_prompt_cache_timeline(
        &[
            call("00:00:00", 0, 1000, json!({"3600": 1000})),
            user("00:01:00", "i2"),
            changed,
        ],
        |_| None,
    );
    assert_eq!(
        timeline.windows[0].outcome,
        CacheWindowOutcome::ModelChanged
    );
    assert_eq!(timeline.windows[0].confidence, CacheConfidence::Estimated);
    assert!(timeline.windows[0].observed_resume.is_none());
    assert_eq!(timeline.windows[1].ttl_seconds, None);
    assert_eq!(timeline.windows[1].expires_at, None);
}
