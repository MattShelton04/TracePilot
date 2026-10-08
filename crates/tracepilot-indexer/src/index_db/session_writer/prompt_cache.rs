//! Prompt-cache rows extracted at index time.

use chrono::{DateTime, Utc};
use tracepilot_core::models::event_types::ModelCallData;
use tracepilot_core::parsing::events::{TypedEvent, TypedEventData};
use tracepilot_core::prompt_cache::{CacheConfidence, build_prompt_cache_timeline};

use super::super::types::{CacheTtlRow, CacheWindowRow};

/// Build the prompt-cache child rows for one session.
///
/// Only checkpoint-predicted windows and windows timed by recorded model
/// calls are stored: estimates from other sessions depend on the TTL registry
/// this very table feeds, so they are derived on demand instead.
pub(super) fn extract_prompt_cache_rows(
    events: &[TypedEvent],
) -> (Vec<CacheWindowRow>, Vec<CacheTtlRow>) {
    let timeline = build_prompt_cache_timeline(events, |_| None);
    let mut windows: Vec<CacheWindowRow> = timeline
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
    let first = windows.len();
    windows.extend(model_call_windows(events).into_iter().enumerate().map(
        |(offset, mut window)| {
            window.window_index = (first + offset) as i64;
            window
        },
    ));
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

/// One idle window per main-agent prompt that follows a recorded call: from
/// the last call before the prompt to the first call after it.
///
/// The TTL is the tier the session itself recorded (`cacheWriteByTtl`) on the
/// latest call that wrote cache, the shorter one when a call wrote both, and
/// expiry counts from the start of the last call, which read or wrote the
/// prefix. The outcome compares the resume time with that estimate; with no
/// recorded tier it is `unknown`. Subagents keep their own caches and are
/// left out.
fn model_call_windows(events: &[TypedEvent]) -> Vec<CacheWindowRow> {
    struct LastCall<'a> {
        at: DateTime<Utc>,
        call: &'a ModelCallData,
        ttl: Option<u64>,
    }
    let mut windows = Vec::new();
    let mut last: Option<LastCall<'_>> = None;
    let mut ttl: Option<u64> = None;
    let mut idle = false;
    for event in events.iter().filter(|e| e.raw.agent_id.is_none()) {
        match &event.typed_data {
            TypedEventData::UserMessage(_) => idle = last.is_some(),
            TypedEventData::ModelCall(call) => {
                let Some(at) = event.raw.timestamp else {
                    continue;
                };
                if idle && let Some(previous) = last.take() {
                    windows.push(window(
                        previous.call,
                        previous.at,
                        previous.ttl,
                        Some((at, call)),
                    ));
                }
                idle = false;
                let written = call.cache_write_by_ttl.iter().flatten();
                if let Some(tier) = written
                    .filter(|(_, tokens)| **tokens > 0)
                    .filter_map(|(seconds, _)| seconds.parse::<u64>().ok())
                    .min()
                {
                    ttl = Some(tier);
                }
                last = Some(LastCall { at, call, ttl });
            }
            _ => {}
        }
    }
    if let Some(previous) = last.filter(|_| idle) {
        windows.push(window(previous.call, previous.at, previous.ttl, None));
    }
    windows
}

fn window(
    call: &ModelCallData,
    idle_start: DateTime<Utc>,
    ttl: Option<u64>,
    resume: Option<(DateTime<Utc>, &ModelCallData)>,
) -> CacheWindowRow {
    let expires_at =
        ttl.map(|seconds| idle_start + chrono::Duration::seconds(saturating_i64(seconds)));
    let model_changed = resume.is_some_and(|(_, next)| next.model != call.model);
    let outcome = match (resume, expires_at) {
        (None, _) => "pending",
        _ if model_changed => "modelChanged",
        (Some(_), None) => "unknown",
        (Some((at, _)), Some(expiry)) if at < expiry => "warm",
        (Some(_), Some(_)) => "expired",
    };
    let prefix = call.cache_read_tokens.unwrap_or(0) + call.cache_write_tokens.unwrap_or(0);
    CacheWindowRow {
        window_index: 0,
        idle_start: idle_start.to_rfc3339(),
        resume_at: resume.map(|(at, _)| at.to_rfc3339()),
        idle_seconds: resume.map(|(at, _)| (at - idle_start).num_seconds().max(0)),
        model: call.model.clone(),
        expires_at: expires_at.map(|at| at.to_rfc3339()),
        ttl_seconds: ttl.map(saturating_i64),
        outcome,
        resume_source: None,
        prefix_tokens: (prefix > 0).then(|| saturating_i64(prefix)),
        interaction_nano_aiu: None,
        change_kinds: model_changed.then(|| "model".to_string()),
    }
}

fn saturating_i64(value: u64) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}
