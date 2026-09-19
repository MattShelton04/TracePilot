//! Prompt-cache rows extracted at index time.

use tracepilot_core::parsing::events::TypedEvent;
use tracepilot_core::prompt_cache::{CacheConfidence, build_prompt_cache_timeline};

use super::super::types::{CacheTtlRow, CacheWindowRow};

/// Build the prompt-cache child rows for one session.
///
/// Only checkpoint-predicted windows are stored: estimates depend on the TTL
/// registry this very table feeds, so they are derived on demand instead.
pub(super) fn extract_prompt_cache_rows(
    events: &[TypedEvent],
) -> (Vec<CacheWindowRow>, Vec<CacheTtlRow>) {
    let timeline = build_prompt_cache_timeline(events, |_| None);
    let windows = timeline
        .windows
        .into_iter()
        .filter(|window| window.confidence == CacheConfidence::Predicted)
        .map(|window| CacheWindowRow {
            window_index: window.index as i64,
            idle_start: window.idle_start,
            resume_at: window.resume_at,
            idle_seconds: window.idle_seconds.map(saturating_i64),
            model: window.model,
            expires_at: window.expires_at,
            ttl_seconds: window.ttl_seconds.map(saturating_i64),
            outcome: window.outcome.as_str(),
            resume_source: window.resume_source,
            prefix_tokens: window.prefix_tokens.map(saturating_i64),
            interaction_nano_aiu: window.interaction_nano_aiu.map(saturating_i64),
            change_kinds: (!window.prefix_changes.is_empty()).then(|| {
                window
                    .prefix_changes
                    .iter()
                    .map(|change| change.kind.as_str())
                    .collect::<Vec<_>>()
                    .join(",")
            }),
        })
        .collect();
    let ttls = timeline
        .observed_ttls
        .into_iter()
        .map(|ttl| CacheTtlRow {
            model: ttl.model,
            ttl_seconds: saturating_i64(ttl.ttl_seconds),
            observation_count: ttl.count as i64,
        })
        .collect();
    (windows, ttls)
}

fn saturating_i64(value: u64) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}
