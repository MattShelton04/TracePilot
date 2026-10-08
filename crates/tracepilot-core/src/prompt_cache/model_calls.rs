//! Recorded request usage and session-local expiry estimates. Never feeds the
//! Copilot TTL registry: an observed read is evidence of past use, not a promise.

use std::collections::HashMap;

use chrono::{DateTime, SecondsFormat, Utc};

use super::model::*;
use super::outcome::{OBSERVED_HIT_SHARE, summarize};
use crate::models::event_types::ModelCallData;
use crate::parsing::events::{TypedEvent, TypedEventData};

#[derive(Clone, Copy, Default)]
struct CacheState {
    ttl: Option<u64>,
    refreshed_at: Option<DateTime<Utc>>,
}

struct LastCall<'a> {
    at: DateTime<Utc>,
    call: &'a ModelCallData,
    cache: CacheState,
}

struct Prompt {
    event_index: usize,
    interaction_id: Option<String>,
    source: Option<String>,
}

pub(super) fn build(events: &[TypedEvent]) -> PromptCacheTimeline {
    let mut windows = Vec::new();
    let mut last: Option<LastCall<'_>> = None;
    let mut caches = HashMap::<Option<String>, CacheState>::new();
    let mut prompt: Option<Prompt> = None;
    for (index, event) in events
        .iter()
        .enumerate()
        .filter(|(_, e)| e.raw.agent_id.is_none())
    {
        match &event.typed_data {
            TypedEventData::UserMessage(data) if last.is_some() && prompt.is_none() => {
                prompt = Some(Prompt {
                    event_index: index,
                    interaction_id: data.interaction_id.clone(),
                    source: data.source.clone().filter(|s| s != "user"),
                });
            }
            TypedEventData::ModelCall(call) => {
                let Some(at) = event.raw.timestamp else {
                    continue;
                };
                if let Some(previous) = last.take()
                    && let Some(resume) = prompt.take()
                {
                    windows.push(window(
                        windows.len(),
                        &previous,
                        Some((at, call)),
                        Some(resume),
                    ));
                }
                let cache = caches.entry(call.model.clone()).or_default();
                let written = write_tokens(call).unwrap_or(0);
                if written > 0 {
                    // The latest write replaces the known tier, including a
                    // write that omits it. Mixed writes use the shorter tier.
                    cache.ttl = call
                        .cache_write_by_ttl
                        .iter()
                        .flatten()
                        .filter(|(_, tokens)| **tokens > 0)
                        .filter_map(|(seconds, _)| seconds.parse::<u64>().ok())
                        .filter(|seconds| *seconds > 0)
                        .min();
                }
                if written > 0 || call.cache_read_tokens.unwrap_or(0) > 0 {
                    cache.refreshed_at = Some(at);
                }
                last = Some(LastCall {
                    at,
                    call,
                    cache: *cache,
                });
            }
            _ => {}
        }
    }
    // The last request leaves a per-session countdown even before another
    // prompt arrives. Claude has no synthetic shutdown/checkpoint telemetry.
    if let Some(previous) = last {
        windows.push(window(windows.len(), &previous, None, prompt));
    }
    PromptCacheTimeline {
        source: PromptCacheSource::ModelCalls,
        checkpoint_count: 0,
        baseline_count: 0,
        malformed_entry_count: 0,
        summary: summarize(&windows),
        windows,
        observed_ttls: Vec::new(),
    }
}

fn write_tokens(call: &ModelCallData) -> Option<u64> {
    call.cache_write_tokens.or_else(|| {
        call.cache_write_by_ttl
            .as_ref()
            .map(|tiers| tiers.values().copied().fold(0u64, u64::saturating_add))
    })
}

fn window(
    index: usize,
    previous: &LastCall<'_>,
    resume: Option<(DateTime<Utc>, &ModelCallData)>,
    prompt: Option<Prompt>,
) -> CacheWindow {
    let expires_at = previous
        .cache
        .ttl
        .and_then(|seconds| i64::try_from(seconds).ok())
        .and_then(chrono::TimeDelta::try_seconds)
        .and_then(|ttl| previous.cache.refreshed_at?.checked_add_signed(ttl));
    let model_changed = resume.is_some_and(|(_, next)| next.model != previous.call.model);
    let outcome = match (resume, expires_at) {
        (None, _) => CacheWindowOutcome::Pending,
        _ if model_changed => CacheWindowOutcome::ModelChanged,
        (Some(_), None) => CacheWindowOutcome::Unknown,
        (Some((at, _)), Some(expiry)) if at < expiry => CacheWindowOutcome::Warm,
        _ => CacheWindowOutcome::Expired,
    };
    let prefix = previous
        .call
        .cache_read_tokens
        .unwrap_or(0)
        .saturating_add(write_tokens(previous.call).unwrap_or(0));
    let observed_resume = resume.and_then(|(_, call)| {
        let read = call.cache_read_tokens;
        if read.is_none() && write_tokens(call).is_none() {
            return None;
        }
        Some(ObservedResume {
            cache_read: read,
            cache_write: write_tokens(call),
            hit: read
                .filter(|_| prefix > 0)
                .map(|read| read as f64 >= prefix as f64 * OBSERVED_HIT_SHARE),
        })
    });
    let confidence = if resume
        .is_some_and(|(_, call)| call.cache_read_tokens.is_some() || write_tokens(call).is_some())
    {
        CacheConfidence::Observed
    } else if expires_at.is_some() {
        CacheConfidence::Estimated
    } else {
        CacheConfidence::Unavailable
    };
    let resume_at = resume.map(|(at, _)| at);
    CacheWindow {
        index,
        idle_start: format_ts(previous.at),
        resume_at: resume_at.map(format_ts),
        idle_seconds: resume_at.map(|at| (at - previous.at).num_seconds().max(0) as u64),
        model: previous.call.model.clone(),
        expires_at: expires_at.map(format_ts),
        ttl_seconds: previous.cache.ttl,
        outcome,
        confidence,
        resume_offset_seconds: resume_at
            .zip(expires_at)
            .map(|(at, expiry)| (at - expiry).num_seconds()),
        resume_event_index: prompt.as_ref().map(|p| p.event_index),
        resume_interaction_id: prompt.as_ref().and_then(|p| p.interaction_id.clone()),
        resume_source: prompt.and_then(|p| p.source),
        prefix_tokens: (prefix > 0).then_some(prefix),
        interaction_nano_aiu: None,
        observed_resume,
        prefix_changes: if model_changed {
            vec![PrefixChange {
                kind: PrefixChangeKind::Model,
                summary: "Model changed".into(),
                details: Vec::new(),
            }]
        } else {
            Vec::new()
        },
    }
}

fn format_ts(at: DateTime<Utc>) -> String {
    at.to_rfc3339_opts(SecondsFormat::Millis, true)
}
